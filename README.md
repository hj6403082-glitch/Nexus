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
sample data and say so on the card face.

**For the AI, the easiest path needs no key at all:**

```bash
ollama pull llama3.2 && ollama serve
```

NEXUS auto-detects it and prefers local. `curl localhost:3000/api/ai` tells you
which brain is running and why; the HUD shows it too, bottom right.
The desktop bridge is off unless you turn it on.

---

## What is actually here

Built in seven passes, each extending the last rather than replacing it.

| | |
|---|---|
| **1 — Foundation** | The room, the ring, ten glass cards with live data, MediaPipe hand tracking, hover/select/drag on hand or pointer, spring physics, adaptive quality, synthesised audio, a four-corner HUD. |
| **2 — AI brain** | Streaming from a local Ollama model or from Gemini behind one server-side endpoint, `SpeechRecognition` with barge-in interruption, speech that starts before the response finishes, holographic text that assembles from scattered words. |
| **3 — Knowledge** | Real adapters for Instagram, stocks, weather and news; sample adapters for the rest. The System module reads the actual machine — CPU, GPU, battery, network, memory, storage. Opening a module raises a 3D stage: a chart that stands up off the floor, a deck of articles you swipe through, a constellation of project worlds. Every figure carries provenance and age. |
| **4 — Worlds** | Six named environments switchable by voice or ⌘K, a weather world with real precipitation, a Stocks world whose floor becomes a live market grid, cinematic module transitions, light trails on every gesture, cards that ripple when struck, a fill light that responds to speech and gesture, two-hand zoom / group / split / multi-select. |
| **5 — Desktop bridge** | A hardened local API that launches apps, opens windows on a chosen display, and drives media — macOS only, off by default. A ⌘K palette over apps, sites and commands. |
| **6 — Stillness** | Ambient motion off by default and gated on a multiplier; one master clock for module presentation; six filmic colour grades; gold for the centred card, isolated from warning orange. |
| **7 — The human form** | The cards dissolve into particles, gather, and reassemble as a signed-distance bust that breathes, watches you, speaks, and presents panels from its hand. |

### Commands

Type ⌘K, or say them once voice is enabled (wake word: *"Nexus"*, or draw a
circle in the air).

```
open stocks · show my reels · rotate left · what's my schedule
how is Nvidia today · summarise today's AI news · explain MCP
take me to the fog chamber · switch to the ocean platform
transform into a human shape · return to spatial mode
lock · drift · open Spotify · search WebGPU
```

Pointer: hover a card to raise it, drag it off its slot and let go to send it
home, click to open it.

Keyboard, with no pointer at all: `←` `→` rotate · `Enter` open the centred
module · `Esc` close · `↑` `↓` page the news deck · `h` HUD · `m` ambient
motion · `⌘K` everything.

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
white and the result reads as an *outline* of a person.

**The beads arrive; a raymarched surface takes over.** Thirty-two thousand
beads over a bust is 3.2 mm of spacing, and a lip is 8 mm thick — so the
particles are the right thing to *watch arrive* and the wrong thing to then
look at, because every feature is one to three dots wide. Once they have
landed, the same field is raymarched per pixel instead of per bead: exact
silhouette, gradient normals, and occlusion and shadows marched live so the
sockets and the mouth actually have dark in them. The two cross-fade, so what
you see is a cloud *resolving* into a body rather than one object being swapped
for another. Tier 0 keeps the beads and never pays for the march.

**The head is a mask, not a reconstruction.** Five passes tried to sculpt a
naturalistic face out of blended primitives and each traded one deformity for
another — a carve that fixed the profile bored a third socket in the forehead;
lip masses that gave the mouth substance read as a muzzle. A viewer's tolerance
for error in a human face is about a millimetre, and every smooth-minimum is a
surface bulging by a fraction of its blend radius in a direction nobody chose.
So the geometry carries *form* — brow, cheekbones, nose, jaw — and the fine
line work (mouth, nostrils, orbital crease) is **drawn in the shader**, where
it cannot fragment or gouge. The proportions are anthropometric even though the
surface is deliberately not.

**`npm run face`** writes a standalone page that raymarches the same field with
the same lights, so the head can be judged in seconds instead of through a
build, a bake and an eight-phase sequence.

**One clock per sequence, and every layer reads from it.** The presentation
choreography and the transformation each have exactly one number advancing;
cards, camera, post chain and figure are pure functions of it and write nothing
back. The return is the transformation clock run backward at 1.7×, not a second
choreography to keep in sync.

**One picker for both inputs.** Hand tracking and the pointer both resolve to
a direction from the eye, so they go down one code path that raycasts the ring
and publishes a single world-space cursor. Two pickers would mean two notions of
what is hovered, and they would disagree the first time a hand appeared while
the mouse was still over a card. A dragged card chases that cursor on an
under-damped spring, so it trails the hand, overshoots when the hand stops, and
settles elastically — and on release the target simply becomes its orbit slot
again and the same spring carries it home. No physics simulation is involved:
a thrown card has to be found again, and "where did it go" is a chore, not an
interaction.

