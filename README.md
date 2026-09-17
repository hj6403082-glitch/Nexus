# NEXUS

A spatial computing operating system for the web. Ten holographic modules on a
ring in a volumetric room, driven by hand gestures and voice, which can dissolve
into particles and reassemble as a digital human that speaks and presents
information with its hand.

```bash
cp .env.example .env.local     # every key is optional
npm install
npm run dev                    # http://localhost:3000
```

Nothing is required to run it. Modules with no API key fall back to deterministic
sample data and say so on the card face. The AI is offline without a Gemini key.
The desktop bridge is off unless you turn it on.

---

## What is actually here

Built in seven passes, each extending the last rather than replacing it.

| | |
|---|---|
| **1 — Foundation** | The room, the ring, ten glass cards with live data, MediaPipe hand tracking, spring physics, adaptive quality, synthesised audio, a four-corner HUD. |
| **2 — AI brain** | Streaming Gemini through a server proxy, `SpeechRecognition` with barge-in interruption, speech that starts before the response finishes, holographic text that assembles from scattered words. |
| **3 — Knowledge** | Real adapters for Instagram, stocks, weather and news; sample adapters for the rest. Every figure carries provenance and age. |
| **4 — Worlds** | Six environments, cinematic module transitions, two-hand gestures. |
| **5 — Desktop bridge** | A hardened local API that launches apps, opens windows on a chosen display, and drives media — macOS only, off by default. A ⌘K palette over apps, sites and commands. |
| **6 — Stillness** | Ambient motion off by default and gated on a multiplier; one master clock for module presentation; six filmic colour grades; gold for the centred card, isolated from warning orange. |
| **7 — The human form** | The cards dissolve into particles, gather, and reassemble as a signed-distance bust that breathes, watches you, speaks, and presents panels from its hand. |

### Commands

Type ⌘K, or say them once voice is enabled (wake word: *"Nexus"*, or draw a
circle in the air).

```
open stocks · show my reels · rotate left · what's my schedule
how is Nvidia today · summarise today's AI news · explain MCP
transform into a human shape · return to spatial mode
lock · drift · open Spotify · search WebGPU
```

Keyboard: `←` `→` rotate · `h` HUD · `m` ambient motion · `⌘K` palette.

---

## The decisions worth knowing about

**Card faces are drawn into a 2D canvas, not into DOM.** This is the
load-bearing choice for Phase 7. The brief requires that the particles which
leave a card *are* the pixels of that card, live data included. Because the face
is a canvas, the dissolve samples the exact `ImageData` on screen at the instant
of the command — no re-render, no approximation, no second source of truth.

**Ambient motion is gated on a 0..1 multiplier, not a boolean.** Toggling eases
the multiplier over about a second so the scene settles instead of stopping dead.
When it reaches exactly zero, every ambient term is *skipped* rather than scaled,
so drift is not "very small" — the carousel angle and the camera transform are
bit-identical frame over frame. Verified, in the running app, in
`scripts/verify-visual.mjs`.

**Gold is gated on the warning flag, not distanced from it.** Gold (46°) and
warning orange (28°) are 18° apart, which is not enough separation to tell apart
in peripheral vision at this bloom radius. So a warned card is *never* allowed to
go gold at all. Gold is also drawn *dimmer* than the blue it replaces: pushing
the border above 1.0 clips red and green and the gold resolves to white. Its
prominence comes from hue and a wider outer bloom.

**The figure is baked once, not projected per frame.** Seed points are projected
onto the isosurface with Newton steps in a fragment shader, read back at 16 bits,
and thinned to an exact count by Poisson-disk selection. From then on the figure
is a static set of positions and normals that costs nothing to hold and is
perfectly still. It is posed by rigid hinges — the jaw about a line through the
ears, each knuckle about its own axis — because rigid rotation moves points
without moving the surface they sit on, and therefore cannot tear it.

**The beads are opaque sphere impostors writing curved depth**, not additive
discs. Additive discs sum where they overlap, so the silhouette blows out to
white and the result reads as an *outline* of a person. And there is no rim
term, for the same reason.

**One clock per sequence, and every layer reads from it.** The presentation
choreography and the transformation each have exactly one number advancing;
cards, camera, post chain and figure are pure functions of it and write nothing
back. The return is the transformation clock run backward at 1.7×, not a second
choreography to keep in sync.

**Spring physics everywhere, named by intent.** `MOTION.ARRIVING`,
`LEAVING`, `ACKNOWLEDGING`, `REPORTING`, `DRIFTING` — and one `BEAT` constant
that every duration in the app is a multiple of. There is no `lerp(a, b, 0.1)`
in the scene graph.

---

## The desktop bridge

`POST /api/bridge` shells out from the Next.js server. **This is a remote code
execution surface**, and it is treated as one. Six gates, each independently
sufficient against a different attacker:

