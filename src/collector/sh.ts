import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Run a shell command and return stdout, swallowing non-zero exits.
 * Tools like `lsof`/`pgrep`/`git` exit non-zero on "no matches" — we treat that as empty output.
 */
export async function run(cmd: string, timeoutMs = 4000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (e: any) {
    return typeof e?.stdout === 'string' ? e.stdout : '';
  }
}
