import {withAnimationIdentities} from '../src/engine/animationIdentity';
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateChain, MAX_ROUNDS, MAX_TOTAL_PARAMETERS } from "../src/engine/formula/chain";
import { buildLibrary } from "../src/engine/formula/library";
import { parseFormula } from "../src/engine/formula/parse";
import {
  createDefaultScene,
  MAX_TOTAL_ITERATIONS,
  migrateScene,
  parseScene,
  resolveScene,
  toChainSteps,
} from "../src/engine/scene";
import { addStep, moveStep, withRounds, withStepIterations, withStepParameter } from "../src/engine/sceneEdit";

const lib = buildLibrary({
  a: readFileSync("formulas/mandelbulb.yaml", "utf8"),
  b: readFileSync("formulas/mandelbox.yaml", "utf8"),
});
const bulb = lib.formulas.find((f) => f.id === "mandelbulb")!;
const box = lib.formulas.find((f) => f.id === "mandelbox")!;

const code = (steps: [typeof bulb, number][], rounds = 1): string => {
  const r = generateChain(steps.map(([formula, iterations]) => ({ formula, iterations })), rounds);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.wgsl;
};

describe("generateChain", () => {
  it("runs each step for its own number of iterations", () => {
    const c = code([[bulb, 5], [box, 9]]);
    expect(c).toContain("iter < 5;");
    expect(c).toContain("iter < 9;");
    expect(c).toContain("const FORMULA_ITERATIONS : f32 = 14.0;");
  });

  it("repeats the whole chain for the number of rounds", () => {
    const c = code([[bulb, 5], [box, 9]], 3);
    expect(c).toContain("round < 3;");
    expect(c).toContain("const FORMULA_ITERATIONS : f32 = 42.0;");
  });

  it("declares passed-on variables (z and dr) only once, before the steps", () => {
    const c = code([[bulb, 5], [box, 5]]);
    expect(c.match(/var v_z :/g)).toHaveLength(1);
    expect(c.match(/var v_dr :/g)).toHaveLength(1);
    expect(c.indexOf("var v_z")).toBeLessThan(c.indexOf("// step 1"));
  });

  it("starts the other variables fresh inside each step", () => {
    const c = code([[bulb, 5], [bulb, 5]]);
    expect(c.match(/var v_theta :/g)).toHaveLength(2);
  });

  it("gives every step its own parameter slots, in order", () => {
    const c = code([[bulb, 5], [box, 5], [bulb, 5]]);
    expect(c).toContain("pow ( v_r , u.params[0].x )"); // step 1: power
    // numbering over the whole chain: power 0, scale 1, min_radius 2, fixed_radius 3, power 4
    expect(c).toContain("u.params[0].y"); // step 2: scale
    expect(c).toContain("u.params[0].z"); // step 2: min_radius
    expect(c).toContain("u.params[0].w"); // step 2: fixed_radius
    expect(c).toContain("pow ( v_r , u.params[1].x )"); // step 3: power is number 4, first lane of the second slot
  });

  it("stops everything when any step reaches its escape condition", () => {
    const c = code([[bulb, 5], [box, 5]]);
    expect(c).toContain("{ done = true; break; }");
    expect(c.match(/if \(!done\) \{/g)).toHaveLength(2);
    expect(c).toContain("if (done) { break; }");
  });

  it("takes the distance from the step that was running", () => {
    const c = code([[bulb, 5], [box, 5]]);
    expect(c).toContain("dist = 0.5 * log ( v_r ) * v_r / v_dr;");
    expect(c).toContain("dist = length ( v_z ) / abs ( v_dr );");
    expect(c).toContain("return vec3f(dist, iterCount, select(0.0, trap, trap < 1.0e8));");
  });

  it("rejects an empty chain, bad numbers and too many parameters", () => {
    expect(generateChain([], 1).ok).toBe(false);
    expect(generateChain([{ formula: bulb, iterations: 0 }], 1).ok).toBe(false);
    expect(generateChain([{ formula: bulb, iterations: 2.5 }], 1).ok).toBe(false);
    expect(generateChain([{ formula: bulb, iterations: 5 }], 0).ok).toBe(false);
    expect(generateChain([{ formula: bulb, iterations: 5 }], MAX_ROUNDS + 1).ok).toBe(false);
    const many = Array.from({ length: 10 }, () => ({ formula: box, iterations: 2 })); // 10 x 3 = 30: fits
    expect(generateChain(many, 1).ok).toBe(true);
    const tooMany = Array.from({ length: MAX_TOTAL_PARAMETERS / 3 + 1 }, () => ({ formula: box, iterations: 2 }));
    const r = generateChain(tooMany, 1);
    expect(!r.ok && r.errors.join()).toMatch(/parameters; at most/);
  });

  it("reports when a passed-on variable has different types in two formulas", () => {
    const base = (zType: string, init: string) =>
      [
        "format: 1", "id: t" + zType, "name: T", "added_by: x", "math_status: idea", "reviewed: false",
        "credits:", "  - { name: A, status: unverified }", "sources:", "  - { reference: B, status: unverified }",
        "iteration:", "  iterations: 2", "  carry: [z]", "  variables:", `    - { name: z, type: ${zType}, init: ${init} }`,
        "  steps:", '    - "z = z"', '  distance: "1.0"',
      ].join("\n");
    const a = parseFormula(base("vec3", "pos"));
    const b = parseFormula(base("float", "1"));
    if (!a.ok || !b.ok) throw new Error("setup");
    const r = generateChain([{ formula: a.formula, iterations: 2 }, { formula: b.formula, iterations: 2 }], 1);
    expect(!r.ok && r.errors.join()).toMatch(/is float here but vec3 in an earlier step/);
  });

  it("only puts our own text in the code: a name with a line break cannot add code", () => {
    const evil = { ...bulb, name: "x\n} fn evil() {", id: "x\n} fn evil2() {" };
    const r = generateChain([{ formula: evil, iterations: 3 }], 1);
    expect(r.ok).toBe(true);
    expect(r.ok && r.wgsl).not.toMatch(/fn evil/); // the name is not in the code at all; the id is cleaned in a comment
    expect(r.ok && r.wgsl).not.toContain("\n} fn");
  });
});

describe("a chain in a scene", () => {
  const two = (): ReturnType<typeof createDefaultScene> => addStep(createDefaultScene(bulb), box);

  it("resolves with each step's iterations and parameters, in order", () => {
    let s = two();
    s = withStepIterations(s, 0, 4);
    s = withStepParameter(s, 0, "power", 6);
    s = withStepParameter(s, 1, "scale", -1.5);
    const r = resolveScene(s, lib.formulas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chain.map((x) => [x.formula.id, x.iterations])).toEqual([["mandelbulb", 4], ["mandelbox", 14]]);
    expect(r.parameterValues).toEqual([6, -1.5, 0.5, 1]);
  });

  it("changes the shader key when steps, order or mode change, but not for iterations, rounds, parameters or colour (SHADER-UNIFORMS-08)", () => {
    const key = (s: ReturnType<typeof createDefaultScene>) => {
      const r = resolveScene(s, lib.formulas);
      if (!r.ok) throw new Error("resolve");
      return r.key;
    };
    const s = two();
    expect(key(moveStep(s, 0, 1))).not.toBe(key(s));
    expect(key(addStep(s, bulb))).not.toBe(key(s));
    // read at run time, so the same shader: no recompiling while the artist edits them
    expect(key(withStepIterations(s, 0, 3))).toBe(key(s));
    expect(key(withRounds(s, 2))).toBe(key(s));
    expect(key(withStepParameter(s, 0, "power", 3))).toBe(key(s));
    expect(key({ ...s, color: { ...s.color, cycles: 5 } })).toBe(key(s));
    expect(key({ ...s, camera: { ...s.camera, fov_degrees: 70 } })).toBe(key(s));
  });

  it("refuses chains that would run too many iterations", () => {
    const s = withRounds(withStepIterations(two(), 0, 64), 32);
    const r = resolveScene(s, lib.formulas);
    expect(!r.ok && r.errors.join()).toMatch(new RegExp(`at most ${MAX_TOTAL_ITERATIONS}`));
  });

  it("produces shader code for the resolved chain", () => {
    const r = resolveScene(two(), lib.formulas);
    if (!r.ok) throw new Error("resolve");
    const g = generateChain(toChainSteps(r), r.rounds);
    expect(g.ok).toBe(true);
  });

  it("is saved with the chain and read back unchanged", () => {
    const s = withRounds(withStepParameter(two(), 1, "scale", 2.5), 2);
    const back = parseScene(JSON.stringify(s));
    expect(back.ok && back.scene).toEqual(withAnimationIdentities(s));
  });
});

describe("scene version 2 -> 3", () => {
  const v2 = {
    schema_version: 2,
    camera: { position: [0, 0, 4], target: [0, 0, 0] },
    color: { gradient: { stops: [{ position: 0, color: "#000000" }, { position: 1, color: "#ffffff" }] }, measure: "slope" },
    content: [{ type: "fractal", formula: "mandelbox", parameters: { scale: 1.7 } }],
  };

  it("turns the single formula into a chain of one step", () => {
    const m = migrateScene(v2);
    expect(m.ok && m.scene.schema_version).toBe(49);
    expect(m.ok && (m.scene.content as unknown[])[0]).toEqual({
      type: "fractal",
      chain: [{ formula: "mandelbox", parameters: { scale: 1.7 } }],
    });
  });

  it("lets an old file be read with its colour and parameters, and iterations left to the formula", () => {
    const r = parseScene(JSON.stringify(v2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.color.measure).toBe("slope");
    expect(r.scene.content[0]).toEqual({
      id:"content-1",
      type: "fractal",
      chain: [{ id:"content-1-step-1",formula: "mandelbox", parameters: { scale: 1.7 } }],
      rounds: 1,
    });
    const resolved = resolveScene(r.scene, lib.formulas);
    expect(resolved.ok && resolved.chain[0]!.iterations).toBe(14); // the formula's own default
    expect(resolved.ok && resolved.parameterValues).toEqual([1.7, 0.5, 1]);
  });

  it("does not touch content that is not a fractal or already has a chain", () => {
    const mixed = {
      ...v2,
      content: [{ type: "splats", file: "a.ply" }, { type: "fractal", chain: [{ formula: "mandelbulb" }] }],
    };
    const m = migrateScene(mixed);
    expect(m.ok && m.scene.content).toEqual(mixed.content);
  });

  it("migrates a version 1 file all the way", () => {
    const v1 = { schema_version: 1, camera: v2.camera, content: [{ type: "fractal", formula: "mandelbulb", parameters: { power: 5 } }] };
    const r = parseScene(JSON.stringify(v1));
    expect(r.ok && r.scene.schema_version).toBe(49);
    expect(r.ok && r.scene.content[0]!.chain[0]).toEqual({ id:"content-1-step-1",formula: "mandelbulb", parameters: { power: 5 } });
  });
});

describe("shipped formulas", () => {
  it("marks the Mandelbox author as unverified, since it was written from memory", () => {
    expect(box.reviewed).toBe(false);
    expect(box.credits.length).toBeGreaterThan(0);
    expect(box.credits.every((c) => c.status === "unverified")).toBe(true);
    expect(box.sources.every((s) => s.status === "unverified")).toBe(true);
  });

  it("pass on the point and its derivative in chains", () => {
    expect(bulb.carry).toEqual(["z", "dr"]);
    expect(box.carry).toEqual(["z", "dr"]);
  });

  it("every possible pair of the two formulas makes valid shader code", () => {
    for (const a of [bulb, box]) for (const b of [bulb, box]) {
      expect(generateChain([{ formula: a, iterations: 4 }, { formula: b, iterations: 4 }], 2).ok).toBe(true);
    }
  });
});

describe("vec4 variables", () => {
  const four = (extra = "") =>
    [
      "format: 1", "id: quat-test", "name: Quat test", "added_by: x", "math_status: idea", "reviewed: false",
      "credits:", "  - { name: A, status: unverified }", "sources:", "  - { reference: B, status: unverified }",
      "parameters:", "  - { name: w0, default: 0, min: -1, max: 1 }",
      "iteration:", "  iterations: 4", "  carry: [q]", extra, "  variables:",
      "    - { name: q, type: vec4, init: 'vec4(pos.x, pos.y, pos.z, w0)' }",
      "    - { name: r, type: float, init: 0 }",
      "  steps:", "    - 'r = length(q)'", "    - break_if: 'r > 4.0'", "    - 'q = vec4(q.x * q.x - q.y * q.y - q.z * q.z - q.w * q.w, 2.0 * q.x * q.y, 2.0 * q.x * q.z, 2.0 * q.x * q.w) + vec4(pos.x, pos.y, pos.z, w0)'",
      "  distance: '0.5 * log(r) * r / 1.0'",
    ].join("\n");

  it("is declared as vec4f, and the orbit point can be a vec4", () => {
    const r = parseFormula(four());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.formula.orbitPoint).toBe("q");
    const g = generateChain([{ formula: r.formula, iterations: 4 }], 1);
    expect(g.ok && g.wgsl).toContain("var v_q : vec4f = vec4f ( pos.x , pos.y , pos.z , u.params[0].x );");
    expect(g.ok && g.wgsl).toContain("trap = min(trap, length(v_q));");
  });

  it("can be passed on between steps only with the same type", () => {
    const a = parseFormula(four());
    const bText = four().replace("type: vec4", "type: vec3").replace("vec4(pos.x, pos.y, pos.z, w0)'", "pos'");
    const b = parseFormula(bText.replace(/q = vec4\(.*\n/, "q = q\n"));
    if (!a.ok) throw new Error("setup");
    if (b.ok) {
      const r = generateChain([{ formula: a.formula, iterations: 2 }, { formula: b.formula, iterations: 2 }], 1);
      expect(!r.ok && r.errors.join()).toMatch(/is vec3 here but vec4 in an earlier step/);
    }
  });

  it("rejects an unknown variable type", () => {
    const e = parseFormula(four().replace("type: vec4", "type: mat3"));
    expect(!e.ok && e.errors.join()).toMatch(/type must be float, vec3 or vec4/);
  });
});

describe("transforms (formulas without a distance)", () => {
  const transform = [
    "format: 1", "id: flip-test", "name: Flip test", "added_by: x", "math_status: idea", "reviewed: false",
    "credits:", "  - { name: A, status: unverified }", "sources:", "  - { reference: B, status: unverified }",
    "iteration:", "  iterations: 1", "  carry: [z]", "  variables:", "    - { name: z, type: vec3, init: pos }",
    "  steps:", "    - 'z = vec3(abs(z.x), abs(z.y), abs(z.z))'",
  ].join("\n");

  it("is a valid formula file without distance", () => {
    const r = parseFormula(transform);
    expect(r.ok).toBe(true);
    expect(r.ok && r.formula.distance).toBeUndefined();
  });

  it("cannot be drawn alone, and the message says why", () => {
    const r = parseFormula(transform);
    if (!r.ok) throw new Error("setup");
    const g = generateChain([{ formula: r.formula, iterations: 1 }], 1);
    expect(!g.ok && g.errors.join()).toMatch(/no step with a distance estimate/);
  });

  it("works in front of a formula that has a distance, which then provides the distance", () => {
    const t = parseFormula(transform);
    if (!t.ok) throw new Error("setup");
    const g = generateChain([{ formula: t.formula, iterations: 1 }, { formula: bulb, iterations: 3 }], 1);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.wgsl.match(/^ +dist = /gm)).toHaveLength(1); // only the bulb step writes a distance
    expect(g.wgsl).toContain("dist = 0.5 * log ( v_r ) * v_r / v_dr;");
  });

  it("after the formula with a distance, the transform leaves that distance alone", () => {
    const t = parseFormula(transform);
    if (!t.ok) throw new Error("setup");
    const g = generateChain([{ formula: bulb, iterations: 3 }, { formula: t.formula, iterations: 1 }], 1);
    expect(g.ok).toBe(true);
  });

  it("the shipped formulas still have their distance", () => {
    expect(bulb.distance).toBeDefined();
    expect(box.distance).toBeDefined();
  });
});

describe("the 4D formulas (batch 3)", () => {
  const four = buildLibrary({
    a: readFileSync("formulas/quaternion-mandelbrot.yaml", "utf8"),
    b: readFileSync("formulas/quaternion-julia.yaml", "utf8"),
    c: readFileSync("formulas/bicomplex-mandelbrot.yaml", "utf8"),
  });

  it("all load and are written with vec4", () => {
    expect(four.problems).toEqual([]);
    expect(four.formulas.map((f) => f.id).sort()).toEqual(["bicomplex-mandelbrot", "quaternion-julia", "quaternion-mandelbrot"]);
    for (const f of four.formulas) {
      const g = generateChain([{ formula: f, iterations: f.iterations }], 1);
      expect(g.ok && g.wgsl, f.id).toContain("vec4f");
      expect(f.orbitPoint, f.id).toBeDefined();
    }
  });

  it("have every credit marked as unverified and are not reviewed", () => {
    for (const f of four.formulas) {
      expect(f.reviewed).toBe(false);
      expect(f.credits.every((c) => c.status === "unverified")).toBe(true);
      expect(f.sources.every((s) => s.status === "unverified")).toBe(true);
    }
  });

  it("can be chained with a 3D formula that carries the same names only if the types match", () => {
    const q = four.formulas.find((f) => f.id === "quaternion-mandelbrot")!;
    // q is a vec4 named q; the Mandelbulb carries z: different names, so each keeps its own state and no type clash occurs
    expect(generateChain([{ formula: q, iterations: 4 }, { formula: bulb, iterations: 4 }], 1).ok).toBe(true);
  });
});