**Saturation above 1.0 can produce NaN, and NaN renders as a hole.** Mixing
toward grey with a factor above one extrapolates *away* from grey, which drives
the weakest channel of a strongly saturated colour below zero. Cyan type on a
dark card is the worst case: its red channel lands at about −0.035 at saturation
1.10. Nothing downstream minds until the final sRGB encode, where a fractional
power of a negative base is NaN — so the headline figure and the sparkline were
simply *erased* from a focused card, worst in the highest-saturation worlds,
while the duller white text survived. Same family as `safePow` in
`core/math/util.ts`. The grade clamps after saturation now, and the visual suite
checks a card in Market Grid specifically, because Minimal Studio sits at
saturation 1.0 and never showed it.

**Halation is its own pass, and it has to be.** It reads neighbouring texels,
which makes it a convolution, and `postprocessing` needs
`EffectAttribute.CONVOLUTION` to give such an effect a pass of its own. Merged
into the colour grade without it, it read and wrote the same buffer in one pass
— undefined behaviour, and the driver's answer was a directional feedback that
ATE thin bright features. A focused card's headline figure and sparkline were
progressively erased while the duller body text survived. Every store reported a
perfectly open, perfectly painted card. Only the frame buffer knew, which is why
`scripts/png.mjs` exists and the visual suite now counts pixels.

**The depth of field follows the subject.** A fixed focus distance is only
correct while nothing moves, and opening a module moves both the card and the
camera. Pinned to the resting ring radius, a focused card ended up inside the
near field.

**Spring physics everywhere, named by intent.** `MOTION.ARRIVING`,
`LEAVING`, `ACKNOWLEDGING`, `REPORTING`, `DRIFTING` — and one `BEAT` constant
that every duration in the app is a multiple of. There is no `lerp(a, b, 0.1)`
in the scene graph.

---

## Two brains, one endpoint

`POST /api/ai` streams newline-delimited JSON — `{t}` for a token, `{call}` for
a tool call, `{error}` for a failure — and the client never learns which
provider produced it. Adding a third backend is a file in `src/server/ai`, not
a change to the speech pipeline, the holographic text or the tool dispatch.
There is a test asserting both providers emit *byte-identical* events for the
same answer, because that equivalence is the whole point and it is the kind of
thing that rots silently.

**Local wins by default.** With `NEXUS_AI_PROVIDER` unset, NEXUS probes Ollama
with a short timeout and uses it if it answers. A local model costs nothing per
token, needs no credential, works on a plane, and keeps the conversation on the
machine — for an assistant you talk to continuously that matters more than the
last few points of benchmark. If the configured model is not pulled but others
are, it uses one of those rather than failing.

Three provider facts worth knowing, all three learned or confirmed by running
the **real Ollama server** (built from source — its release binaries and model
registry are both unreachable from the build environment, so the token stream
and tool calls are still validated against a stand-in speaking its documented
protocol, but everything below came from the genuine article):

- **Running is not the same as ready.** A fresh Ollama with nothing pulled
  answers `/api/tags` with `{"models":[]}` — a perfectly successful response
  carrying an empty list. Treating "reachable" as "usable" committed NEXUS to a
  backend that would 404 every question with `model 'llama3.2' not found`, and
  it did so even when a working Gemini key was sitting right there. An empty
  Ollama now falls through to Gemini, and only says what to pull when there is
  nothing to fall through to. A stand-in never produced this case, because a
  stand-in always has models.

Two more, both covered by tests:

- **Ollama hands back tool arguments already parsed**, as an object. OpenAI-compatible
  APIs hand back a JSON string. Trusting either one alone breaks the other, so
  the parser accepts both.
- **Gemini's REST endpoint accepts exactly one credential shape** — an AI Studio
  key, `AIzaSy…`. An OAuth token (`ya29.`, `AQ.`) or a service account JSON is a
  perfectly valid Google credential for a *different* mechanism, and Google
  answers with a bare `400` that says none of this. NEXUS names the mismatch
  before spending the round trip, and every such message offers the no-key way
  out.

## When it breaks

NEXUS is one large WebGL surface, and WebGL has failure modes ordinary React
does not: a shader that will not compile on some driver, a buffer that will not
allocate, a context the browser takes back. Any of those throws inside the
render loop and takes the whole page white — stranding you with no route to
data that is still perfectly available over HTTP.

