// Stop and remove the Mission Control LaunchAgent. Leaves your data/logs in ~/.missioncontrol
// unless you pass --purge.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { REPO, HOME, LABEL, GUI, PLIST, STATE_DIR, c, run } from './_common.mjs';

const purge = process.argv.includes('--purge');

run('/bin/launchctl', ['bootout', `${GUI}/${LABEL}`]);
run('/bin/launchctl', ['unload', PLIST]); // legacy fallback, harmless if bootout already worked

if (existsSync(PLIST)) {
  rmSync(PLIST);
  console.log(`${c.green('✓')} removed ${PLIST.replace(HOME, '~')}`);
} else {
  console.log(c.dim('No plist found — nothing to remove.'));
}
console.log(`${c.green('✓')} service stopped and unloaded`);

if (purge) {
  // Keep the repo; only drop our state dir (meta.sqlite, logs).
  if (existsSync(STATE_DIR) && path.resolve(STATE_DIR) !== path.resolve(REPO)) {
    rmSync(STATE_DIR, { recursive: true, force: true });
    console.log(`${c.green('✓')} purged ${STATE_DIR.replace(HOME, '~')} (db + logs)`);
  }
}
