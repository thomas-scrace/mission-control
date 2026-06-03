// Preflight / diagnostics for Mission Control. Reports what works and what degrades.
// Exit code is non-zero ONLY for hard blockers (so `setup` can gate on it); optional tools
// just print a warning explaining which feature is affected.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO, PORT, LABEL, GUI, PLIST, LOG, c, which, run } from './_common.mjs';

let blockers = 0;
const ok = (m) => console.log(`  ${c.green('✓')} ${m}`);
const warn = (m) => console.log(`  ${c.yellow('⚠')} ${m}`);
const bad = (m) => { console.log(`  ${c.red('✗')} ${m}`); blockers++; };

console.log(c.bold('\nMission Control — doctor\n'));

// ── hard requirements ──
const major = Number(process.versions.node.split('.')[0]);
major >= 20 ? ok(`Node ${process.versions.node} (≥ 20)`) : bad(`Node ${process.versions.node} is too old — need ≥ 20`);

which('git') ? ok('git found') : bad('git not found — required for worktree/branch/PR info');

if (existsSync(path.join(REPO, 'node_modules'))) ok('dependencies installed');
else bad('node_modules missing — run `npm install`');

// better-sqlite3 is a native module; a Node major upgrade can break its ABI.
try {
  const require = createRequire(import.meta.url);
  require(path.join(REPO, 'node_modules/better-sqlite3'));
  ok('better-sqlite3 native module loads');
} catch {
  bad('better-sqlite3 failed to load (Node ABI mismatch?) — run `npm rebuild better-sqlite3`');
}

if (existsSync(path.join(REPO, 'dist/web/index.html'))) ok('web UI is built (dist/web)');
else warn('web UI not built — run `npm run build` (until then the server serves the API only)');

// ── port ──
const portUser = run('/usr/sbin/lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t']);
if (!portUser.out) ok(`port ${PORT} is free`);
else warn(`port ${PORT} is already in use (pid ${portUser.out.split('\n').join(', ')}) — stop it or set MC_PORT`);

// ── optional integrations (degrade gracefully) ──
console.log(c.dim('\n  optional integrations:'));
which('claude') ? ok('claude CLI — agent discovery, synthesis & launch') : warn('claude CLI not found — Claude sessions won\'t be discovered/launched');
which('codex') ? ok('codex CLI present') : warn('codex CLI not found — Codex sessions still read from ~/.codex, launch falls back to opening the app');
which('gh') ? ok('gh CLI — pull-request status on cards') : warn('gh not found — PR status will be hidden');
existsSync('/Applications/iTerm.app') ? ok('iTerm — used to open/focus Claude agents') : warn('iTerm not found — "Start Claude" / focus needs iTerm');

// ── service state ──
console.log(c.dim('\n  service:'));
if (existsSync(PLIST)) {
  ok(`LaunchAgent installed (${PLIST})`);
  const st = run('/bin/launchctl', ['print', `${GUI}/${LABEL}`]);
  console.log(st.ok ? `  ${c.green('✓')} loaded${/state = running/.test(st.out) ? ' and running' : ''}` : `  ${c.yellow('⚠')} installed but not loaded — run \`npm run install-service\``);
  console.log(c.dim(`     logs: ${LOG}`));
} else {
  warn('service not installed — run `npm run install-service` to keep it running across logins');
}

console.log('');
if (blockers) {
  console.log(c.red(`${blockers} blocker(s) — fix the ✗ items above.\n`));
  process.exit(1);
}
console.log(c.green('Good to go.\n'));
