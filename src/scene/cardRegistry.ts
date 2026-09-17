import * as THREE from 'three';
import type { ModuleId } from '@/core/constants/modules';
import type { CardFacePainter } from './CardFacePainter';

export interface CardHandle {
  painter: CardFacePainter;
  index: number;
  /**
   * Published every frame by the carousel. The dissolve needs the card's world
   * transform at the instant it samples, so the particles sit on the face
   * PIXEL-FOR-PIXEL while the card is still turning toward the core.
   */
  matrix?: THREE.Matrix4;
}

/**
 * A tiny read-mostly registry. Cards write their handle here; the Phase 7
 * particle system reads. The dependency is one-way on purpose — the ring must
 * not know the human form exists.
 */
class CardRegistry {
  private handles = new Map<ModuleId, CardHandle>();

  register(id: ModuleId, handle: CardHandle): void {
    this.handles.set(id, { ...handle, matrix: new THREE.Matrix4() });
  }

  unregister(id: ModuleId): void {
    this.handles.delete(id);
  }

  publishMatrix(id: ModuleId, m: THREE.Matrix4): void {
    const h = this.handles.get(id);
    if (h?.matrix) h.matrix.copy(m);
  }

  get(id: ModuleId): CardHandle | undefined {
    return this.handles.get(id);
  }

  all(): CardHandle[] {
    return [...this.handles.values()];
  }

  get size(): number {
    return this.handles.size;
  }
}

export const cardRegistry = new CardRegistry();
