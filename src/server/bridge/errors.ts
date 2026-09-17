/**
 * macOS PERMISSION ERROR TRANSLATION.
 *
 * The single most confusing thing about this bridge is WHICH PROCESS NEEDS THE
 * GRANT. It is not the browser. The browser never touches the system here — it
 * talks to the Next.js server, and the server shells out. So the process macOS
 * is asking about is THE TERMINAL RUNNING THE DEV SERVER (Terminal, iTerm,
 * VS Code, whatever launched `npm run dev`).
 *
 * Users spend twenty minutes granting Screen Recording to Chrome and wondering
 * why nothing changed. Every message below names the terminal explicitly.
 */

export interface Translated {
  message: string;
  /** The exact pane in System Settings, when there is one. */
  setting?: string;
}

const HOST = 'the terminal app running your dev server (Terminal, iTerm or VS Code)';

export function translateMacError(raw: string): Translated {
  const text = raw.toLowerCase();

  if (text.includes('could not create image from display')) {
    return {
      message: `Screen capture was refused. Grant Screen Recording to ${HOST}, then RESTART it — the grant only takes effect on relaunch.`,
      setting: 'Privacy & Security → Screen Recording',
    };
  }

  // -1743: the user answered "Don't Allow" to an Automation prompt, or never
  // saw one. It is not a scripting error and retrying will not re-prompt.
  if (text.includes('-1743') || text.includes('not authorized to send apple events')) {
    return {
      message: `Automation was refused. Allow ${HOST} to control that app, then try again. macOS only asks once, so if you dismissed the prompt you must enable it by hand.`,
      setting: 'Privacy & Security → Automation',
    };
  }

  if (text.includes('-1728')) {
    return {
      message:
        'The app responded but did not have what was asked for — usually it has no open window yet. Launch it first, then retry.',
    };
  }

  if (text.includes('-600') || text.includes('application isn’t running') || text.includes("application isn't running")) {
    return { message: 'That application is not running.' };
  }

  if (text.includes('-1719') || text.includes('accessibility')) {
    return {
      message: `Accessibility access is required. Grant it to ${HOST}, then restart it.`,
      setting: 'Privacy & Security → Accessibility',
    };
  }

  if (text.includes('enoent')) {
    return { message: 'No such application is installed.' };
  }

  if (text.includes('operation not permitted')) {
    return {
      message: `macOS blocked the operation. Grant Full Disk Access or Automation to ${HOST}, depending on what was asked for.`,
      setting: 'Privacy & Security',
    };
  }

  return { message: raw.split('\n')[0].slice(0, 240) || 'The command failed.' };
}
