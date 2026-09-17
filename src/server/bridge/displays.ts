import { osascript, run } from './exec';

export interface Display {
  index: number;
  /** The real macOS display name, e.g. "LG ULTRAWIDE". */
  name: string;
  /** AppleScript/Carbon bounds: top-left origin, Y increasing downward. */
  bounds: { x: number; y: number; w: number; h: number };
  main: boolean;
}

/**
 * DISPLAY ENUMERATION AND THE COORDINATE FLIP.
 *
 * Cocoa (`NSScreen.frame`) uses a BOTTOM-LEFT origin with Y increasing UPWARD,
 * and the origin is the bottom-left of the MAIN screen — so a display sitting
 * above the main one has a positive Y, and one below has a negative Y.
 *
 * AppleScript window `bounds` is Carbon: TOP-LEFT origin, Y increasing
 * DOWNWARD, measured from the top-left of the main screen.
 *
 * Converting requires the main screen's height, not just a sign flip:
 *
 *     carbonY = mainHeight - (cocoaY + screenHeight)
 *
 * Getting this wrong does not throw. It silently places the window off-screen,
 * or on the wrong monitor, which is why it is written down here rather than
 * inlined at the call site.
 */
export async function listDisplays(): Promise<Display[]> {
  const script = `
use framework "AppKit"
set out to ""
set screens to current application's NSScreen's screens()
set mainFrame to (current application's NSScreen's screens()'s objectAtIndex:0)'s frame()
set mainHeight to item 2 of item 2 of (mainFrame as list)
repeat with i from 1 to count of screens
  set s to item i of screens
  set f to (s's frame()) as list
  set ox to item 1 of item 1 of f
  set oy to item 2 of item 1 of f
  set sw to item 1 of item 2 of f
  set sh to item 2 of item 2 of f
  set nm to "Display " & i
  try
    set nm to (s's localizedName()) as text
  end try
  set out to out & nm & "|" & ox & "|" & oy & "|" & sw & "|" & sh & "|" & mainHeight & linefeed
end repeat
return out
`;
  const result = await osascript(script);
  if (!result.ok) return [];

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      const [name, ox, oy, sw, sh, mainHeight] = line.split('|');
      const cocoaY = Number(oy);
      const height = Number(sh);
      return {
        index,
        name: (name || `Display ${index + 1}`).trim(),
        bounds: {
          x: Math.round(Number(ox)),
          // Cocoa bottom-left → Carbon top-left. See the note above.
          y: Math.round(Number(mainHeight) - (cocoaY + height)),
          w: Math.round(Number(sw)),
          h: Math.round(height),
        },
        main: index === 0,
      };
    });
}

/**
 * Pick where a new window should go: the second display when there is one,
 * otherwise the main one. Links open in a DEDICATED WINDOW on a second
 * display, not as a background tab on the display the user is already reading.
 */
export async function preferredDisplay(): Promise<Display | null> {
  const displays = await listDisplays();
  if (displays.length === 0) return null;
  return displays.find((d) => !d.main) ?? displays[0];
}

/** "on your LG ULTRAWIDE" / "on your laptop" — spoken back to the user. */
export function describeDisplay(display: Display | null): string {
  if (!display) return '';
  const name = display.name.toLowerCase();
  if (name.includes('built-in') || name.includes('liquid retina') || name.includes('color lcd')) {
    return 'on your laptop';
  }
  return `on your ${display.name}`;
}

export async function isMac(): Promise<boolean> {
  return process.platform === 'darwin';
}

export async function frontmostApp(): Promise<string | null> {
  const r = await run('osascript', [
    '-e',
    'tell application "System Events" to get name of first application process whose frontmost is true',
  ]);
  return r.ok ? r.stdout : null;
}
