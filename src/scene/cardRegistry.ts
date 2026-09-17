import * as THREE from 'three';
import type { ModuleId } from '@/core/constants/modules';
import type { CardFacePainter } from './CardFacePainter';

export interface CardHandle {
  painter: CardFacePainter;
  index: number;
  /** The face mesh, for picking. */
  mesh?: THREE.Object3D;
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

  attachMesh(id: ModuleId, mesh: THREE.Object3D): void {
    const h = this.handles.get(id);
    if (h) h.mesh = mesh;
  }

  /** Every card face currently in the scene, for the picker's raycast. */
  pickTargets(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const h of this.handles.values()) if (h.mesh) out.push(h.mesh);
    return out;
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
