// Thin, friendly wrappers over launchctl: `status`, `logs`, `restart`, `stop`.
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { HOME, LABEL, GUI, PLIST, LOG, URL, c, run } from './_common.mjs';

const cmd = process.argv[2];

function ensureInstalled() {
  if (!existsSync(PLIST)) {
    console.error(c.yellow('Service is not installed — run `npm run install-service` first.'));
    process.exit(1);
  }
}

switch (cmd) {
  case 'status': {
    ensureInstalled();
    const st = run('/bin/launchctl', ['print', `${GUI}/${LABEL}`]);
    if (!st.ok) {
      console.log(c.yellow('Installed but not loaded.') + c.dim(' Run `npm run install-service`.'));
      process.exit(0);
    }
    const pid = (st.out.match(/pid = (\d+)/) || [])[1];
    const state = (st.out.match(/state = (\S+)/) || [])[1];
    const lastExit = (st.out.match(/last exit code = (\S+)/) || [])[1];
    console.log(`${c.bold('Mission Control service')}  (${LABEL})`);
    console.log(`  state:        ${state === 'running' ? c.green(state) : c.yellow(state || 'not running')}`);
    if (pid) console.log(`  pid:          ${pid}`);
    if (lastExit) console.log(`  last exit:    ${lastExit === '0' ? lastExit : c.yellow(lastExit)}`);
    console.log(`  url:          ${URL}`);
    console.log(`  logs:         ${LOG.replace(HOME, '~')}`);
    break;
  }
  case 'logs': {
    // Stream the log (Ctrl-C to stop).
    spawn('/usr/bin/tail', ['-n', '120', '-f', LOG], { stdio: 'inherit' });
    break;
  }
  case 'restart': {
    ensureInstalled();
    const r = run('/bin/launchctl', ['kickstart', '-k', `${GUI}/${LABEL}`]);
    console.log(r.ok ? `${c.green('✓')} restarted` : c.red('restart failed: ') + r.out);
    break;
  }
  case 'stop': {
    // bootout stops AND unloads (KeepAlive would relaunch a mere SIGTERM); the plist stays so
    // `service:start` can bring it back. Survives until then — but NOT across a re-login.
    ensureInstalled();
    run('/bin/launchctl', ['bootout', `${GUI}/${LABEL}`]);
    console.log(`${c.green('✓')} stopped (run \`npm run service:start\` to resume)`);
    break;
  }
  case 'start': {
    ensureInstalled();
    const r = run('/bin/launchctl', ['bootstrap', GUI, PLIST]);
    console.log(r.ok ? `${c.green('✓')} started` : c.yellow('already running (or: ') + r.out + ')');
    break;
  }
  default:
    console.log('Usage: node scripts/service.mjs <status|start|stop|restart|logs>');
    process.exit(1);
}