So the scene is wrapped. It falls back to flat mode with the same live modules
and ⌘K still working, and it names the real cause. A lost context in particular
makes every WebGL call start returning null, so React usually throws a
null-property error in the same frame the loss fires; reporting *that* would
show you `Cannot read properties of null (reading 'alpha')`, which is true,
useless and alarming. The boundary checks whether the context is the known
cause and says so instead. There is a regression check that deliberately
destroys the context and asserts all three things.

The camera and microphone are released when the hook unmounts, not only when
you press the button again — a privacy problem before it is a resource one, and
one you would notice in your menu bar long before a profiler.

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
npm run lint:shaders    # a backtick in a shader comment ends the literal
npm run verify          # shader lint + 34 logic checks, no browser needed
npm run build && npm start
npm run verify:visual   # 33 checks against the running app, with screenshots
```

The logic suite is 34 checks; the visual suite is 33.

`verify` covers the gold/warning isolation across the whole centredness range,
the exact-zero drift arithmetic, transformation envelope bounds, command and
environment matching, the ⌘K ranking ladder, weather-condition mapping,
Instagram back-accumulation, that multi-select is told apart from zoom by dwell
rather than by pose, that the System card degrades to "unavailable" rather than
disappearing on a browser without the Battery API, and that injected command
strings resolve to nothing.

`lint:shaders` exists because a backtick inside a GLSL comment silently ends
the template literal, and the error it produces points at a line of shader code
and says nothing about quoting. It cost three builds before it became a lint.

`verify:visual` drives the real UI — the ⌘K palette, the pointer, the on-screen
controls — and checks that the ring renders, that drift is exactly zero in the
running app, that a card hovers and drags and actually leaves its slot, that a
click opens its module and raises the 3D stage, that environments switch by
name, that every transformation phase is reached, that the hand presents a panel
and the panel stops moving once it has settled, and that the return completes.
It also decodes the frame buffer and counts bright saturated pixels on a focused
card, because the halation bug above was invisible to every state-based check.
It writes a screenshot per phase.

---

## Architecture

```
src/
  core/         constants (motion vocabulary, palette, worlds, modules), math
  stores/       zustand: system · carousel · gesture · ai · transform · data
  gesture/      MediaPipe tracker, pose and trajectory recognisers, engine
  scene/        rig · carousel · card · picker · trails · presentation clock
    env/        weather conditions and precipitation
    focus/      what a module becomes once open: chart · news deck · worlds
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

## Deviations from the brief

Two of these are deliberate; please push back if you disagree.

- **Rapier is not used, and no card is ever handed to a physics engine.** Phase 1
  lists it, and Phase 6 then says released cards return directly to their orbit
  slot and instructs that all thrown/recalling physics code be removed. Phase 6
  supersedes, so the dependency would have been dead weight.
- **React Spring and Valtio are not used, and are not dependencies.** Framer
  Motion covers the DOM and the analytic springs in `core/math/spring.ts` cover
  the scene — frame-rate independent, allocation-free, and usable inside the
  render loop rather than through React state. Carrying a second animation
  library for the same job is how a codebase ends up with two notions of how
  fast something should feel. Valtio was optional in the brief. Say the word and
  React Spring goes back in.
- GSAP, Lenis and drei **are** used, each where it is the right tool: GSAP drives
  the boot timeline (one seekable, killable object instead of a chain of
  `setTimeout`s), Lenis smooths the two surfaces that scroll, and drei's `<Line>`
  draws the gesture trails, because a raw WebGL line is one pixel wide on every
  GPU at every distance.

## Known limits

- **Voice quality** is the browser's own `speechSynthesis`. It plays outside the
  page's audio graph, so the level the jaw follows is *inferred* from word
  boundary events — one pulse per syllable, scaled into the same range an
  analyser produces for a real stream. A studio TTS stream would drop straight
  into the same pipeline.
- **Calendar, sports, projects and music** ship as sample adapters with the same
  shape as the live ones; they need an account to connect to, not new code.
  Music transport works for real through the desktop bridge. The project worlds
  render whatever descriptions, media counts, prompt history and repository
  links the adapter returns.
- **Hand tracking** needs a camera grant and downloads the MediaPipe model on
  first use; the pointer is a full fallback and ⌘K needs neither.
- **The figure breathes.** "Holds still" means no drift, no sway and no float —
  the chest moving and the head turning toward you are deliberate, and the only
  motion the figure has.
- **Project media are listed, not played.** The project worlds carry the names
  and counts the adapter returns; there is no video surface in the scene yet.
- **AI responses assemble word by word, not particle by particle.** Each word
  arrives from a scattered position with its own blur and settles into the line.
  A literal per-glyph particle assembly would need the text rasterised into the
  Phase 7 buffer, which is a larger change than it looks.
- **Glass does not bend.** Cards ripple, particles react and the fill light
  responds, but there is no refraction pass distorting what is behind a card.
- **WebGL2 is required** for the figure (the bake reads back float targets).
  Without WebGL at all, the app serves a flat mode with the same live data.
