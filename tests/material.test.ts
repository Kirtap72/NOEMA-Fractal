import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { cameraBasis } from "../src/engine/camera";
import {
  CURVE_TABLE_SIZE,
  MATERIAL_FLOATS,
  MIN_ROUGHNESS,
  alphaOf,
  baseReflectance,
  curveTable,
  defaultMaterial,
  directSpecular,
  environmentFresnel,
  environmentLod,
  ggxD,
  isDefaultMaterial,
  materialIsActive,
  packMaterial,
  propertyValue,
  readMaterial,
  reflectDirection,
  sampleCurve,
  schlick,
  skyGradient,
  skyReflection,
  smithV,
  tableValue,
  wrapMeasure,
} from "../src/engine/material";
import type { MaterialSettings } from "../src/engine/material";
import { buildMipChain } from "../src/engine/radiance";
import type { HdrImage } from "../src/engine/radiance";
import { createDefaultScene, migrateScene, parseScene, serializeScene } from "../src/engine/scene";
import { MATERIAL_OFFSET, UNIFORM_FLOATS, packUniforms } from "../src/engine/uniforms";
import { loadLibrary } from "./helpers/cpuScene";

/**
 * Step 5 of the image quality plan (scene version 13): the material. The formulas are checked against properties that
 * can be worked out independently (that the normal distribution adds up to 1, that Schlick with the refractive index
 * of glass gives 0.04, that no light is created), not against the shader's own numbers.
 */

const unit = (v: number[]): [number, number, number] => {
  const l = Math.hypot(...v);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

describe("the GGX normal distribution", () => {
  it("adds up to 1: the integral of D(h) cos(theta_h) over the half sphere is 1 for every roughness (the definition of a normal distribution)", () => {
    for (const roughness of [0.1, 0.3, 0.6, 1]) {
      const alpha = alphaOf(roughness);
      // integrate over theta from 0 to pi/2 and phi from 0 to 2 pi: D cos(theta) sin(theta) dtheta dphi (D does not depend on phi)
      const n = 200000;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const theta = ((i + 0.5) / n) * (Math.PI / 2);
        sum += ggxD(Math.cos(theta), alpha) * Math.cos(theta) * Math.sin(theta);
      }
      sum *= (Math.PI / 2 / n) * 2 * Math.PI;
      // small roughness makes a very narrow peak, which the step size resolves a little worse
      expect(sum, `roughness ${roughness}`).toBeCloseTo(1, roughness < 0.2 ? 1 : 3);
    }
  });

  it("is highest where the half vector equals the normal, and narrower for a smoother surface", () => {
    expect(ggxD(1, alphaOf(0.2))).toBeGreaterThan(ggxD(0.99, alphaOf(0.2)));
    expect(ggxD(1, alphaOf(0.2))).toBeGreaterThan(ggxD(1, alphaOf(0.8)));
    expect(ggxD(0.9, alphaOf(0.2))).toBeLessThan(ggxD(0.9, alphaOf(0.8)));
  });

  it("alpha is the roughness squared, and the roughness is held at the smallest value of the shader", () => {
    expect(alphaOf(0.5)).toBeCloseTo(0.25, 12);
    expect(alphaOf(0)).toBeCloseTo(MIN_ROUGHNESS ** 2, 12);
    expect(alphaOf(2)).toBe(1);
  });
});

describe("the Smith visibility", () => {
  it("times 4 (n.l)(n.v) is the shadowing G, which is at most 1, equals 1 for a very smooth surface, and falls towards the grazing angles", () => {
    for (const nv of [0.1, 0.5, 1]) {
      for (const nl of [0.1, 0.5, 1]) {
        for (const r of [0.05, 0.3, 0.7, 1]) {
          const g = smithV(nv, nl, alphaOf(r)) * 4 * nl * nv;
          expect(g).toBeLessThanOrEqual(1.0000001);
          expect(g).toBeGreaterThan(0);
        }
      }
    }
    expect(smithV(0.7, 0.7, 0.0001) * 4 * 0.7 * 0.7).toBeCloseTo(1, 3);
    expect(smithV(0.1, 0.1, alphaOf(0.8)) * 4 * 0.01).toBeLessThan(smithV(0.9, 0.9, alphaOf(0.8)) * 4 * 0.81);
  });
});

