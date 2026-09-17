import { MotionRecognizer, PinchLatch, TwoHandRecognizer } from './recognizers';
import { useGestureStore, type GestureName, type HandSnapshot } from '@/stores/useGestureStore';

export interface GestureEvent {
  name: GestureName;
  confidence: number;
  hand: HandSnapshot;
  /** Continuous payload for gestures that carry one (zoom ratio). */
  value?: number;
}

type Listener = (e: GestureEvent) => void;

/**
 * Turns per-frame hand snapshots into discrete gesture events. Pure logic; it
 * knows nothing about the scene. Consumers subscribe and decide what a swipe
 * means in their context — which is what lets the ring ignore ring gestures
 * while NEXUS is embodied without this class knowing embodiment exists.
 */
export class GestureEngine {
  private motion = [new MotionRecognizer(), new MotionRecognizer()];
  private pinch = [new PinchLatch(), new PinchLatch()];
  private twoHand = new TwoHandRecognizer();
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private fire(e: GestureEvent): void {
    useGestureStore.getState().emit(e.name, e.confidence);
    for (const fn of this.listeners) fn(e);
  }

  update(hands: [HandSnapshot, HandSnapshot], now: number): void {
    for (let i = 0; i < 2; i++) {
      const hand = hands[i];
      if (!hand.present) {
        this.motion[i].reset();
        if (this.pinch[i].isHeld) {
          this.pinch[i].reset();
          // A hand that vanishes mid-pinch must still produce a release, or
          // whatever it was holding is held forever.
          this.fire({ name: 'release', confidence: 0.4, hand });
        }
        continue;
      }

      const latched = this.pinch[i].update(hand.pinch);
      if (latched) this.fire({ name: latched, confidence: hand.pinch, hand });

      this.motion[i].push(hand, now);
      const detected = this.motion[i].detect(hand, now);
      if (detected) this.fire({ ...detected, hand });
    }

    const two = this.twoHand.detect(hands[0], hands[1], now);
    if (two) this.fire({ name: two.name, confidence: two.confidence, hand: hands[0], value: two.value });
  }

  reset(): void {
    this.motion.forEach((m) => m.reset());
    this.pinch.forEach((p) => p.reset());
    this.twoHand.reset();
  }
}

export const gestureEngine = new GestureEngine();
