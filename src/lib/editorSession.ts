import type { EditorVoxel } from "@/components/VoxelEditor";

export interface EditorSessionSnapshot {
  active: boolean;
  dirty: boolean;
}

let snapshot: EditorSessionSnapshot = Object.freeze({ active: false, dirty: false });
const listeners = new Set<() => void>();

function publish(next: EditorSessionSnapshot): void {
  if (snapshot.active === next.active && snapshot.dirty === next.dirty) return;
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener();
}

/** Estado estable para `useSyncExternalStore` y supervisores no React. */
export function getEditorSessionSnapshot(): EditorSessionSnapshot {
  return snapshot;
}

export function subscribeEditorSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setEditorSessionActive(active: boolean): void {
  publish(active ? { active: true, dirty: snapshot.dirty } : { active: false, dirty: false });
}

export function setEditorSessionDirty(dirty: boolean): void {
  publish({ active: snapshot.active, dirty: snapshot.active && dirty });
}

function sameVoxel(a: EditorVoxel | undefined, b: EditorVoxel): boolean {
  return !!a
    && a.x === b.x
    && a.y === b.y
    && a.z === b.z
    && a.name === b.name
    && a.phase === b.phase
    && (a.rotation ?? 0) === (b.rotation ?? 0);
}

/** Comparación exacta del documento editable, sin hashes ni riesgo de colisiones. */
export function editorModelsEqual(
  current: ReadonlyMap<string, EditorVoxel>,
  saved: ReadonlyMap<string, EditorVoxel>,
  currentPhaseCount: number,
  savedPhaseCount: number,
): boolean {
  if (currentPhaseCount !== savedPhaseCount || current.size !== saved.size) return false;
  for (const [key, voxel] of current) {
    if (!sameVoxel(saved.get(key), voxel)) return false;
  }
  return true;
}