describe("Schlick's approximation of Fresnel", () => {
  it("is F0 at normal incidence and 1 at grazing incidence", () => {
    expect(schlick(0.04, 1)).toBeCloseTo(0.04, 12);
    expect(schlick(0.04, 0)).toBeCloseTo(1, 12);
    expect(schlick(0.5, 0.5)).toBeCloseTo(0.5 + 0.5 * 0.5 ** 5, 12);
  });

  it("gives 0.04 for glass: R0 = ((n1 - n2) / (n1 + n2))^2 with the refractive index 1.5 (Wikipedia, Schlick's approximation; the dielectric of glTF)", () => {
    const r0 = ((1 - 1.5) / (1 + 1.5)) ** 2;
    expect(r0).toBeCloseTo(0.04, 12);
    expect(baseReflectance([0.7, 0.2, 0.9], 0)).toEqual([0.04, 0.04, 0.04]);
  });

  it("a metal takes its colour as F0, and the mix is linear in the metallic value", () => {
    expect(baseReflectance([0.7, 0.2, 0.9], 1).map((v) => +v.toFixed(12))).toEqual([0.7, 0.2, 0.9]);
    const half = baseReflectance([0.7, 0.2, 0.9], 0.5);
    expect(half[0]).toBeCloseTo((0.04 + 0.7) / 2, 12);
  });
});

describe("specular light from one light", () => {
  const n: [number, number, number] = [0, 0, 1];
  const v: [number, number, number] = [0, 0, 1];

  it("never gives back more light than a perfect mirror could: the sum over all light directions of BRDF x cosine is at most 1 (F0 = 1), for every roughness and view", () => {
    for (const roughness of [0.1, 0.3, 0.6, 1]) {
      for (const view of [unit([0, 0, 1]), unit([0.6, 0, 0.8]), unit([0.9, 0, 0.3])]) {
        let sum = 0;
        const steps = 400;
        for (let i = 0; i < steps; i++) {
          const theta = ((i + 0.5) / steps) * (Math.PI / 2);
          for (let j = 0; j < steps; j++) {
            const phi = ((j + 0.5) / steps) * 2 * Math.PI;
            const l: [number, number, number] = [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
            sum += directSpecular(n, view, l, [1, 1, 1], roughness)[0] * Math.sin(theta);
          }
        }
        sum *= (Math.PI / 2 / steps) * (2 * Math.PI / steps);
        // the BRDF x cosine already contains the cosine of the light; here it is integrated over the light directions
        expect(sum, `roughness ${roughness}`).toBeLessThanOrEqual(1.02);
        // and not nothing: the model does reflect. Straight on, a smooth surface returns nearly everything (the picture of a
        // mirror); the loss of energy of this single-scattering model grows with roughness (known: up to about two thirds at 1).
        if (view[2] > 0.7) expect(sum).toBeGreaterThan(roughness <= 0.3 ? 0.9 : roughness <= 0.6 ? 0.6 : 0.25);
      }
    }
  });

  it("peaks in the mirror direction and is dimmer away from it", () => {
    const view = unit([0.6, 0, 0.8]);
    const mirror = reflectDirection(view, n);
    expect(mirror[0]).toBeCloseTo(-0.6, 12);
    const at = (l: [number, number, number]) => directSpecular(n, view, l, [1, 1, 1], 0.3)[0];
    expect(at(mirror)).toBeGreaterThan(at(unit([mirror[0] + 0.2, mirror[1], mirror[2]])));
    expect(at(mirror)).toBeGreaterThan(at(unit([0, 0, 1])));
  });

  it("is 0 for a light below the surface, and keeps the channels apart (a coloured metal gives coloured highlights)", () => {
    expect(directSpecular(n, v, [0, 0, -1], [1, 1, 1], 0.5)).toEqual([0, 0, 0]);
    const s = directSpecular(n, v, unit([0.3, 0, 1]), [0.9, 0.5, 0.1], 0.4);
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[1]).toBeGreaterThan(s[2]);
  });

  it("a rougher surface spreads the highlight: a lower peak and more light far from the mirror direction", () => {
    const view = unit([0.6, 0, 0.8]);
    const mirror = reflectDirection(view, n);
    const far = unit([mirror[0] + 0.7, mirror[1], mirror[2]]);
    expect(directSpecular(n, view, mirror, [1, 1, 1], 0.2)[0]).toBeGreaterThan(directSpecular(n, view, mirror, [1, 1, 1], 0.8)[0]);
    expect(directSpecular(n, view, far, [1, 1, 1], 0.2)[0]).toBeLessThan(directSpecular(n, view, far, [1, 1, 1], 0.8)[0]);
  });
});

