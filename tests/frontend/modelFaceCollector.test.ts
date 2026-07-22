import assert from "node:assert/strict";
import test from "node:test";
import { ModelFaceCollector, type ModelFaceBucket } from "../../src/lib/modelFaceCollector.ts";

const points = [
  [-1, 1, 0],
  [1, 1, 0],
  [-1, -1, 0],
  [1, -1, 0],
];
const uvs = [[0, 1], [1, 1], [0, 0], [1, 0]];

function add(
  collector: ModelFaceCollector,
  bucket: ModelFaceBucket,
  options: { doubleSided?: boolean; faceUvs?: number[][]; normal?: number[] } = {},
) {
  collector.add({
    points,
    uvs: options.faceUvs ?? uvs,
    normal: options.normal ?? [0, 0, 1],
    bucket,
    doubleSided: options.doubleSided ?? false,
    triangulation: "quad",
  });
}

test("colapsa caras idénticas y conserva doubleSided", () => {
  const collector = new ModelFaceCollector();
  add(collector, "flat");
  add(collector, "flat", { doubleSided: true });
  const result = collector.build();
  assert.equal(result.flat.positions.length / 3, 12);
});

test("fullbright prevalece sobre una copia plana coplanar", () => {
  const collector = new ModelFaceCollector();
  add(collector, "flat");
  add(collector, "em");
  const result = collector.build();
  assert.equal(result.flat.positions.length, 0);
  assert.equal(result.em.positions.length / 3, 6);
});

test("preserva capas que usan UV diferentes", () => {
  const collector = new ModelFaceCollector();
  add(collector, "flat");
  add(collector, "em", { faceUvs: [[0.5, 1], [1, 1], [0.5, 0], [1, 0]] });
  const result = collector.build();
  assert.equal(result.flat.positions.length / 3, 6);
  assert.equal(result.em.positions.length / 3, 6);
});

test("preserva superficies orientadas en sentidos opuestos", () => {
  const collector = new ModelFaceCollector();
  add(collector, "std");
  add(collector, "std", { normal: [0, 0, -1] });
  const result = collector.build();
  assert.equal(result.std.positions.length / 3, 12);
});
