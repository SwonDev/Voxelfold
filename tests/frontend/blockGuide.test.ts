import test from "node:test";
import assert from "node:assert/strict";

import { blockGuide } from "../../src/lib/blockGuide.ts";
import type { BlockInfo } from "../../src/lib/api.ts";

test("describe la emisión de luz con una frase gramatical", () => {
  const result = blockGuide({
    name: "Furniture_Royal_Magic_Potion_Glow",
    display_name: "Glowing Royal Magic Potion",
    is_block: true,
    light: true,
    opacity: null,
    tint: null,
    model: "Common/Blocks/Potion.blockymodel",
  } as BlockInfo);

  assert.match(result.description, /Emite luz, con modelo 3D propio\./);
  assert.doesNotMatch(result.description, /Es emite/);
});