1. **Off unless `NEXUS_BRIDGE_ENABLED=1`** — exactly `1`, not a truthy check.
2. **macOS only.** Every other platform gets a clean `501`; nothing else breaks.
3. **Loopback Host only**, else `403`.
4. **Same-origin only.** Loopback alone is not enough — any page on the internet
   can POST to `http://localhost:3000` from your own browser.
5. **The verb is an enum member.** `IMPLEMENTATIONS` is a total
   `Record<Verb, Handler>`, so adding a verb is a *type error* until it is
   implemented.
6. **Only declared fields cross the boundary**, rebuilt field by field.

Underneath: `execFile`, never `exec`. No shell is spawned, so shell
metacharacters in any argument are inert data — that removes the entire
injection class rather than most of it. Applications resolve against a live
directory scan, so an app that is not installed cannot be named.

```
$ open "Safari; rm -rf ~"
→ No such application: Safari; rm -rf ~
```

There is **no shutdown, no restart, and no file deletion**. Applications are
asked to `quit` gracefully, never killed, so their save prompts still appear.

Permission failures are translated into the exact setting to change — and they
name the process that actually needs the grant, which is **the terminal running
your dev server**, not the browser:

```
could not create image from display
  → Grant Screen Recording to the terminal app running your dev server, then
    RESTART it — the grant only takes effect on relaunch.
    (System Settings → Privacy & Security → Screen Recording)

-1743
  → Automation was refused. macOS only asks once, so if you dismissed the
    prompt you must enable it by hand.
    (System Settings → Privacy & Security → Automation)
```

Links open in a **dedicated window on a second display**. Chrome needs the CLI
`--new-window` flag — assigning a URL to a newly-made Chrome window through
AppleScript is silently ignored — and the new window is identified by *diffing
window ids*, because moving "window 1" moves whatever happens to be frontmost.
Safari takes `make new document with properties {URL:…}`. Display bounds convert
from Cocoa (bottom-left origin, Y up) to Carbon (top-left, Y down), which needs
the main screen's height, not just a sign flip.

---

## Instagram

Which API you have is written in the first four characters of your token:

- **`IGAA…`** — Instagram Login. `graph.instagram.com`, account addressed as
  `me`; supplying an account id returns 400.
- **`EAA…`** — Facebook Login. `graph.facebook.com`, and the business account id
  is **required**: `me` resolves to the Facebook user and silently returns the
  wrong entity.

The follower endpoint returns **daily deltas, not running totals**. Plotting them
raw gives a flat line near zero. The true curve is reconstructed by
back-accumulating from the current total.

---

## Verification

```bash
npm run verify          # 18 logic checks, no browser needed
npm run build && npm start
npm run verify:visual   # 16 checks against the running app, with screenshots
```

`verify` covers the gold/warning isolation across the whole centredness range,
the exact-zero drift arithmetic, transformation envelope bounds, command
matching, the ⌘K ranking ladder, Instagram back-accumulation, and that injected
command strings resolve to nothing.

`verify:visual` drives the real UI — the ⌘K palette, the on-screen controls — and
checks that the ring renders, that drift is exactly zero in the running app, that
every transformation phase is reached, that the hand presents a panel and the
panel stops moving once it has settled, and that the return completes. It writes
a screenshot per phase.

---

## Architecture

```
src/
  core/         constants (motion vocabulary, palette, worlds, modules), math
  stores/       zustand: system · carousel · gesture · ai · transform · data
  gesture/      MediaPipe tracker, pose and trajectory recognisers, engine
  scene/        rig · carousel · card · atmosphere · presentation clock
    materials/  card frame shader
    post/       bloom · DOF · the colour grade
    human/      anatomy data → SDF → GPU bake → Poisson → beads → hand rig
  audio/        synthesised ambient pad and UI sounds
  ai/           command matcher, speech in and out, bridge client
  server/       bridge (exec · verbs · apps · displays · errors), data adapters
  components/   hud · launcher · panels · boot · fallback
  app/          routes and API handlers
```

Dependencies point one way. The ring does not know the human form exists; cards
publish to a registry that the particle system reads. Adding a module is one
entry in `core/constants/modules.ts`.

---

## Known limits

- **Voice quality** is the browser's own `speechSynthesis`. It plays outside the
  page's audio graph, so the level the jaw follows is *inferred* from word
  boundary events — one pulse per syllable, scaled into the same range an
  analyser produces for a real stream. A studio TTS stream would drop straight
  into the same pipeline.
- **Calendar, sports, projects and music** ship as sample adapters with the same
  shape as the live ones; they need an account to connect to, not new code.
  Music transport works for real through the desktop bridge.
- **Hand tracking** needs a camera grant and downloads the MediaPipe model on
  first use; the pointer is a full fallback and ⌘K needs neither.
- **The figure breathes.** "Holds still" means no drift, no sway and no float —
  the chest moving and the head turning toward you are deliberate, and the only
  motion the figure has.
- **WebGL2 is required** for the figure (the bake reads back float targets).
  Without WebGL at all, the app serves a flat mode with the same live data.
