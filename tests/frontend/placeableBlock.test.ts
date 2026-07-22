import test from "node:test";
import assert from "node:assert/strict";

import { isPlaceableBlock, type BlockInfo } from "../../src/lib/api.ts";

function block(name: string, displayName: string | null = name, isBlock = true): BlockInfo {
  return { name, display_name: displayName, is_block: isBlock } as BlockInfo;
}

test("acepta bloques de juego colocables", () => {
  assert.equal(isPlaceableBlock(block("Stone_Brick")), true);
});

test("excluye herramientas de desarrollo y marcadores temporales", () => {
  for (const candidate of [
    block("Filter_Biome"),
    block("ExamplePrefabPlacement_City"),
    block("Template_House"),
    block("Barrier"),
    block("Empty"),
    block("Objective_Trigger"),
    block("[TMP]_Gold_Pipe"),
    block("Gold_Pipe", "[TMP] Gold Pipe"),
    block("Prototype_Window"),
    block("Debug_Light"),
  ]) {
    assert.equal(isPlaceableBlock(candidate), false, candidate.name);
  }
});

test("excluye entradas que no son bloques", () => {
  assert.equal(isPlaceableBlock(block("Builder_Hammer", "Builder Hammer", false)), false);
});
