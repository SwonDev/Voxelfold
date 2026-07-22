import test from "node:test";
import assert from "node:assert/strict";
import {
  editorModelsEqual,
  getEditorSessionSnapshot,
  setEditorSessionActive,
  setEditorSessionDirty,
  subscribeEditorSession,
} from "../../src/lib/editorSession.ts";

const voxel = (name = "Rock_Stone", rotation = 0) => ({
  x: 1,
  y: 2,
  z: 3,
  name,
  phase: 0,
  rotation,
});

test("editorModelsEqual compara contenido, rotación y número de fases", () => {
  const saved = new Map([["1,2,3", voxel()]]);
  assert.equal(editorModelsEqual(new Map(saved), saved, 1, 1), true);
  assert.equal(editorModelsEqual(new Map([["1,2,3", voxel("Rock_Stone", 1)]]), saved, 1, 1), false);
  assert.equal(editorModelsEqual(new Map(saved), saved, 2, 1), false);
  assert.equal(editorModelsEqual(new Map(), saved, 1, 1), false);
});

test("la sesión global nunca conserva dirty al cerrar el editor", () => {
  const observations: string[] = [];
  const unsubscribe = subscribeEditorSession(() => {
    const state = getEditorSessionSnapshot();
    observations.push(`${state.active}:${state.dirty}`);
  });

  setEditorSessionActive(true);
  setEditorSessionDirty(true);
  assert.deepEqual(getEditorSessionSnapshot(), { active: true, dirty: true });

  setEditorSessionActive(false);
  assert.deepEqual(getEditorSessionSnapshot(), { active: false, dirty: false });
  setEditorSessionDirty(true);
  assert.deepEqual(getEditorSessionSnapshot(), { active: false, dirty: false });
  assert.deepEqual(observations, ["true:false", "true:true", "false:false"]);
  unsubscribe();
});
