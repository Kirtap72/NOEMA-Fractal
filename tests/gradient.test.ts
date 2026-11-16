import {withAnimationIdentities} from '../src/engine/animationIdentity';
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGradientLibrary,
  COLOR_FLOATS,
  DEFAULT_COLOR,
  gradientAt,
  LUT_OFFSET,
  LUT_SIZE,
  MEASURES,
  packColor,
  parseGradientFile,
  readColorSettings,
  readGradient,
} from "../src/engine/gradient";
import type { GradientStop } from "../src/engine/gradient";
import { migrateScene, parseScene } from "../src/engine/scene";
import { buildLibrary } from "../src/engine/formula/library";
import { createDefaultScene, resolveScene } from "../src/engine/scene";
import { parseFormula } from "../src/engine/formula/parse";
import { wgslOf } from "./helpers";

const BW: GradientStop[] = [
  { position: 0, color: "#000000" },
  { position: 1, color: "#ffffff" },
];

const errorsOfGradient = (raw: unknown): string[] => {
  const errors: string[] = [];
  readGradient(raw, "g", errors);
  return errors;
};

describe("gradientAt", () => {
  it("gives the end colours at the ends and the middle in between", () => {
    expect(gradientAt(BW, 0)).toEqual([0, 0, 0]);
    expect(gradientAt(BW, 1)).toEqual([1, 1, 1]);
    expect(gradientAt(BW, 0.5)[0]).toBeCloseTo(0.5);
  });

  it("holds the first and last colour outside the stops", () => {
    const stops: GradientStop[] = [
      { position: 0.2, color: "#ff0000" },
      { position: 0.8, color: "#0000ff" },
    ];
    expect(gradientAt(stops, 0)).toEqual([1, 0, 0]);
    expect(gradientAt(stops, 1)).toEqual([0, 0, 1]);
  });

  it("makes a hard edge where two stops have the same position", () => {
    const stops: GradientStop[] = [
      { position: 0, color: "#ff0000" },
      { position: 0.5, color: "#ff0000" },
      { position: 0.5, color: "#0000ff" },
      { position: 1, color: "#0000ff" },
    ];
    expect(gradientAt(stops, 0.49)).toEqual([1, 0, 0]);
    expect(gradientAt(stops, 0.51)).toEqual([0, 0, 1]);
  });
});

describe("packColor", () => {
  it("writes measure, cycles, offset and wrap first", () => {
    const out = packColor({ ...DEFAULT_COLOR, measure: "slope", cycles: 3, offset: 0.25, wrap: "repeat" });
    expect(out.length).toBe(COLOR_FLOATS);
    expect(out[0]).toBe(MEASURES.indexOf("slope"));
    expect([out[1], out[2], out[3]]).toEqual([3, 0.25, 0]);
    expect(packColor({ ...DEFAULT_COLOR, wrap: "mirror" })[3]).toBe(1);
  });

  it("fills a table of 256 colours, converted to linear light", () => {
    const out = packColor({ ...DEFAULT_COLOR, gradient: { stops: BW } });
    expect(out[LUT_OFFSET]).toBe(0); // first colour: black
    const last = LUT_OFFSET + (LUT_SIZE - 1) * 4;
    expect(out[last]).toBeCloseTo(1);
    expect(out[last + 3]).toBe(1);
    const mid = LUT_OFFSET + 128 * 4; // about 50% in sRGB is about 22% in linear light
    expect(out[mid]).toBeCloseTo(0.5 ** 2.2, 1);
  });
});

