import assert from "node:assert/strict";
import test from "node:test";
import {
  mirrorClipboardX,
  mirrorClipboardZ,
  revolveCells,
  rotateClipboard,
  stackCells,
  toClipboard,
  voxelsInBox,
  type Clipboard,
} from "../../src/lib/selectionOps.ts";

const sample = [
  { x: 4, y: 2, z: 8, name: "A", rotation: 0, phase: 0 },
  { x: 6, y: 3, z: 9, name: "B", rotation: 1, phase: 1 },
];

test("selección inclusiva y portapapeles normalizado conservan datos", () => {
  assert.equal(
    voxelsInBox(sample, { minX: 4, maxX: 4, minY: 2, maxY: 2, minZ: 8, maxZ: 8 }).length,
    1,
  );
  const clip = toClipboard(sample);
  assert.deepEqual({ w: clip.w, h: clip.h, d: clip.d }, { w: 3, h: 2, d: 2 });
  assert.deepEqual(clip.cells.map(({ x, y, z }) => ({ x, y, z })), [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 1, z: 1 },
  ]);
});

test("rotar y espejar transforman huella y orientación sin perder bloques", () => {
  const clip = toClipboard(sample);
  const rotated = rotateClipboard(clip);
  assert.deepEqual({ w: rotated.w, h: rotated.h, d: rotated.d }, { w: 2, h: 2, d: 3 });
  assert.equal(rotated.cells.length, clip.cells.length);
  assert.deepEqual(mirrorClipboardX(mirrorClipboardX(clip)), clip);
  assert.deepEqual(mirrorClipboardZ(mirrorClipboardZ(clip)), clip);
});

test("dos copias radiales quedan enfrentadas a 180 grados", () => {
  const clip: Clipboard = {
    w: 2,
    h: 1,
    d: 1,
    cells: [{ x: 1, y: 0, z: 0, name: "A", rotation: 0, phase: 0 }],
  };
  const cells = revolveCells(clip, { x: 10, y: 5, z: 20 }, 2);
  assert.deepEqual(cells.map(({ x, y, z }) => ({ x, y, z })), [
    { x: 11, y: 5, z: 20 },
    { x: 9, y: 5, z: 20 },
  ]);
  assert.equal(new Set(cells.map((cell) => cell.rotation)).size, 2);
});

test("apilar usa el tamaño real del portapapeles sin huecos ni solapes", () => {
  const clip: Clipboard = {
    w: 2,
    h: 1,
    d: 1,
    cells: [
      { x: 0, y: 0, z: 0, name: "A", rotation: 0, phase: 0 },
      { x: 1, y: 0, z: 0, name: "B", rotation: 0, phase: 0 },
    ],
  };
  const cells = stackCells(clip, { x: 5, y: 0, z: 0 }, "x-", 3);
  assert.deepEqual(cells.map((cell) => cell.x), [5, 6, 3, 4, 1, 2]);
});
