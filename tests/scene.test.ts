import {withAnimationIdentities} from '../src/engine/animationIdentity';
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLibrary } from "../src/engine/formula/library";
import {
  collectCredits,
  createDefaultScene,
  migrateScene,
  parseScene,
  resolveScene,
  SCENE_SCHEMA_VERSION,
  serializeScene,
} from "../src/engine/scene";
import { withStepParameter } from "../src/engine/sceneEdit";

const library = buildLibrary({ "formulas/mandelbulb.yaml": readFileSync("formulas/mandelbulb.yaml", "utf8") });
const bulb = library.formulas[0]!;

const COLOR = {
  gradient: { stops: [{ position: 0, color: "#000000" }, { position: 1, color: "#ffffff" }] },
  measure: "orbit_trap",
};

const validScene = () => ({
  schema_version: 13,
  color: COLOR,
  animation: { duration_seconds: 10, fps: 30, speed_mode: "adaptive", keyframes: [] },
  camera: { position: [0, 0, 4], target: [0, 0, 0] },
  content: [{ type: "fractal", chain: [{ formula: "mandelbulb", parameters: { power: 6 } }] }],
});

const errorsOf = (input: unknown): string[] => {
  const r = parseScene(input);
  if (r.ok) throw new Error("expected errors");
  return r.errors;
};

