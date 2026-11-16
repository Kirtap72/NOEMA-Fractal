import { describe, expect, it } from "vitest";
import { OrbitCamera } from "../src/app/orbitCamera";
import { cameraBasis } from "../src/engine/camera";
import type { SceneCamera } from "../src/engine/camera";

const len = (v: number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe("cameraBasis", () => {
  const cam: SceneCamera = { position: [0, 0, 4], target: [0, 0, 0], up: [0, 1, 0], fov_degrees: 50 };

  it("looks toward the target", () => {
    expect(cameraBasis(cam).forward).toEqual([0, 0, -1]);
  });

  it("is right-handed with Y up: looking down -z, right is +x", () => {
    const b = cameraBasis(cam);
    expect(b.right[0]).toBeCloseTo(1);
    expect(b.up[1]).toBeCloseTo(1);
  });

  it("gives axes at right angles with length 1 for any direction", () => {
    const b = cameraBasis({ position: [3, 2, -5], target: [1, 0, 1], up: [0, 1, 0], fov_degrees: 50 });
    for (const v of [b.right, b.up, b.forward]) expect(len(v)).toBeCloseTo(1);
    expect(dot(b.right, b.up)).toBeCloseTo(0);
    expect(dot(b.right, b.forward)).toBeCloseTo(0);
    expect(dot(b.up, b.forward)).toBeCloseTo(0);
  });

  it("still works when looking straight along the up direction", () => {
    const b = cameraBasis({ position: [0, 5, 0], target: [0, 0, 0], up: [0, 1, 0], fov_degrees: 50 });
    for (const v of [b.right, b.up, b.forward]) {
      expect(len(v)).toBeCloseTo(1);
      expect(v.every(Number.isFinite)).toBe(true);
    }
    expect(dot(b.right, b.forward)).toBeCloseTo(0);
  });
});

describe("OrbitCamera", () => {
  it("sits at the chosen distance from its target", () => {
    const cam = new OrbitCamera();
    cam.distance = 5;
    cam.target = [1, 2, 3];
    const p = cam.position();
    expect(len([p[0] - 1, p[1] - 2, p[2] - 3])).toBeCloseTo(5);
  });

  it("is on the positive z axis at yaw 0, pitch 0", () => {
    const cam = new OrbitCamera();
    cam.yaw = 0;
    cam.pitch = 0;
    cam.distance = 4;
    const p = cam.position();
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(0);
    expect(p[2]).toBeCloseTo(4);
  });

  it("cannot flip over the top or bottom", () => {
    const cam = new OrbitCamera();
    cam.rotate(0, 100);
    expect(cam.pitch).toBeLessThan(Math.PI / 2);
    cam.rotate(0, -200);
    expect(cam.pitch).toBeGreaterThan(-Math.PI / 2);
    expect(cameraBasis(cam.toSceneCamera(50)).right.every(Number.isFinite)).toBe(true);
  });

  it("keeps the zoom within its limits", () => {
    const cam = new OrbitCamera(2, 10);
    cam.zoom(1000);
    expect(cam.distance).toBe(10);
    cam.zoom(0.0001);
    expect(cam.distance).toBe(2);
  });

  it("can continue from a camera loaded from a scene file", () => {
    const original = new OrbitCamera();
    original.rotate(0.8, -0.3);
    original.zoom(1.5);
    const saved = original.toSceneCamera(50);
    const restored = new OrbitCamera();
    restored.setFromSceneCamera(saved);
    const a = original.position();
    const b = restored.position();
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i]!);
  });

  it("writes an Y-up scene camera looking at its target", () => {
    const c = new OrbitCamera().toSceneCamera(40);
    expect(c.up).toEqual([0, 1, 0]);
    expect(c.fov_degrees).toBe(40);
    expect(c.target).toEqual([0, 0, 0]);
  });
});
