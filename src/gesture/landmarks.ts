/** MediaPipe hand landmark indices, named. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export interface Pt {
  x: number;
  y: number;
  z: number;
}

export const dist = (a: Pt, b: Pt): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const dist2d = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Hand span — wrist to middle MCP. Every other measurement is divided by this
 * so a hand near the camera and a hand far from it produce the same pinch
 * value. Without it, "pinch" is really "distance from camera".
 */
export const spanOf = (lms: Pt[]): number =>
  Math.max(1e-4, dist2d(lms[LM.WRIST], lms[LM.MIDDLE_MCP]));
