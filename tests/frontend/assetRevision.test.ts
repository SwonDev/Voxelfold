import assert from "node:assert/strict";
import test from "node:test";

import { assetUrl, getAssetGeneration, setAssetGeneration } from "../../src/lib/api.ts";

test("la revisión invalida todas las URL de assets", () => {
  setAssetGeneration(7);
  const before = assetUrl("Common/Blocks/Test Texture.png");
  setAssetGeneration(8);
  const after = assetUrl("Common/Blocks/Test Texture.png");

  assert.equal(getAssetGeneration(), 8);
  assert.match(before, /Test%20Texture\.png\?vf_rev=7$/);
  assert.match(after, /Test%20Texture\.png\?vf_rev=8$/);
  assert.notEqual(before, after);
});

test("rechaza revisiones inválidas", () => {
  setAssetGeneration(11);
  setAssetGeneration(-1);
  assert.equal(getAssetGeneration(), 11);
  setAssetGeneration(Number.NaN);
  assert.equal(getAssetGeneration(), 11);
});
