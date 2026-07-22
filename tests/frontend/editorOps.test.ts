import assert from "node:assert/strict";
import test from "node:test";
import { brushCells, fillCells, lineCells, rectCells } from "../../src/lib/editorOps.ts";

const keys = (cells: { x: number; y: number; z: number }[]) =>
  new Set(cells.map((cell) => `${cell.x},${cell.y},${cell.z}`));

test("línea conserva ambos extremos y la altura inicial", () => {
  const cells = lineCells({ x: 0, y: 4, z: 0 }, { x: 3, y: 9, z: 3 });
  assert.deepEqual(cells, [
    { x: 0, y: 4, z: 0 },
    { x: 1, y: 4, z: 1 },
    { x: 2, y: 4, z: 2 },
    { x: 3, y: 4, z: 3 },
  ]);
});

test("caja distingue contorno, cáscara y volumen macizo", () => {
  const a = { x: 0, y: 2, z: 0 };
  const b = { x: 2, y: 2, z: 2 };
  assert.equal(rectCells(a, b, false, 2).length, 16);
  assert.equal(rectCells(a, b, false, 3, true).length, 26);
  assert.equal(rectCells(a, b, true, 3).length, 27);
  assert.equal(rectCells(a, b, true, 3, false, 5).length, 5);
});

test("relleno respeta muros, límites y tope de seguridad", () => {
  const occupied = (x: number, z: number) => x === 0 || x === 4 || z === 0 || z === 4;
  const bounds = { minX: 0, maxX: 4, minZ: 0, maxZ: 4 };
  const filled = fillCells({ x: 2, y: 6, z: 2 }, occupied, bounds);
  assert.equal(filled.length, 9);
  assert.ok([...keys(filled)].every((key) => key.includes(",6,")));
  assert.deepEqual(fillCells({ x: 9, y: 0, z: 9 }, occupied, bounds), []);
  assert.equal(fillCells({ x: 2, y: 0, z: 2 }, () => false, bounds, 4).length, 4);
});

test("la brocha redondea diámetros pares hacia arriba y conserva cáscara", () => {
  const even = brushCells({ x: 0, y: 0, z: 0 }, "cube", 2);
  assert.equal(even.length, 27);
  assert.deepEqual(
    {
      minX: Math.min(...even.map((cell) => cell.x)),
      maxX: Math.max(...even.map((cell) => cell.x)),
    },
    { minX: -1, maxX: 1 },
  );
  assert.equal(brushCells({ x: 0, y: 0, z: 0 }, "cube", 3, true).length, 26);
});
