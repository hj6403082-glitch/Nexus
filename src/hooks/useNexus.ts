'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { matchCommand, EMBODIED_GREETING, TRANSFORM_ACK, type Command } from '@/ai/commands';
import { Listener, speaker } from '@/ai/speech';
import { audio } from '@/audio/AudioEngine';
import { gestureEngine, type GestureEvent } from '@/gesture/GestureEngine';
import { HandTracker } from '@/gesture/HandTracker';
import { useAIStore } from '@/stores/useAIStore';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useGestureStore } from '@/stores/useGestureStore';
import { STATIC_MODE, useModuleData } from '@/stores/useModuleData';
import { useSystemStore } from '@/stores/useSystemStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { MODULES, MODULE_BY_ID, type ModuleId } from '@/core/constants/modules';
import { DEFAULT_WORLD, WORLDS } from '@/core/constants/worlds';
import { callBridge } from '@/ai/bridgeClient';

/**
 * The orchestrator. Everything that turns an INTENT — spoken, gestured or
 * typed — into a change in the world happens here, in one place, so there is a
 * single answer to "what does this command do".
 */
export function useNexus() {
  const trackerRef = useRef<HandTracker | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const speakQueue = useRef<string>('');

  // ---- speaking -----------------------------------------------------------
  const say = useCallback((text: string) => {
    speaker.speak(text, () => {
      const ai = useAIStore.getState();
      if (ai.status === 'speaking') ai.setStatus('idle');
    });
  }, []);

  const interrupt = useCallback(() => {
    speaker.cancel();
    useAIStore.getState().setStatus('interrupted');
    audio.play('tick', 0.5);
    // A momentary state, not a resting one: it exists so the HUD can show that
    // the interruption registered, then it gets out of the way.
    setTimeout(() => {
      const ai = useAIStore.getState();
      if (ai.status === 'interrupted') ai.setStatus('listening');
    }, 260);
  }, []);

  // ---- the model ----------------------------------------------------------
  const ask = useCallback(async (text: string) => {
    const ai = useAIStore.getState();
    ai.appendUser(text);
    ai.setStatus('thinking');
    ai.setError(null);

    const focus = ai.focusModule;
    const focusData = focus ? useModuleData.getState().records[focus]?.detail : null;

    let response: Response;
    try {
      response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          history: useAIStore
            .getState()
            .history.map((t) => ({ role: t.role, text: t.text })),
          focusModule: focus,
          focusData,
        }),
      });
    } catch {
      ai.setStatus('offline');
      ai.setError('cannot reach the model');
      return;
    }

    if (!response.ok || !response.body) {
      const detail = (await response.json().catch(() => null)) as { error?: string } | null;
      ai.setStatus('offline');
      ai.setError(detail?.error ?? `model unavailable (${response.status})`);
      return;
    }

    const turnId = ai.beginModel();
    ai.setStatus('streaming');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    speakQueue.current = '';

    /**
     * SPEECH BEGINS BEFORE THE RESPONSE IS COMPLETE. Tokens are accumulated
     * only as far as the first sentence boundary, then spoken. Waiting for the
     * full response means the pause before NEXUS starts talking is the entire
     * generation latency, which is the single most damaging thing to the
     * illusion that it is present in the room.
     */
    const flushSentence = () => {
      const match = speakQueue.current.match(/^(.+?[.!?])(\s|$)/s);
      if (!match) return;
      const sentence = match[1].trim();
      speakQueue.current = speakQueue.current.slice(match[0].length);
      if (sentence) say(sentence);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let event: { t?: string; call?: { name: string; args: Record<string, string> }; error?: string };
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.error) {
          useAIStore.getState().setError(event.error);
          continue;
        }
        if (event.t) {
          useAIStore.getState().appendToken(turnId, event.t);
          speakQueue.current += event.t;
          if (!window.speechSynthesis?.speaking) flushSentence();
        }
        if (event.call) handleToolCall(event.call);
      }
    }

    // Anything left that never hit a sentence boundary still gets spoken.
    if (speakQueue.current.trim()) say(speakQueue.current.trim());
    speakQueue.current = '';
    useAIStore.getState().endTurn(turnId);
    if (useAIStore.getState().status === 'streaming') {
      useAIStore.getState().setStatus('idle');
    }
  }, [say]);

  // ---- commands -----------------------------------------------------------
  const openModule = useCallback((id: ModuleId) => {
    const def = MODULE_BY_ID[id];
    void useModuleData.getState().load(id);
    useAIStore.getState().setFocusModule(id);
    useSystemStore.getState().setWorld(def.world ?? DEFAULT_WORLD);
    useSystemStore.getState().pushLog(`present · ${def.label}`);

    // While embodied there is no ring, so modules are PRESENTED, not opened.
    if (useTransformStore.getState().phase !== 'NORMAL') {
      presentInHand(id);
      return;
    }
    useCarouselStore.getState().present(id);
  }, []);

  const run = useCallback(
    (command: Command) => {
      const embodied = useTransformStore.getState().phase !== 'NORMAL';
      const system = useSystemStore.getState();

      switch (command.kind) {
        case 'open':
          openModule(command.module);
          return;

        case 'rotate':
          // "Rotate" is REFUSED while embodied — there is no ring to rotate,
          // and silently doing nothing would read as a failure to hear.
          if (embodied) {
            say('There is no ring while I am in this form.');
            system.pushLog('rotate refused · no ring', 'warn');
            return;
          }
          useCarouselStore.getState().rotate(command.direction);
          audio.play('tick');
          return;

        case 'close':
          useCarouselStore.getState().close();
          useAIStore.getState().setFocusModule(null);
          system.setWorld(DEFAULT_WORLD);
          audio.play('close');
          return;

        case 'transform':
          if (command.to === 'human') beginTransform(say);
          else {
            useTransformStore.getState().returnToSpatial();
            system.pushLog('returning to spatial mode');
          }
          return;

        case 'lock': {
          // "lock on" means ambient drift off.
          const wantDrift = !command.on;
          if (system.driftEnabled !== wantDrift) system.toggleDrift();
          return;
        }

        case 'launch':
          void callBridge({ verb: 'launch_app', app: command.app }).then((r) => {
            system.pushLog(r.ok ? `launched ${command.app}` : r.message, r.ok ? 'ok' : 'warn');
            if (!r.ok) say(r.message);
          });
          return;

        case 'browse':
          void callBridge({ verb: 'open_url', query: command.query }).then((r) => {
            system.pushLog(r.ok ? r.message : r.message, r.ok ? 'ok' : 'warn');
            if (!r.ok) say(r.message);
          });
          return;

        case 'media':
          void callBridge({ verb: 'media', action: command.verb }).then((r) => {
            if (!r.ok) system.pushLog(r.message, 'warn');
          });
          return;

        case 'environment':
          system.setWorld(command.world);
          system.pushLog(`world · ${WORLDS[command.world].label.toLowerCase()}`, 'ok');
          audio.play('open', 0.5);
          return;

        case 'ask':
          void ask(command.text);
          return;
      }
    },
    [ask, openModule, say],
  );

  const submit = useCallback((text: string) => run(matchCommand(text)), [run]);

  // ---- gestures -----------------------------------------------------------
  useEffect(() => {
    const unsubscribe = gestureEngine.subscribe((event: GestureEvent) => {
      const embodied = useTransformStore.getState().phase !== 'NORMAL';
      const carousel = useCarouselStore.getState();

      audio.play('gesture', Math.min(1, event.confidence));

      /**
       * A DELIBERATE gesture cancels the presentation sequence — but COMMITS
       * the pending open. Cancelling the choreography must never cancel the
       * user's intent: they asked for the module, they get the module, just
       * without the flourish.
       */
      const deliberate =
        event.name === 'swipe-left' ||
        event.name === 'swipe-right' ||
        event.name === 'pinch' ||
        event.name === 'push';
      if (deliberate && carousel.presentPhase !== 'none') {
        carousel.cancelPresentation();
      }

      // The wake gesture and the tracking lifecycle always pass. Everything
      // that acts on the ring is ignored when there is no ring.
      if (event.name === 'circle') {
        wake();
        return;
      }
      if (embodied) return;

      switch (event.name) {
        case 'swipe-left':
          carousel.rotate(-1);
          break;
        case 'swipe-right':
          carousel.rotate(1);
          break;
        case 'pinch': {
          const target = carousel.hovered ?? centredModule();
          if (target) carousel.setDragging(target);
          break;
        }
        case 'release': {
          /**
           * Released cards return DIRECTLY to their orbit slot on the orbit
           * spring. They are never handed to a physics simulation — a thrown
           * card has to be found again, and "where did it go" is not an
           * interaction, it is a chore.
           */
          const dragged = carousel.dragging;
          carousel.setDragging(null);
          if (dragged) audio.play('confirm', 0.4);
          break;
        }
        case 'pull': {
          const target = carousel.hovered ?? centredModule();
          if (target) {
            carousel.toggleExpanded(target, true);
            audio.play('open', 0.6);
          }
          break;
        }
        case 'push': {
          const target = carousel.hovered ?? centredModule();
          if (target) {
            carousel.toggleExpanded(target, false);
            audio.play('close', 0.5);
          }
          break;
        }
        case 'palm-hold':
          // An open palm held still also clears a multi-selection: the same
          // "stop" gesture that freezes the ring lets go of what is held.
          if (useCarouselStore.getState().selected.size > 0) {
            useCarouselStore.getState().clearSelection();
          }
          carousel.setFrozen(!carousel.frozen);
          useSystemStore
            .getState()
            .pushLog(carousel.frozen ? 'motion frozen' : 'motion resumed', 'ok');
          break;
        /**
         * Two hands reshape the RING, they do not throw things in it. Zoom
         * pulls the whole orbit toward or away from you; group and split
         * tighten or fan the angular spacing so a cluster can be read at once.
         */
        case 'two-hand-zoom':
          if (event.value) carousel.zoom(event.value > 1 ? 0.97 : 1.03);
          break;
        /**
         * Multi-select takes the cards spanned BETWEEN the two hands. The span
         * is an angle on the ring, not a screen rectangle: the ring is a
         * circle around you, so "between my hands" means an arc.
         */
        case 'two-hand-multi-select': {
          const hands = useGestureStore.getState().hands;
          const from = Math.min(hands[0].x, hands[1].x);
          const to = Math.max(hands[0].x, hands[1].x);
          const spanned = MODULES.filter((mod, i) => {
            const worldAngle =
              (i / MODULES.length) * Math.PI * 2 * carousel.spread + carousel.angle;
            // Only cards in front of the user can be spanned; the ones behind
            // are not on screen to be pointed at.
            if (Math.cos(worldAngle) < 0.1) return false;
            const screenX = Math.sin(worldAngle) / Math.max(0.2, Math.cos(worldAngle));
            return screenX >= from - 0.15 && screenX <= to + 0.15;
          }).map((mod) => mod.id);

          if (spanned.length > 0) {
            carousel.selectSpan(spanned);
            audio.play('confirm', 0.7);
            useSystemStore
              .getState()
              .pushLog(`${spanned.length} selected · ${spanned.join(', ')}`, 'ok');
          } else {
            carousel.clearSelection();
          }
          break;
        }

        case 'two-hand-split':
          carousel.setSpread(useCarouselStore.getState().spread * 1.18);
          useSystemStore.getState().pushLog('cards fanned', 'ok');
          break;
        case 'two-hand-group':
          carousel.setSpread(useCarouselStore.getState().spread * 0.82);
          useSystemStore.getState().pushLog('cards grouped', 'ok');
          break;
      }
    });
    return unsubscribe;
  }, []);

  // Feed hand snapshots into the engine each animation frame.
  useEffect(() => {
    let raf = 0;
    const pump = () => {
      raf = requestAnimationFrame(pump);
      const hands = useGestureStore.getState().hands;
      if (hands[0].present || hands[1].present) {
        gestureEngine.update(hands, performance.now());
      }
    };
    pump();
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- tracking lifecycle -------------------------------------------------
  const startTracking = useCallback(() => {
    if (trackerRef.current?.isRunning) return;
    const tracker = new HandTracker({
      onHands: (hands) => useGestureStore.getState().setHands(hands),
      onState: (state, detail) => {
        useGestureStore.getState().setTracking(state);
        if (detail) useSystemStore.getState().pushLog(`tracking · ${detail}`, 'warn');
      },
    });
    trackerRef.current = tracker;
    void tracker.start();
  }, []);

  const stopTracking = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    gestureEngine.reset();
  }, []);

  // ---- voice --------------------------------------------------------------
  const startListening = useCallback(() => {
    if (!listenerRef.current) {
      listenerRef.current = new Listener({
        onFinal: (text) => {
          useAIStore.getState().setInterim('');
          // The wake phrase. Heard locally, acted on locally.
          if (/^\s*(hey\s+)?nexus\b/i.test(text)) {
            wake();
            const rest = text.replace(/^\s*(hey\s+)?nexus[,.!]?\s*/i, '');
            if (rest.trim()) submit(rest);
            return;
          }
          if (!useAIStore.getState().awake) return;
          submit(text);
        },
        onBargeIn: interrupt,
      });
    }
    listenerRef.current.start();
  }, [interrupt, submit]);

  const stopListening = useCallback(() => {
    listenerRef.current?.stop();
    useAIStore.getState().setStatus('idle');
  }, []);

  /**
   * Release the camera and the microphone when this hook goes away.
   *
   * They were only ever stopped by the user pressing the button again, so an
   * unmount left the capture running — the camera indicator stays lit, the
   * MediaPipe graph keeps inferring, and the page is still listening. That is
   * a privacy problem before it is a resource one, and it is the kind of thing
   * a user notices in their menu bar long before they notice it in a profile.
   */
  useEffect(
    () => () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      listenerRef.current?.stop();
      listenerRef.current = null;
      speaker.cancel();
      gestureEngine.reset();
    },
    [],
  );

  // ---- boot ---------------------------------------------------------------
  useEffect(() => {
    // Ask which brain is available before the first question rather than
    // after it, so the HUD can say "offline" up front instead of the user
    // discovering it by being ignored.
    if (STATIC_MODE) {
      // No server, so no brain. Say so plainly rather than failing a fetch.
      useAIStore.getState().setProvider({
        name: 'none',
        model: '',
        reason: 'Static preview — run NEXUS locally for voice and chat.',
      });
      useAIStore.getState().setStatus('offline');
      useSystemStore.getState().pushLog('static preview · ai offline', 'warn');
    } else {
    void fetch('/api/ai')
      .then((r) => r.json())
      .then((info: { provider: string; model: string; reason: string }) => {
        useAIStore.getState().setProvider({
          name: info.provider,
          model: info.model,
          reason: info.reason,
        });
        if (info.provider === 'none') {
          useAIStore.getState().setStatus('offline');
          useSystemStore.getState().pushLog(info.reason, 'warn');
        } else {
          useSystemStore
            .getState()
            .pushLog(`brain · ${info.provider}${info.model ? ` · ${info.model}` : ''}`, 'ok');
        }
      })
      .catch(() => {
        useAIStore.getState().setStatus('offline');
      });
    }

    void useModuleData.getState().loadAll();
    const interval = setInterval(() => {
      void useModuleData.getState().loadAll();
    }, 90_000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Open whatever is currently centred.
   *
   * The ring could be ROTATED by keyboard but not OPENED, which made it
   * navigable and useless without a pointer. This is the missing half.
   */
  const openCentred = useCallback(() => {
    const target = useCarouselStore.getState().hovered ?? centredModule();
    if (target) openModule(target);
  }, [openModule]);

  return useMemo(
    () => ({
      submit,
      openCentred,
      run,
      say,
      ask,
      openModule,
      startTracking,
      stopTracking,
      startListening,
      stopListening,
      interrupt,
    }),
    [
      submit,
      openCentred,
      run,
      say,
      ask,
      openModule,
      startTracking,
      stopTracking,
      startListening,
      stopListening,
      interrupt,
    ],
  );
}

/** The card currently facing the user. */
function centredModule(): ModuleId | null {
  const { angle } = useCarouselStore.getState();
  let best: ModuleId | null = null;
  let bestFacing = -Infinity;
  MODULES.forEach((m, i) => {
    const facing = Math.cos((i / MODULES.length) * Math.PI * 2 + angle);
    if (facing > bestFacing) {
      bestFacing = facing;
      best = m.id;
    }
  });
  return best;
}

function wake(): void {
  const ai = useAIStore.getState();
  if (ai.awake) return;
  ai.wake(true);
  audio.play('wake');
  useSystemStore.getState().pushLog('nexus awake', 'ok');
}

/**
 * The command lands and the room begins to dim in the same breath. The fixed
 * line is spoken immediately, and BOTH SIDES are recorded into the model's
 * history — so a later "why did you do that" has something to refer to, rather
 * than a gap where the most dramatic thing NEXUS has ever done should be.
 */
function beginTransform(say: (text: string) => void): void {
  const transform = useTransformStore.getState();
  if (transform.phase !== 'NORMAL') return;

  transform.begin();
  useSystemStore.getState().pushLog('transforming · human form', 'ok');
  audio.play('wake', 0.9);

  const ai = useAIStore.getState();
  ai.appendUser('Nexus, transform into a human shape.');
  const turn = ai.beginModel();
  ai.appendToken(turn, TRANSFORM_ACK);
  ai.endTurn(turn);
  say(TRANSFORM_ACK);

  // The greeting lands when the eyes settle, not when the clock starts.
  const check = setInterval(() => {
    if (useTransformStore.getState().phase === 'HUMANOID_ACTIVE') {
      clearInterval(check);
      say(EMBODIED_GREETING[0]);
      setTimeout(() => say(EMBODIED_GREETING[1]), 1400);
    }
    if (useTransformStore.getState().phase === 'NORMAL') clearInterval(check);
  }, 250);
}

/**
 * The presentation gesture: the hand rises with the panel above its open palm,
 * holds for a beat, opens its fingers, and lowers away. The panel then lifts to
 * its place beside the figure and stays.
 */
function presentInHand(id: ModuleId): void {
  useTransformStore.getState().presentGesture();
  useSystemStore.getState().pushLog(`presenting · ${MODULE_BY_ID[id].label}`);
}

function handleToolCall(call: { name: string; args: Record<string, string> }): void {
  if (call.name === 'transform_form') {
    if (call.args.to === 'human') useTransformStore.getState().begin();
    else useTransformStore.getState().returnToSpatial();
    return;
  }
  if (call.name === 'open_module') {
    const id = call.args.module as ModuleId;
    if (MODULE_BY_ID[id]) {
      useAIStore.getState().setFocusModule(id);
      if (useTransformStore.getState().phase === 'NORMAL') {
        useCarouselStore.getState().present(id);
      } else {
        presentInHand(id);
      }
    }
  }
}