describe("light from the environment", () => {
  it("the Fresnel term never exceeds 1, is F0 straight on, and grows to at most 1 at grazing angles", () => {
    for (const r of [0.05, 0.3, 1]) {
      for (const f0 of [0.04, 0.5, 1]) {
        const head = environmentFresnel([f0, f0, f0], r, 1)[0];
        const graze = environmentFresnel([f0, f0, f0], r, 0)[0];
        expect(head).toBeCloseTo(f0, 12);
        expect(graze).toBeGreaterThanOrEqual(f0 - 1e-12);
        expect(graze).toBeLessThanOrEqual(1);
      }
    }
    // a rough surface has less of the grazing boost than a smooth one
    expect(environmentFresnel([0.04, 0.04, 0.04], 1, 0)[0]).toBeLessThan(environmentFresnel([0.04, 0.04, 0.04], 0.1, 0)[0]);
  });

  it("a mirror of a uniform environment of value 1 with F0 = 1 returns at most 1 (energy is not created)", () => {
    const f = environmentFresnel([1, 1, 1], 0.1, 0.3);
    expect(f[0] * 1).toBeLessThanOrEqual(1);
    expect(f[0]).toBeCloseTo(1, 12);
  });

  it("the mirror direction is the view direction reflected in the normal, and straight on it is straight back", () => {
    expect(reflectDirection([0, 0, 1], [0, 0, 1])).toEqual([0, 0, 1]);
    const r = reflectDirection(unit([1, 1, 0]), [0, 1, 0]);
    expect(r[0]).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(r[1]).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it("the gradient sky matches the shader's: dark blue below, lighter above; and a rougher surface sees more of its average", () => {
    expect(skyGradient([0, -1, 0])).toEqual([0.08, 0.1, 0.16]);
    expect(skyGradient([0, 1, 0]).map((v) => +v.toFixed(12))).toEqual([0.25, 0.3, 0.4]);
    const avg = skyGradient([0, 0, 0]);
    const up = skyReflection([0, 1, 0], 0.1);
    const rough = skyReflection([0, 1, 0], 1);
    expect(Math.abs(rough[2] - avg[2])).toBeLessThan(Math.abs(up[2] - avg[2]));
    expect(rough[0]).toBeCloseTo(avg[0], 12); // roughness 1: the average, whatever the direction
  });

  it("the blur level follows the roughness from sharp (0) to the last level", () => {
    expect(environmentLod(0, 9)).toBe(0);
    expect(environmentLod(0.5, 9)).toBe(4.5);
    expect(environmentLod(1, 9)).toBe(9);
    expect(environmentLod(2, 9)).toBe(9);
  });

  it("the levels of the environment picture: sizes halve down to 1 x 1, and every level keeps the average light", () => {
    const w = 64;
    const h = 32;
    const data = new Float32Array(w * h * 3);
    for (let i = 0; i < data.length; i++) data[i] = 0.1 + ((i * 7919) % 97) / 20;
    const image: HdrImage = { width: w, height: h, data };
    const chain = buildMipChain(image);
    expect(chain.map((l) => [l.width, l.height])).toEqual([[64, 32], [32, 16], [16, 8], [8, 4], [4, 2], [2, 1], [1, 1]]);
    const mean = (l: HdrImage) => l.data.reduce((a, b) => a + b, 0) / l.data.length;
    for (const level of chain) expect(mean(level)).toBeCloseTo(mean(image), 4);
  });
});

describe("properties that follow a measure", () => {
  const curve = [
    { position: 0, value: 0 },
    { position: 0.5, value: 1 },
    { position: 1, value: 0.5 },
  ];

  it("a curve is linear between its points and held beyond the ends", () => {
    expect(sampleCurve(curve, 0)).toBe(0);
    expect(sampleCurve(curve, 0.25)).toBeCloseTo(0.5, 12);
    expect(sampleCurve(curve, 0.5)).toBe(1);
    expect(sampleCurve(curve, 0.75)).toBeCloseTo(0.75, 12);
    expect(sampleCurve(curve, 1)).toBe(0.5);
    const inner = [{ position: 0.3, value: 0.2 }, { position: 0.6, value: 0.8 }];
    expect(sampleCurve(inner, 0)).toBe(0.2);
    expect(sampleCurve(inner, 1)).toBe(0.8);
  });

  it("the cycles, the offset and the wrap work like the colour's gradient", () => {
    expect(wrapMeasure(0.25, "repeat")).toBeCloseTo(0.25, 12);
    expect(wrapMeasure(1.25, "repeat")).toBeCloseTo(0.25, 12);
    expect(wrapMeasure(1.25, "mirror")).toBeCloseTo(0.75, 12);
    expect(wrapMeasure(2.25, "mirror")).toBeCloseTo(0.25, 12);
    expect(wrapMeasure(-0.25, "repeat")).toBeCloseTo(0.75, 12);
    const p = { measure: "cavity" as const, curve, cycles: 2, offset: 0.1, wrap: "mirror" as const };
    expect(propertyValue(p, 0.2)).toBeCloseTo(sampleCurve(curve, wrapMeasure(0.2 * 2 + 0.1, "mirror")), 12);
    expect(propertyValue(0.3, 0.9)).toBe(0.3); // a number ignores the measure
  });

  it("the table the shader reads is the curve sampled evenly, and reading it back stays close to the curve", () => {
    const table = curveTable(curve);
    expect(table).toHaveLength(CURVE_TABLE_SIZE);
    expect(table[0]).toBe(0);
    expect(table[CURVE_TABLE_SIZE - 1]).toBe(0.5);
    for (let k = 0; k <= 100; k++) expect(Math.abs(tableValue(table, k / 100) - sampleCurve(curve, k / 100))).toBeLessThan(0.03);
  });
});

describe("the material in a scene (version 13)", () => {
  const library = loadLibrary();
  const bulb = library.find((f) => f.id === "mandelbulb")!;

  it("is the matt material without metal or reflection by default, which adds nothing", () => {
    expect(createDefaultScene(bulb).material).toEqual({ metallic: 0, roughness: 1, reflectivity: 0 });
    expect(isDefaultMaterial(defaultMaterial())).toBe(true);
    expect(materialIsActive(defaultMaterial())).toBe(false);
    expect(materialIsActive({ ...defaultMaterial(), roughness: 0.2 })).toBe(false); // roughness alone changes nothing
    expect(materialIsActive({ ...defaultMaterial(), metallic: 0.1 })).toBe(true);
    expect(materialIsActive({ ...defaultMaterial(), reflectivity: 0.1 })).toBe(true);
    expect(materialIsActive({ ...defaultMaterial(), reflectivity: { measure: "cavity", curve: [{ position: 0, value: 0 }, { position: 1, value: 1 }], cycles: 1, offset: 0, wrap: "mirror" } })).toBe(true);
  });

  it("an old scene is moved to version 13 with that material, and looks as before", () => {
    const old = { schema_version: 12, camera: { position: [0, 0, 4], target: [0, 0, 0] }, color: { gradient: { stops: [{ position: 0, color: "#000000" }, { position: 1, color: "#ffffff" }] }, measure: "slope" }, animation: { duration_seconds: 10, fps: 30, speed_mode: "adaptive", keyframes: [] }, content: [{ type: "fractal", chain: [{ formula: "mandelbulb" }] }] };
    const m = migrateScene(old);
    expect(m.ok && m.scene.schema_version).toBe(49);
    expect(m.ok && m.scene.material).toEqual(defaultMaterial());
    const parsed = parseScene(old);
    expect(parsed.ok && parsed.scene.material).toEqual(defaultMaterial());
  });

  const driven: MaterialSettings = {
    metallic: { measure: "cavity", curve: [{ position: 0, value: 1 }, { position: 1, value: 0 }], cycles: 2, offset: 0.25, wrap: "repeat" },
    roughness: 0.3,
    reflectivity: { measure: "color", curve: [{ position: 0, value: 0.2 }, { position: 0.5, value: 0.9 }, { position: 1, value: 0.4 }], cycles: 1, offset: 0, wrap: "mirror" },
  };

  it("is saved with the scene, read back unchanged and accepted by the schema", () => {
    const scene = { ...createDefaultScene(bulb), material: driven };
    const json = serializeScene(scene, library);
    const back = parseScene(json);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.scene.material).toEqual(driven);
    const validate = new Ajv({ strict: false }).compile(JSON.parse(readFileSync("schemas/scene.schema.json", "utf8")));
    expect(validate(JSON.parse(json)), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...JSON.parse(json), material: { metallic: 2 } })).toBe(false);
    expect(validate({ ...JSON.parse(json), material: { extra: 1 } })).toBe(false);
    expect(validate({ ...JSON.parse(json), material: { metallic: { measure: "cavity", curve: [{ position: 0, value: 0 }] } } })).toBe(false);
  });

  it("is refused when a value is outside 0 to 1, a curve is wrong or the measure is unknown, and all problems are reported", () => {
    const problems = (raw: unknown) => {
      const errors: string[] = [];
      readMaterial(raw, "material", errors);
      return errors.join("; ");
    };
    expect(problems({ metallic: 1.5 })).toMatch(/metallic/);
    expect(problems({ roughness: -0.1 })).toMatch(/roughness/);
    expect(problems({ metallic: "much" })).toMatch(/metallic/);
    const ok = { measure: "slope", curve: [{ position: 0, value: 0 }, { position: 1, value: 1 }] };
    expect(problems({ metallic: ok })).toBe("");
    expect(problems({ metallic: { ...ok, measure: "shininess" } })).toMatch(/measure/);
    expect(problems({ metallic: { ...ok, curve: [{ position: 0, value: 0 }] } })).toMatch(/curve/);
    expect(problems({ metallic: { ...ok, curve: [{ position: 0.5, value: 0 }, { position: 0.5, value: 1 }] } })).toMatch(/larger than the one before/);
    expect(problems({ metallic: { ...ok, curve: [{ position: 0, value: 2 }, { position: 1, value: 1 }] } })).toMatch(/curve\[0\]/);
    expect(problems({ metallic: { ...ok, cycles: 0 } })).toMatch(/cycles/);
    expect(problems({ metallic: { ...ok, offset: 2 } })).toMatch(/offset/);
    expect(problems({ metallic: { ...ok, wrap: "clamp" } })).toMatch(/wrap/);
    expect(problems({ metallic: -1, roughness: 5 }).split(";").length).toBe(2);
    expect(problems([])).toMatch(/must be an object/);
    expect(problems(undefined)).toBe("");
    const tooMany = { ...ok, curve: Array.from({ length: 17 }, (_, i) => ({ position: i / 16, value: 0.5 })) };
    expect(problems({ metallic: tooMany })).toMatch(/2 to 16/);
  });

  it("is packed for the shader: all zero for the default material; numbers and tables otherwise", () => {
    expect(Array.from(packMaterial(defaultMaterial(), 5).slice(0,124)).every((v) => v === 0)).toBe(true);
    const packed = packMaterial(driven, 9);
    expect(packed).toHaveLength(MATERIAL_FLOATS);
    expect(packed[0]).toBe(1);
    expect(packed[1]).toBe(9);
    // metallic: driven by cavity (index 3), 2 cycles, offset 0.25, repeat, then its table
    expect(Array.from(packed.slice(4, 8))).toEqual([0, 3, 2, 0.25]);
    expect(packed[8]).toBe(0);
    expect(Array.from(packed.slice(12, 12 + CURVE_TABLE_SIZE))).toEqual(Array.from(new Float32Array(curveTable((driven.metallic as unknown as { curve: { position: number; value: number }[] }).curve))));
    // roughness: a number
    expect(Array.from(packed.slice(44, 48))).toEqual([Math.fround(0.3), -1, 1, 0]);
    // reflectivity: driven by "the colour's measure" (5), mirror
    expect(Array.from(packed.slice(84, 88)).map((v) => +v.toFixed(6))).toEqual([0, 5, 1, 0]);
    expect(packed[88]).toBe(1);
  });

  it("lands at the end of the uniforms and leaves everything before it as without a material", () => {
    const basis = cameraBasis(createDefaultScene(bulb).camera);
    const without = packUniforms(basis, 100, 100);
    const withMat = packUniforms(basis, 100, 100, 50, [], undefined, [0, 0], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { settings: driven, maxLod: 9 });
    expect(withMat).toHaveLength(UNIFORM_FLOATS);
    expect(Array.from(withMat.slice(0, MATERIAL_OFFSET))).toEqual(Array.from(without.slice(0, MATERIAL_OFFSET)));
    expect(withMat[MATERIAL_OFFSET]).toBe(1);
    expect(without[MATERIAL_OFFSET]).toBe(0);
  });
});
