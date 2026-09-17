import { osascript, run } from './exec';
import { resolveApp, scanApps } from './apps';
import { describeDisplay, preferredDisplay } from './displays';

/**
 * THE VERB ENUM.
 *
 * Every capability is a named verb with a HAND-WRITTEN implementation. No code
 * path anywhere in this module runs a caller-supplied command string — not
 * through a template, not through a "safe" escaper, not through an allow-list
 * of shell fragments. The caller chooses a verb; the verb chooses the binary
 * and builds its own argv.
 *
 * DELIBERATELY ABSENT: shutdown, restart, and any form of file deletion. A
 * misheard word must not be able to destroy unsaved work, and there is no
 * phrasing of "quit" that should ever become "kill". Applications are asked to
 * quit gracefully so their save prompts still appear.
 *
 * ADDING A VERB IS A TYPE ERROR UNTIL IT IS IMPLEMENTED. `IMPLEMENTATIONS` is
 * typed as a total `Record<Verb, …>`, so extending the union without writing
 * the handler fails the build rather than falling through to a runtime default
 * that does something unexpected.
 */
export const VERBS = [
  'list_apps',
  'launch_app',
  'quit_app',
  'open_url',
  'media',
  'volume',
  'screen_capture',
  'clipboard_read',
  'clipboard_write',
  'hide_others',
  'lock_screen',
  'sleep_display',
  'do_not_disturb',
  'create_note',
  'create_reminder',
  'list_displays',
] as const;

export type Verb = (typeof VERBS)[number];

export interface BridgeRequest {
  verb: Verb;
  app?: string;
  url?: string;
  query?: string;
  action?: string;
  value?: number;
  text?: string;
  title?: string;
}

export interface BridgeResponse {
  ok: boolean;
  message: string;
  /** The System Settings pane to open, when a permission is the blocker. */
  setting?: string;
  data?: unknown;
}

const ok = (message: string, data?: unknown): BridgeResponse => ({ ok: true, message, data });
const fail = (message: string, setting?: string): BridgeResponse => ({ ok: false, message, setting });

type Handler = (request: BridgeRequest) => Promise<BridgeResponse>;

