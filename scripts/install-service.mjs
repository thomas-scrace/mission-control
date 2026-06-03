// Generate a per-machine LaunchAgent for the Mission Control server and load it.
// Everything is derived from the installing environment (node path, PATH, repo location) so the
// same script works for any user — no hand-edited paths. Re-running is idempotent and is also the
// fix-after-a-Node-upgrade path. Pass --dry-run to write+validate the plist without loading it.
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REPO, HOME, LABEL, PORT, GUI, PLIST, LAUNCH_AGENTS, LOG_DIR, LOG, URL,
  c, which, run, waitForServer,
} from './_common.mjs';

const dryRun = process.argv.includes('--dry-run');

// ── blocker: Node version (the service reuses THIS node) ──
if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(c.red(`Node ${process.versions.node} is too old — need ≥ 20.`));
  process.exit(1);
}

// ── PATH the daemon will run with ──
// launchd's default PATH is just /usr/bin:/bin:/usr/sbin:/sbin, so node (nvm), claude (~/.local/bin)
// and gh (homebrew) would all be unreachable. Bake in their dirs + the installing shell's PATH.
const dirOf = (p) => (p ? path.dirname(p) : null);
const pathDirs = [
  dirOf(process.execPath),
  dirOf(which('claude')),
  dirOf(which('gh')),
  dirOf(which('git')),
  ...(process.env.PATH || '').split(':'),
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
].filter(Boolean);
const servicePath = [...new Set(pathDirs)].join(':');

// ── the command: run the TS source via tsx (no build step to drift or break) ──
const programArgs = [process.execPath, '--import', 'tsx', path.join(REPO, 'src/server/index.ts')];

const xml = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
const arrayItems = (xs) => xs.map((x) => `      <string>${xml(x)}</string>`).join('\n');

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${arrayItems(programArgs)}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(REPO)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>MC_PORT</key><string>${xml(PORT)}</string>
    <key>PATH</key><string>${xml(servicePath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(LOG)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(LOG)}</string>
</dict>
</plist>
`;

// In a dry run, write to a temp file so we never touch the real LaunchAgents directory.
const target = dryRun ? path.join(os.tmpdir(), `${LABEL}.dryrun.plist`) : PLIST;
if (!dryRun) {
  mkdirSync(LAUNCH_AGENTS, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
}
writeFileSync(target, plist);

// Validate before we ask launchd to parse it.
const lint = run('/usr/bin/plutil', ['-lint', target]);
if (!lint.ok) {
  console.error(c.red('Generated plist failed plutil validation:\n') + lint.out);
  process.exit(1);
}

if (dryRun) {
  console.log(`${c.green('✓')} plist is valid (not loaded; would write to ${PLIST.replace(HOME, '~')})\n`);
  console.log(plist);
  process.exit(0);
}
console.log(`${c.green('✓')} wrote ${PLIST.replace(HOME, '~')}  (valid)`);

// ── load it ──
run('/bin/launchctl', ['bootout', `${GUI}/${LABEL}`]); // idempotent: ignore "not loaded"
let loaded = run('/bin/launchctl', ['bootstrap', GUI, PLIST]);
if (!loaded.ok) {
  // Older macOS without bootstrap — fall back to the legacy verbs.
  run('/bin/launchctl', ['unload', PLIST]);
  loaded = run('/bin/launchctl', ['load', '-w', PLIST]);
}
if (!loaded.ok) {
  console.error(c.red('launchctl could not load the service:\n') + loaded.out);
  console.error(c.dim(`\nTry manually:\n  launchctl bootstrap ${GUI} ${PLIST}`));
  process.exit(1);
}
run('/bin/launchctl', ['kickstart', '-k', `${GUI}/${LABEL}`]); // ensure a fresh start
console.log(`${c.green('✓')} loaded into launchd (${LABEL})`);

console.log(c.dim(`\nWaiting for the server on ${URL} … (first boot scans your sessions — ~20s)`));
if (await waitForServer()) {
  console.log(`\n${c.green(c.bold('Mission Control is running →'))} ${c.bold(URL)}`);
  console.log(c.dim(`It will start at login and restart on crash. Logs: ${LOG.replace(HOME, '~')}`));
  console.log(c.dim('Manage it: npm run service:status | service:logs | service:restart | uninstall-service'));
  if (!process.env.MC_NO_OPEN) run('/usr/bin/open', [URL]);
} else {
  console.error(c.yellow(`\nLoaded, but nothing answered on ${URL} yet.`));
  console.error(c.dim(`Check the log: tail -f ${LOG.replace(HOME, '~')}   (did the web get built? run \`npm run build\`)`));
  process.exit(1);
}
