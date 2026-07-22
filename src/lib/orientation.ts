import * as THREE from "three";
import { decodeRotation } from "@/lib/hytaleRotation";

/**
 * Cuaternión de render para el `RotationTuple` oficial de Hytale (0..63).
 * El orden coincide literalmente con el motor: Ry(yaw) · Rx(pitch) · Rz(roll).
 */
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const HALF_PI = Math.PI / 2;
const _q = new THREE.Quaternion();
const _x = new THREE.Quaternion();
const _z = new THREE.Quaternion();

export function orientationQuat(rotation = 0): [number, number, number, number] {
  const { yaw, pitch, roll } = decodeRotation(rotation);
  _q.setFromAxisAngle(Y, yaw * HALF_PI);
  _x.setFromAxisAngle(X, pitch * HALF_PI);
  _z.setFromAxisAngle(Z, roll * HALF_PI);
  _q.multiply(_x).multiply(_z);
  return [_q.x, _q.y, _q.z, _q.w];
}