describe("parseScene", () => {
  it("accepts a minimal scene and fills in defaults", () => {
    const r = parseScene(validScene());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.units).toBe("unit");
    expect(r.scene.camera.up).toEqual([0, 1, 0]);
    expect(r.scene.camera.fov_degrees).toBe(50);
    expect(r.scene.animation).toEqual({ duration_seconds: 10, fps: 30, speed_mode: "adaptive", keyframes: [] });
    expect(r.scene.content[0]!.chain[0]!.parameters).toEqual({ power: 6 });
    expect(r.scene.content[0]!.rounds).toBe(1);
  });

  it("reads JSON text too", () => {
    expect(parseScene(JSON.stringify(validScene())).ok).toBe(true);
    expect(errorsOf("{ not json")[0]).toMatch(/not valid JSON/);
  });

  it("rejects a scene without camera or content", () => {
    const e = errorsOf({ schema_version: 1 });
    expect(e.join()).toMatch(/camera is required/);
    expect(e.join()).toMatch(/content must be a list/);
  });

  it("requires a version and refuses versions newer than the engine", () => {
    expect(errorsOf({ camera: {}, content: [] })[0]).toMatch(/schema_version is required/);
    expect(errorsOf({ ...validScene(), schema_version: SCENE_SCHEMA_VERSION + 1 })[0]).toMatch(/newer than this engine/);
    expect(errorsOf({ ...validScene(), schema_version: 0 })[0]).toMatch(/unknown scene version/);
  });

  it("checks camera numbers", () => {
    const bad = { ...validScene(), camera: { position: [0, 0], target: [0, 0, 0] } };
    expect(errorsOf(bad).join()).toMatch(/camera.position must be a list of three numbers/);
    const same = { ...validScene(), camera: { position: [1, 1, 1], target: [1, 1, 1] } };
    expect(errorsOf(same).join()).toMatch(/must differ/);
    const fov = { ...validScene(), camera: { position: [0, 0, 4], target: [0, 0, 0], fov_degrees: 500 } };
    expect(errorsOf(fov).join()).toMatch(/fov_degrees/);
  });

  it("rejects numbers that are NaN or infinite when parsed from objects", () => {
    const bad = { ...validScene(), camera: { position: [0, 0, Infinity], target: [0, 0, 0] } };
    expect(errorsOf(bad).join()).toMatch(/three numbers/);
  });

  it("ignores unknown content types and fields with a warning", () => {
    const r = parseScene({
      ...validScene(),
      surprise: 1,
      content: [{ type: "fractal", chain: [{ formula: "mandelbulb" }] }, { type: "splats", file: "a.ply" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.content).toHaveLength(1);
    expect(r.warnings.join()).toMatch(/unknown field "surprise"/);
    expect(r.warnings.join()).toMatch(/type "splats" is not supported/);
  });

  it("reads an animation and requires increasing keyframe times", () => {
    const kf = (t: number) => ({
      time_seconds: t,
      camera: { position: [0, 0, 4], target: [0, 0, 0] },
      steps: [{ parameters: { power: 6 } }],
      color: COLOR,
    });
    const anim = (keyframes: unknown[]) => ({ duration_seconds: 10, fps: 24, speed_mode: "uniform", keyframes });
    const ok = parseScene({ ...validScene(), animation: anim([kf(0), kf(2)]) });
    expect(ok.ok && ok.scene.animation.keyframes).toHaveLength(2);
    expect(ok.ok && ok.scene.animation.fps).toBe(24);
    expect(errorsOf({ ...validScene(), animation: anim([kf(2), kf(1)]) }).join()).toMatch(/must be later/);
    expect(errorsOf({ ...validScene(), animation: anim([kf(11)]) }).join()).toMatch(/after the end/);
  });

  it("requires the keyframes to have as many steps as the chain", () => {
    const kf = { time_seconds: 0, camera: { position: [0, 0, 4], target: [0, 0, 0] }, steps: [], color: COLOR };
    const bad = { ...validScene(), animation: { duration_seconds: 10, fps: 30, speed_mode: "adaptive", keyframes: [kf] } };
    expect(errorsOf(bad).join()).toMatch(/has 0 entries but the chain has 1 steps/);
  });

  it("checks animation settings", () => {
    const base = { duration_seconds: 10, fps: 30, speed_mode: "adaptive", keyframes: [] };
    for (const bad of [{ duration_seconds: 0 }, { duration_seconds: 99999 }, { fps: 0 }, { fps: 24.5 }, { fps: 500 }, { speed_mode: "zoom" }]) {
      expect(errorsOf({ ...validScene(), animation: { ...base, ...bad } }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
    expect(errorsOf({ ...validScene(), animation: undefined }).join()).toMatch(/animation is required/);
  });

  it("rejects non-number parameters", () => {
    const bad = { ...validScene(), content: [{ type: "fractal", chain: [{ formula: "mandelbulb", parameters: { power: "8" } }] }] };
    expect(errorsOf(bad).join()).toMatch(/parameters.power must be a number/);
  });
});

describe("migrateScene", () => {
  it("passes the current version through unchanged", () => {
    const r = migrateScene({ schema_version: SCENE_SCHEMA_VERSION });
    expect(r.ok).toBe(true);
  });
});

describe("resolveScene", () => {
  it("uses scene values and defaults for the rest", () => {
    const scene = createDefaultScene(bulb);
    const r = resolveScene(withStepParameter(scene, 0, "power", 5), library.formulas);
    expect(r.ok && r.parameterValues).toEqual([5]);
    const none = resolveScene({ ...scene, content: [{ ...scene.content[0]!, chain: [{ formula: "mandelbulb", parameters: {} }] }] }, library.formulas);
    expect(none.ok && none.parameterValues).toEqual([8]);
  });

  it("limits values to the allowed range and warns", () => {
    const r = resolveScene(withStepParameter(createDefaultScene(bulb), 0, "power", 99), library.formulas);
    expect(r.ok && r.parameterValues).toEqual([16]);
    expect(r.ok && r.warnings.join()).toMatch(/limited to 16/);
  });

  it("warns about unknown parameters", () => {
    const r = resolveScene(withStepParameter(createDefaultScene(bulb), 0, "nonsense", 1), library.formulas);
    expect(r.ok && r.warnings.join()).toMatch(/"nonsense" does not exist/);
  });

  it("fails when the formula is missing from the library", () => {
    const scene = createDefaultScene(bulb);
    const r = resolveScene({ ...scene, content: [{ ...scene.content[0]!, chain: [{ formula: "nope", parameters: {} }] }] }, library.formulas);
    expect(!r.ok && r.errors.join()).toMatch(/"nope" was not found/);
    const empty = resolveScene({ ...scene, content: [] }, library.formulas);
    expect(empty.ok).toBe(false);
  });
});

describe("saving a scene", () => {
  it("takes the authors and verification status of the formula along", () => {
    const credits = collectCredits(createDefaultScene(bulb), library.formulas);
    expect(credits.filter((c) => c.kind === "author").length).toBe(bulb.credits.length);
    expect(credits.every((c) => c.status === "unverified")).toBe(true);
    expect(credits.some((c) => c.url?.startsWith("https://"))).toBe(true);
  });

  it("writes JSON that reads back as the same scene", () => {
    const scene = withStepParameter(createDefaultScene(bulb), 0, "power", 7);
    const text = serializeScene(scene, library.formulas);
    const back = parseScene(text);
    expect(back.ok && back.scene).toEqual(withAnimationIdentities(scene));
    expect(JSON.parse(text).credits.length).toBeGreaterThan(0);
  });

  it("is pure data: no functions or code in the output", () => {
    const text = serializeScene(createDefaultScene(bulb), library.formulas);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toMatch(/fn |function|=>/);
  });
});

describe("createDefaultScene", () => {
  it("looks at the origin from the formula's suggested distance", () => {
    const s = createDefaultScene(bulb);
    const d = Math.hypot(...s.camera.position);
    expect(d).toBeCloseTo(bulb.cameraDistance ?? 4);
    expect(s.camera.target).toEqual([0, 0, 0]);
  });
});