describe("readGradient", () => {
  it("accepts a valid gradient and normalises colours to lower case", () => {
    const errors: string[] = [];
    const g = readGradient({ stops: [{ position: 0, color: "#FF00AA" }, { position: 1, color: "#00ff00" }] }, "g", errors);
    expect(errors).toEqual([]);
    expect(g?.stops[0]?.color).toBe("#ff00aa");
  });

  it("rejects bad colours, positions and counts", () => {
    expect(errorsOfGradient({ stops: [{ position: 0, color: "red" }, { position: 1, color: "#000000" }] }).join()).toMatch(/#rrggbb/);
    expect(errorsOfGradient({ stops: [{ position: -1, color: "#000000" }, { position: 1, color: "#000000" }] }).join()).toMatch(/0 to 1/);
    expect(errorsOfGradient({ stops: [{ position: 0, color: "#000000" }] }).join()).toMatch(/2 to 256/);
    const many = Array.from({ length: 257 }, (_, i) => ({ position: i / 256, color: "#000000" }));
    expect(errorsOfGradient({ stops: many }).join()).toMatch(/2 to 256/);
    expect(errorsOfGradient({ stops: [{ position: 0.5, color: "#000000" }, { position: 0.2, color: "#000000" }] }).join()).toMatch(
      /smaller than the one before/,
    );
  });

  it("rejects text that could break out of the page styling", () => {
    const e = errorsOfGradient({ stops: [{ position: 0, color: "#000000; background: url(x)" }, { position: 1, color: "#000000" }] });
    expect(e.join()).toMatch(/#rrggbb/);
  });
});

describe("readColorSettings", () => {
  const ok = { gradient: { stops: BW }, measure: "cavity" };
  it("fills in defaults", () => {
    const errors: string[] = [];
    const c = readColorSettings(ok, "color", errors);
    expect(errors).toEqual([]);
    expect(c).toMatchObject({ measure: "cavity", cycles: 1, offset: 0, wrap: "mirror" });
  });
  it("rejects unknown measures and out of range values", () => {
    for (const bad of [{ measure: "vibes" }, { cycles: 0 }, { cycles: 99 }, { offset: 1000 }, { wrap: "bounce" }]) {
      const errors: string[] = [];
      readColorSettings({ ...ok, ...bad }, "color", errors);
      expect(errors.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});

describe("scene version 1 -> 2", () => {
  const v1 = {
    schema_version: 1,
    camera: { position: [0, 0, 4], target: [0, 0, 0] },
    content: [{ type: "fractal", formula: "mandelbulb", parameters: { power: 7 } }],
  };

  it("adds the default colouring to an old scene", () => {
    const m = migrateScene(v1);
    expect(m.ok && m.scene.schema_version).toBe(49);
    expect(m.ok && m.scene.color).toEqual(DEFAULT_COLOR);
  });

  it("lets an old scene file be read, keeping everything else", () => {
    const r = parseScene(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.schema_version).toBe(49);
    expect({...r.scene.color,gradient:{...r.scene.color.gradient,stops:r.scene.color.gradient.stops.map(({id,...stop})=>stop)}}).toEqual(DEFAULT_COLOR);
    expect(r.scene.content[0]!.chain).toEqual([{ id:"content-1-step-1",formula: "mandelbulb", parameters: { power: 7 } }]);
  });

  it("does not share the default object between scenes", () => {
    const a = parseScene(v1);
    const b = parseScene(v1);
    if (!a.ok || !b.ok) throw new Error("parse failed");
    a.scene.color.cycles = 9;
    expect(b.scene.color.cycles).toBe(1);
    expect(DEFAULT_COLOR.cycles).toBe(1);
  });
});

describe("colour in a scene", () => {
  const bulb = buildLibrary({ f: readFileSync("formulas/mandelbulb.yaml", "utf8") }).formulas[0]!;

  it("is saved and read back with the gradient inside the scene", () => {
    const scene = createDefaultScene(bulb);
    scene.color = {
      gradient: { id: "mine", name: "Min", stops: BW },
      measure: "iterations",
      cycles: 2,
      offset: 0.3,
      wrap: "repeat",
    };
    const back = parseScene(JSON.stringify(scene));
    expect(back.ok && back.scene.color).toEqual(withAnimationIdentities(scene).color);
  });

  it("is passed to the shader as packed data when the scene is resolved", () => {
    const r = resolveScene(createDefaultScene(bulb), [bulb]);
    expect(r.ok && r.colorData.length).toBe(COLOR_FLOATS);
  });
});

describe("gradient files", () => {
  it("reads a valid file", () => {
    const text = [
      "format: 1",
      "id: test-grad",
      "name: Test",
      "author: Someone",
      "stops:",
      "  - { position: 0, color: '#000000' }",
      "  - { position: 1, color: '#ffffff' }",
    ].join("\n");
    const r = parseGradientFile(text);
    expect(r.ok && r.gradient.author).toBe("Someone");
  });

  it("requires an author", () => {
    const text = "format: 1\nid: a\nname: A\nstops:\n  - { position: 0, color: '#000000' }\n  - { position: 1, color: '#ffffff' }";
    const r = parseGradientFile(text);
    expect(!r.ok && r.errors.join()).toMatch(/author is required/);
  });

  it("all shipped gradient files are valid and have unique ids", () => {
    const files: Record<string, string> = {};
    for (const name of readdirSync("gradients")) {
      if (name.endsWith(".yaml")) files[name] = readFileSync(`gradients/${name}`, "utf8");
    }
    const lib = buildGradientLibrary(files);
    expect(lib.problems).toEqual([]);
    expect(lib.gradients.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects a second file with the same id", () => {
    const text = "format: 1\nid: a\nname: A\nauthor: X\nstops:\n  - { position: 0, color: '#000000' }\n  - { position: 1, color: '#ffffff' }";
    const lib = buildGradientLibrary({ "a.yaml": text, "b.yaml": text });
    expect(lib.gradients).toHaveLength(1);
    expect(lib.problems[0]!.errors[0]).toMatch(/already used/);
  });
});

describe("orbit point in formula files", () => {
  const base = (iteration: string) =>
    [
      "format: 1",
      "id: t",
      "name: T",
      "added_by: x",
      "math_status: idea",
      "reviewed: false",
      "credits:",
      "  - { name: A, status: unverified }",
      "sources:",
      "  - { reference: B, status: unverified }",
      iteration,
    ].join("\n");
  const iter = (extra: string, vars: string) =>
    `iteration:\n  iterations: 3\n${extra}  variables:\n${vars}  steps:\n    - "r = length(z)"\n  distance: "r"`;

  it("defaults to the first vec3 variable", () => {
    const r = parseFormula(
      base(iter("", "    - { name: r, type: float, init: 0 }\n    - { name: z, type: vec3, init: pos }\n")),
    );
    expect(r.ok && r.formula.orbitPoint).toBe("z");
  });

  it("can be chosen with orbit_point", () => {
    const vars = "    - { name: z, type: vec3, init: pos }\n    - { name: w, type: vec3, init: pos }\n    - { name: r, type: float, init: 0 }\n";
    const r = parseFormula(base(iter("  orbit_point: w\n", vars)));
    expect(r.ok && r.formula.orbitPoint).toBe("w");
    expect(r.ok && wgslOf(r.formula)).toContain("length(v_w)");
  });

  it("must name a vec3 or vec4 variable", () => {
    const vars = "    - { name: z, type: vec3, init: pos }\n    - { name: r, type: float, init: 0 }\n";
    const r = parseFormula(base(iter("  orbit_point: r\n", vars)));
    expect(!r.ok && r.errors.join()).toMatch(/orbit_point must name a declared vec3 or vec4 variable/);
  });

  it("is optional: without any vec3 variable the trap is simply 0", () => {
    const text = base(
      'iteration:\n  iterations: 3\n  variables:\n    - { name: r, type: float, init: 1 }\n  steps:\n    - "r = r * 0.5"\n  distance: "r"',
    );
    const r = parseFormula(text);
    expect(r.ok && wgslOf(r.formula)).toContain("select(0.0, trap, trap < 1.0e8)");
  });
});