const IMPLEMENTATIONS: Record<Verb, Handler> = {
  // ---------------------------------------------------------------- apps ---
  list_apps: async () => {
    const apps = await scanApps();
    return ok(`${apps.length} applications installed`, apps.map((a) => a.name));
  },

  launch_app: async ({ app }) => {
    if (!app) return fail('No application named.');
    const resolved = await resolveApp(app);
    // This is where an injected command string lands: it is not an installed
    // application, so it is not a target, and nothing runs.
    if (!resolved) return fail(`No such application: ${app}`);
    const result = await run('open', ['-a', resolved.path]);
    return result.ok
      ? ok(`Opened ${resolved.name}.`)
      : fail(result.message, result.setting);
  },

  quit_app: async ({ app }) => {
    if (!app) return fail('No application named.');
    const resolved = await resolveApp(app);
    if (!resolved) return fail(`No such application: ${app}`);
    // `quit` — graceful. Never `kill`: an app asked to quit gets to put up its
    // "save changes?" sheet, and an app that is killed does not.
    const result = await osascript(`tell application "${escapeAppleScript(resolved.name)}" to quit`);
    return result.ok ? ok(`Asked ${resolved.name} to quit.`) : fail(result.message, result.setting);
  },

  // ---------------------------------------------------------------- web ----
  open_url: async ({ url, query }) => {
    const target = url ?? (query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : null);
    if (!target) return fail('Nothing to open.');
    if (!/^https?:\/\//.test(target)) return fail('Only http and https URLs can be opened.');

    const display = await preferredDisplay();
    const where = describeDisplay(display);
    const browser = (await resolveApp('google chrome')) ?? (await resolveApp('safari'));
    if (!browser) return fail('No supported browser is installed.');

    if (browser.key.includes('chrome')) {
      /**
       * CHROME: the URL must go through the CLI `--new-window` flag.
       *
       * Assigning `URL of active tab` on a newly-made Chrome window is simply
       * ignored — Chrome creates the window, then discards the assignment, and
       * you are left with a new tab page. `--new-window <url>` is the only
       * path that reliably lands the URL in a window of its own.
       */
      const before = await chromeWindowIds();
      const launched = await run('open', ['-na', browser.path, '--args', '--new-window', target]);
      if (!launched.ok) return fail(launched.message, launched.setting);

      // DIFF THE WINDOW IDS. Moving "window 1" moves whatever is frontmost,
      // which is frequently a window the user was already using — so the new
      // window is identified by which id appeared, not by z-order.
      await delay(900);
      const after = await chromeWindowIds();
      const fresh = after.find((id) => !before.includes(id));
      if (fresh !== undefined && display) {
        const b = display.bounds;
        await osascript(
          `tell application "Google Chrome" to set bounds of (first window whose id is ${fresh}) to {${b.x + 40}, ${b.y + 40}, ${b.x + b.w - 40}, ${b.y + b.h - 40}}`,
        );
      }
      return ok(`Opened ${hostOf(target)} in a new Chrome window ${where}.`.trim());
    }

    // SAFARI: `make new document with properties {URL:…}` both creates the
    // window and navigates it in one step, which Chrome's model does not do.
    const result = await osascript(
      `tell application "Safari"
         activate
         make new document with properties {URL:"${escapeAppleScript(target)}"}
       end tell`,
    );
    if (!result.ok) return fail(result.message, result.setting);
    if (display) {
      const b = display.bounds;
      await osascript(
        `tell application "Safari" to set bounds of front window to {${b.x + 40}, ${b.y + 40}, ${b.x + b.w - 40}, ${b.y + b.h - 40}}`,
      );
    }
    return ok(`Opened ${hostOf(target)} in a new Safari window ${where}.`.trim());
  },

  // -------------------------------------------------------------- media ----
  media: async ({ action }) => {
    const keys: Record<string, number> = { play: 16, pause: 16, next: 17, previous: 18 };
    const code = action ? keys[action] : undefined;
    if (code === undefined) return fail(`Unknown media action: ${action}`);
    const result = await osascript(
      `tell application "System Events" to key code ${code} using {}`,
    );
    return result.ok ? ok(`Media: ${action}.`) : fail(result.message, result.setting);
  },

  volume: async ({ value }) => {
    if (typeof value !== 'number' || value < 0 || value > 100) {
      return fail('Volume must be between 0 and 100.');
    }
    const result = await osascript(`set volume output volume ${Math.round(value)}`);
    return result.ok ? ok(`Volume ${Math.round(value)}%.`) : fail(result.message, result.setting);
  },

  // ------------------------------------------------------------ capture ----
  screen_capture: async () => {
    const path = `/tmp/nexus-capture-${Date.now()}.png`;
    // -x suppresses the shutter sound; -C excludes the cursor.
    const result = await run('screencapture', ['-x', '-C', path]);
    return result.ok
      ? ok('Captured the screen.', { path })
      : fail(result.message, result.setting ?? 'Privacy & Security → Screen Recording');
  },

  clipboard_read: async () => {
    const result = await run('pbpaste', []);
    return result.ok ? ok('Clipboard read.', { text: result.stdout }) : fail(result.message);
  },

  clipboard_write: async ({ text }) => {
    if (typeof text !== 'string') return fail('Nothing to copy.');
    // The text goes to pbcopy's STDIN, never into an argument and never into a
    // shell line, so its content cannot affect how the command is parsed.
    return new Promise<BridgeResponse>((resolve) => {
      import('node:child_process').then(({ spawn }) => {
        const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'pipe'] });
        child.on('error', (e) => resolve(fail(e.message)));
        child.on('close', (code) =>
          resolve(code === 0 ? ok('Copied to the clipboard.') : fail('pbcopy failed.')),
        );
        child.stdin.end(text);
      });
    });
  },

  // ------------------------------------------------------------ session ----
  hide_others: async () =>
    (await osascript(
      'tell application "System Events" to set visible of (every process whose visible is true and frontmost is false) to false',
    )).ok
      ? ok('Hid other applications.')
      : fail('Could not hide other applications.', 'Privacy & Security → Accessibility'),

  lock_screen: async () => {
    const result = await run('pmset', ['displaysleepnow']);
    return result.ok ? ok('Locked.') : fail(result.message);
  },

  sleep_display: async () => {
    const result = await run('pmset', ['displaysleepnow']);
    return result.ok ? ok('Display asleep.') : fail(result.message);
  },

  do_not_disturb: async ({ action }) => {
    // Focus modes are not scriptable directly; the Shortcuts route is the
    // supported one and degrades to a clear message when the shortcut is absent.
    const name = action === 'off' ? 'Nexus DND Off' : 'Nexus DND On';
    const result = await run('shortcuts', ['run', name]);
    return result.ok
      ? ok(`Do Not Disturb ${action === 'off' ? 'off' : 'on'}.`)
      : fail(
          `Create a Shortcut named "${name}" that toggles the Focus, then try again. macOS does not expose Focus to scripting any other way.`,
        );
  },

  // -------------------------------------------------------------- notes ----
  create_note: async ({ title, text }) => {
    if (!text) return fail('Nothing to write.');
    const body = escapeAppleScript(text);
    const name = escapeAppleScript(title ?? 'Note from NEXUS');
    const result = await osascript(
      `tell application "Notes" to make new note at folder "Notes" of account "iCloud" with properties {name:"${name}", body:"${body}"}`,
    );
    return result.ok ? ok('Note created.') : fail(result.message, result.setting);
  },

  create_reminder: async ({ title, text }) => {
    const name = escapeAppleScript(title ?? text ?? 'Reminder from NEXUS');
    if (!name) return fail('Nothing to remind you about.');
    const result = await osascript(
      `tell application "Reminders" to make new reminder with properties {name:"${name}"}`,
    );
    return result.ok ? ok('Reminder created.') : fail(result.message, result.setting);
  },

  list_displays: async () => {
    const { listDisplays } = await import('./displays');
    const displays = await listDisplays();
    return ok(`${displays.length} display${displays.length === 1 ? '' : 's'}.`, displays);
  },
};

export async function dispatch(request: BridgeRequest): Promise<BridgeResponse> {
  const handler = IMPLEMENTATIONS[request.verb];
  // The verb was validated against VERBS before reaching here; this is the
  // belt to that braces.
  if (!handler) return fail(`Unknown verb: ${request.verb}`);
  return handler(request);
}

export function isVerb(value: unknown): value is Verb {
  return typeof value === 'string' && (VERBS as readonly string[]).includes(value);
}

async function chromeWindowIds(): Promise<number[]> {
  const result = await osascript('tell application "Google Chrome" to get id of every window');
  if (!result.ok) return [];
  return result.stdout
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/**
 * AppleScript string escaping.
 *
 * This is NOT the injection defence — `execFile` already made shell
 * metacharacters inert, and this text never reaches a shell. It exists so a
 * quotation mark in a note body does not terminate the AppleScript literal and
 * turn the rest of the note into a syntax error.
 */
function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 4000);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'the page';
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
