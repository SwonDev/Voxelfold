#!/usr/bin/env node

/**
 * Auditor geométrico de `.blockymodel` oficiales de Hytale.
 *
 * Uso:
 *   node scripts/audit-blockymodel-geometry.mjs /ruta/extraida/Common/Blocks
 *
 * Detecta caras exactamente coplanares y con la misma orientación procedentes de formas
 * distintas. Esas caras compiten por el búfer de profundidad y pueden producir z-fighting.
 * No modifica ni redistribuye assets: solo lee un directorio extraído temporalmente.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";

const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("Indica el directorio que contiene los .blockymodel extraídos.");
  process.exit(2);
}

const ROUND = 1e5;
const FACE_CORNERS = [
  [[1, 1, 1], [1, 1, 0], [1, 0, 1], [1, 0, 0]],
  [[0, 1, 0], [0, 1, 1], [0, 0, 0], [0, 0, 1]],
  [[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]],
  [[0, 0, 1], [1, 0, 1], [0, 0, 0], [1, 0, 0]],
  [[0, 1, 1], [1, 1, 1], [0, 0, 1], [1, 0, 1]],
  [[1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0]],
];
const FACE_KEYS = ["right", "left", "top", "bottom", "front", "back"];

function vec(value) {
  return new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

function quaternion(value) {
  return new THREE.Quaternion(
    value?.x ?? 0,
    value?.y ?? 0,
    value?.z ?? 0,
    value?.w ?? 1,
  ).normalize();
}

function numberKey(value) {
  const rounded = Math.round(value * ROUND) / ROUND;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function vectorKey(value) {
  return `${numberKey(value.x)},${numberKey(value.y)},${numberKey(value.z)}`;
}

function polygonKey(points, normal) {
  const vertices = points.map(vectorKey).sort().join("|");
  return `${vectorKey(normal)}::${vertices}`;
}

function faceNormal(points, center) {
  const normal = new THREE.Vector3()
    .subVectors(points[2], points[0])
    .cross(new THREE.Vector3().subVectors(points[1], points[0]))
    .normalize();
  const faceCenter = new THREE.Vector3().addVectors(points[0], points[3]).multiplyScalar(0.5);
  if (normal.dot(faceCenter.sub(center)) < 0) normal.negate();
  return normal;
}

function emitBox(shape, worldPosition, worldOrientation, source, faces) {
  const size = vec(shape.settings?.size);
  const stretch = vec(shape.stretch);
  const sx = (size.x * (stretch.x || 1)) / 2;
  const sy = (size.y * (stretch.y || 1)) / 2;
  const sz = (size.z * (stretch.z || 1)) / 2;
  const layout = shape.textureLayout ?? {};

  for (let index = 0; index < FACE_KEYS.length; index += 1) {
    const faceName = FACE_KEYS[index];
    if (!layout[faceName]) continue;
    const points = FACE_CORNERS[index].map(([x, y, z]) =>
      new THREE.Vector3(x ? sx : -sx, y ? sy : -sy, z ? sz : -sz)
        .applyQuaternion(worldOrientation)
        .add(worldPosition),
    );
    const normal = faceNormal(points, worldPosition);
    faces.push({
      ...source,
      face: faceName,
      normal,
      points,
      key: polygonKey(points, normal),
    });
  }
}

function emitQuad(shape, worldPosition, worldOrientation, source, faces) {
  const size = vec(shape.settings?.size);
  const stretch = vec(shape.stretch);
  const width = ((size.x || 16) * (stretch.x || 1)) / 2;
  const height = ((size.y || 16) * (stretch.y || 1)) / 2;
  const normalName = typeof shape.settings?.normal === "string" ? shape.settings.normal : "+Z";
  const sign = normalName.startsWith("-") ? -1 : 1;
  const axis = normalName.at(-1);
  let points;
  let normal;

  if (axis === "X") {
    points = [
      new THREE.Vector3(0, height, -width),
      new THREE.Vector3(0, height, width),
      new THREE.Vector3(0, -height, -width),
      new THREE.Vector3(0, -height, width),
    ];
    normal = new THREE.Vector3(sign, 0, 0);
  } else if (axis === "Y") {
    points = [
      new THREE.Vector3(-width, 0, height),
      new THREE.Vector3(width, 0, height),
      new THREE.Vector3(-width, 0, -height),
      new THREE.Vector3(width, 0, -height),
    ];
    normal = new THREE.Vector3(0, sign, 0);
  } else {
    points = [
      new THREE.Vector3(-width, height, 0),
      new THREE.Vector3(width, height, 0),
      new THREE.Vector3(-width, -height, 0),
      new THREE.Vector3(width, -height, 0),
    ];
    normal = new THREE.Vector3(0, 0, sign);
  }

  points = points.map((point) => point.applyQuaternion(worldOrientation).add(worldPosition));
  normal.applyQuaternion(worldOrientation).normalize();
  faces.push({
    ...source,
    face: "front",
    normal,
    points,
    key: polygonKey(points, normal),
  });
}

function collectFaces(nodes) {
  const faces = [];
  let shapeIndex = 0;

  function walk(node, parentPosition, parentOrientation) {
    const shape = node?.shape;
    if (shape?.visible === false) return;

    const localOrientation = quaternion(node?.orientation);
    const position = vec(node?.position);
    const offset = vec(shape?.offset);
    const worldPosition = offset
      .applyQuaternion(localOrientation)
      .add(position)
      .applyQuaternion(parentOrientation)
      .add(parentPosition);
    const worldOrientation = parentOrientation.clone().multiply(localOrientation).normalize();

    if (shape?.type === "box" || shape?.type === "quad") {
      const source = {
        id: shapeIndex,
        node: typeof node.name === "string" ? node.name : `forma ${shapeIndex}`,
        type: shape.type,
        shading: shape.shadingMode ?? "standard",
        doubleSided: shape.doubleSided === true,
      };
      shapeIndex += 1;
      if (shape.type === "box") emitBox(shape, worldPosition, worldOrientation, source, faces);
      else emitQuad(shape, worldPosition, worldOrientation, source, faces);
    }

    if (Array.isArray(node?.children)) {
      for (const child of node.children) walk(child, worldPosition, worldOrientation);
    }
  }

  const origin = new THREE.Vector3();
  const identity = new THREE.Quaternion();
  for (const node of nodes) walk(node, origin, identity);
  return { faces, shapeCount: shapeIndex };
}

function collisionsFor(faces) {
  const byGeometry = new Map();
  for (const face of faces) {
    const group = byGeometry.get(face.key);
    if (group) group.push(face);
    else byGeometry.set(face.key, [face]);
  }
  return [...byGeometry.values()].filter((group) => new Set(group.map((face) => face.id)).size > 1);
}

async function modelFiles(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await modelFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".blockymodel")) out.push(target);
  }
  return out;
}

const files = await modelFiles(root);
const affected = [];
let parseFailures = 0;
let totalShapes = 0;
let totalFaces = 0;
let duplicateFaceGroups = 0;

for (const file of files) {
  try {
    const document = JSON.parse(await readFile(file, "utf8"));
    const { faces, shapeCount } = collectFaces(Array.isArray(document.nodes) ? document.nodes : []);
    const collisions = collisionsFor(faces);
    totalShapes += shapeCount;
    totalFaces += faces.length;
    duplicateFaceGroups += collisions.length;
    if (collisions.length) {
      affected.push({
        file: path.relative(root, file),
        groups: collisions.length,
        faces: collisions.slice(0, 8).map((group) => group.map(({ node, type, shading, face }) => ({ node, type, shading, face }))),
      });
    }
  } catch (error) {
    parseFailures += 1;
    console.error(`No se pudo auditar ${file}: ${error instanceof Error ? error.message : error}`);
  }
}

console.log(JSON.stringify({
  models: files.length,
  parseFailures,
  shapes: totalShapes,
  faces: totalFaces,
  affectedModels: affected.length,
  duplicateFaceGroups,
  samples: affected.slice(0, 80),
}, null, 2));

if (parseFailures) process.exitCode = 2;
