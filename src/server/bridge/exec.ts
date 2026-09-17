import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { translateMacError } from './errors';

const execFile = promisify(execFileCb);

/**
 * `execFile`, NEVER `exec`.
 *
 * `exec` spawns `/bin/sh -c "<string>"`, so every argument is parsed by a
 * shell and `;`, `&&`, backticks and `$(...)` all become operators. `execFile`
 * spawns the binary directly with an argv array: the OS hands the arguments to
 * the process verbatim and no shell ever sees them. Shell metacharacters in an
 * argument are inert data.
 *
 * This removes the ENTIRE command-injection class, not most of it. It is the
 * reason a spoken `open Safari; rm -rf ~` resolves to "no such application:
 * safari; rm -rf ~" rather than doing anything at all — the whole string is
 * one argument, and it is looked up as an application name.
 *
 * There is no variant of this module that takes a command string. Adding one
 * would reintroduce the class in a single line, so it does not exist.
 */
export async function run(
  file: string,
  args: string[],
  timeoutMs = 12_000,
): Promise<{ ok: true; stdout: string } | { ok: false; message: string; setting?: string }> {
  try {
    const { stdout } = await execFile(file, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      // No `shell` option. Setting it would undo everything above.
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (err) {
    const e = err as { stderr?: string; message?: string; code?: string };
    const raw = (e.stderr || e.message || e.code || 'unknown failure').toString();
    const translated = translateMacError(raw);
    return { ok: false, message: translated.message, setting: translated.setting };
  }
}

/** AppleScript, passed as arguments — never concatenated into a shell line. */
export function osascript(script: string, ...args: string[]) {
  return run('osascript', ['-e', script, ...args]);
}
