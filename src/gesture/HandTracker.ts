import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { EMPTY_HAND, type HandSnapshot } from '@/stores/useGestureStore';
import { snapshotFrom } from './recognizers';
import type { Pt } from './landmarks';

const WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export interface TrackerEvents {
  onHands: (hands: [HandSnapshot, HandSnapshot]) => void;
  onState: (
    state: 'starting' | 'live' | 'lost' | 'denied' | 'unsupported' | 'off',
    detail?: string,
  ) => void;
}

/**
 * Owns the camera stream and the MediaPipe graph. Deliberately NOT a React
 * hook: the graph is expensive, is not double-mount safe, and must outlive any
 * individual component. One instance, explicit start/stop.
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private lastVideoTime = -1;
  private running = false;
  private missFrames = 0;

  constructor(private events: TrackerEvents) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.events.onState('starting');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.running = false;
      this.events.onState('unsupported', 'no camera API in this browser');
      return;
    }

    try {
      // Imported lazily: the WASM bundle is large and the app must boot and be
      // usable on the pointer fallback long before tracking is asked for.
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      this.running = false;
      this.events.onState('unsupported', describe(err));
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      this.running = false;
      this.events.onState('denied', describe(err));
      return;
    }

    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = this.stream;
    await video.play();
    this.video = video;

    this.events.onState('live');
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.events.onHands([EMPTY_HAND, EMPTY_HAND]);
    this.events.onState('off');
  }

  get isRunning(): boolean {
    return this.running;
  }

  private loop = (): void => {
    if (!this.running || !this.video || !this.landmarker) return;
    this.raf = requestAnimationFrame(this.loop);

    const video = this.video;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    let result;
    try {
      result = this.landmarker.detectForVideo(video, performance.now());
    } catch {
      return; // A dropped inference frame is not an error worth surfacing.
    }

    const out: [HandSnapshot, HandSnapshot] = [EMPTY_HAND, EMPTY_HAND];
    const found = result.landmarks ?? [];

    for (let i = 0; i < Math.min(2, found.length); i++) {
      out[i] = snapshotFrom(found[i] as unknown as Pt[]);
    }

    if (found.length === 0) {
      // Hands flicker out for a frame or two constantly. Reporting "lost"
      // immediately makes the HUD strobe; wait for a real absence.
      if (++this.missFrames === 30) this.events.onState('lost');
    } else {
      if (this.missFrames >= 30) this.events.onState('live');
      this.missFrames = 0;
    }

    this.events.onHands(out);
  };
}

function describe(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'camera permission denied';
    if (err.name === 'NotFoundError') return 'no camera found';
    return err.name;
  }
  return err instanceof Error ? err.message : String(err);
}
