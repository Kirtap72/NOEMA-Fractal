import { Random, attemptSeed } from "./randomChain";
import type { Formula } from "./formula/types";

/**
 * "Random formula" (ARCHITECTURE.md 8.21, step 1): a grammar of operations that makes new formulas, not new chains.
 *
 * A generated formula is a small program: one round of 2 to 6 operations, repeated N times, with a flight (escape)
 * test and a distance estimate at the end. Every operation is a template written by hand and tested against the
 * building block it comes from (tests/formulaGrammar.test.ts); the generator only picks templates and fills in their
 * numbers. The result is saved as an ordinary formula file (format 1). Its credits are the union of the credits of the
 * building blocks it is made of, copied from their files with their status; the generator is never an author.
 *
 * The same seed and the same grammar version always give the same formula.
 */

export const GRAMMAR_VERSION = "G1";

/** The families of 8.21 section 3, in order of how reliable their distance estimate is. */
export const FORMULA_FAMILIES = ["kifs", "mandelbox", "kali", "mixed", "power"] as const;
export type FormulaFamily = (typeof FORMULA_FAMILIES)[number];

export const FAMILY_LABELS: Record<FormulaFamily, string> = {
  kifs: "A. Kaleidoscopic IFS",
  mandelbox: "B. Mandelbox family",
  kali: "C. Kali family",
  mixed: "D. Mixed folds",
  power: "E. With a power step",
};

export type OperationClass = "fold" | "scale" | "rotate" | "translate" | "power";

interface ParameterSpec {
  name: string;
  label: string;
  min: number;
  max: number;
  /** The range random values are drawn from (decided by the assistant: most values outside give nothing). */
  random: [number, number];
  /** Draw a whole number. */
  whole?: boolean;
  /** Draw the value with a random sign. */
  signed?: boolean;
}

interface Template {
  id: string;
  cls: OperationClass;
  /** Words for the description of the formula. */
  words: string;
  params: ParameterSpec[];
  /** Local variables (name without prefix, type, initial value). */
  locals: [string, "float" | "vec3", string][];
  /** Variants that change the code but have no slider (for example which axes are folded). */
  variants?: string[];
  /** The expression lines. `p(name)` is the parameter name in the file, `o(name)` a local variable. */
  lines(p: (n: string) => string, o: (n: string) => string, variant: string | undefined): string[];
  /** The formula files whose credits and sources this operation carries. "general" is textbook mathematics. */
  creditFrom: string[];
}

const ABS_VARIANTS: Record<string, string> = {
  xyz: "abs(z)",
  xy: "vec3(abs(z.x), abs(z.y), z.z)",
  xz: "vec3(abs(z.x), z.y, abs(z.z))",
  yz: "vec3(z.x, abs(z.y), abs(z.z))",
};

/** The templates. Each mirrors a building block in formulas/ line by line, with names made unique per operation. */
export const TEMPLATES: readonly Template[] = [
  {
    id: "abs",
    cls: "fold",
    words: "absolute value fold",
    params: [],
    locals: [],
    variants: Object.keys(ABS_VARIANTS),
    lines: (_p, _o, v) => [`z = ${ABS_VARIANTS[v ?? "xyz"]}`],
    creditFrom: ["abs-fold"],
  },
  {
    id: "tetra",
    cls: "fold",
    words: "tetrahedral fold",
    params: [],
    locals: [],
    lines: () => [
      "z = select(z, vec3(-z.y, -z.x, z.z), z.x + z.y < 0.0)",
      "z = select(z, vec3(-z.z, z.y, -z.x), z.x + z.z < 0.0)",
      "z = select(z, vec3(z.x, -z.z, -z.y), z.y + z.z < 0.0)",
    ],
    creditFrom: ["tetra-fold"],
  },
  {
    id: "octa",
    cls: "fold",
    words: "octahedral fold",
    params: [],
    locals: [],
    lines: () => ["z = abs(z)", "z = select(z, z.yxz, z.x < z.y)", "z = select(z, z.zyx, z.x < z.z)", "z = select(z, z.xzy, z.y < z.z)"],
    creditFrom: ["octa-fold"],
  },
  {
    id: "plane",
    cls: "fold",
    words: "plane fold",
    params: [
      { name: "nx", label: "normal x", min: -1, max: 1, random: [-1, 1] },
      { name: "ny", label: "normal y", min: -1, max: 1, random: [-1, 1] },
      { name: "nz", label: "normal z", min: -1, max: 1, random: [-1, 1] },
      { name: "d", label: "offset", min: -2, max: 2, random: [-0.5, 0.5] },
    ],
    locals: [
      ["n", "vec3", "vec3(1.0, 0.0, 0.0)"],
      ["t", "float", "0"],
    ],
    lines: (p, o) => [
      `${o("n")} = vec3(${p("nx")}, ${p("ny")}, ${p("nz")})`,
      `${o("t")} = (dot(z, ${o("n")}) - ${p("d")}) / max(dot(${o("n")}, ${o("n")}), 0.000001)`,
      `z = z - 2.0 * min(${o("t")}, 0.0) * ${o("n")}`,
    ],
    creditFrom: ["plane-fold"],
  },
  {
    id: "box",
    cls: "fold",
    words: "box fold",
    params: [{ name: "limit", label: "box fold limit", min: 0.1, max: 4, random: [0.5, 1.5] }],
    locals: [],
    lines: (p) => [`z = clamp(z, vec3(-${p("limit")}, -${p("limit")}, -${p("limit")}), vec3(${p("limit")}, ${p("limit")}, ${p("limit")})) * 2.0 - z`],
    creditFrom: ["box-fold"],
  },
  {
    id: "ball",
    cls: "fold",
    words: "sphere fold",
    params: [
      { name: "min_radius", label: "inner radius", min: 0.05, max: 1, random: [0.2, 0.7] },
      { name: "fixed_radius", label: "fixed radius", min: 0.2, max: 3, random: [0.8, 1.4] },
    ],
    locals: [
      ["r2", "float", "0"],
      ["k", "float", "1"],
    ],
    lines: (p, o) => [
      `${o("r2")} = max(dot(z, z), 0.000001)`,
      `${o("k")} = select(select(1.0, ${p("fixed_radius")} * ${p("fixed_radius")} / ${o("r2")}, ${o("r2")} < ${p("fixed_radius")} * ${p("fixed_radius")}), ${p("fixed_radius")} * ${p("fixed_radius")} / (${p("min_radius")} * ${p("min_radius")}), ${o("r2")} < ${p("min_radius")} * ${p("min_radius")})`,
      `z = z * ${o("k")}`,
      `dr = dr * ${o("k")}`,
    ],
    creditFrom: ["ball-fold"],
  },
  {
    id: "rotate",
    cls: "rotate",
    words: "rotation",
    params: [
      { name: "ax", label: "angle x (degrees)", min: -180, max: 180, random: [-45, 45] },
      { name: "ay", label: "angle y (degrees)", min: -180, max: 180, random: [-45, 45] },
      { name: "az", label: "angle z (degrees)", min: -180, max: 180, random: [-45, 45] },
    ],
    locals: [
      ["sx", "float", "0"],
      ["cx", "float", "1"],
      ["sy", "float", "0"],
      ["cy", "float", "1"],
      ["sz", "float", "0"],
      ["cz", "float", "1"],
    ],
    lines: (p, o) => [
      `${o("sx")} = sin(${p("ax")} * pi / 180.0)`,
      `${o("cx")} = cos(${p("ax")} * pi / 180.0)`,
      `${o("sy")} = sin(${p("ay")} * pi / 180.0)`,
      `${o("cy")} = cos(${p("ay")} * pi / 180.0)`,
      `${o("sz")} = sin(${p("az")} * pi / 180.0)`,
      `${o("cz")} = cos(${p("az")} * pi / 180.0)`,
      `z = vec3(z.x, z.y * ${o("cx")} - z.z * ${o("sx")}, z.y * ${o("sx")} + z.z * ${o("cx")})`,
      `z = vec3(z.x * ${o("cy")} + z.z * ${o("sy")}, z.y, -z.x * ${o("sy")} + z.z * ${o("cy")})`,
      `z = vec3(z.x * ${o("cz")} - z.y * ${o("sz")}, z.x * ${o("sz")} + z.y * ${o("cz")}, z.z)`,
    ],
    creditFrom: ["rotate"],
  },
  {
    id: "translate",
    cls: "translate",
    words: "shift",
    params: [
      { name: "tx", label: "shift x", min: -2, max: 2, random: [-0.5, 0.5] },
      { name: "ty", label: "shift y", min: -2, max: 2, random: [-0.5, 0.5] },
      { name: "tz", label: "shift z", min: -2, max: 2, random: [-0.5, 0.5] },
    ],
    locals: [],
    lines: (p) => [`z = z + vec3(${p("tx")}, ${p("ty")}, ${p("tz")})`],
    creditFrom: ["general"],
  },
  {
    id: "scale-about",
    cls: "scale",
    words: "scaling about a point",
    params: [
      { name: "scale", label: "scale", min: -4, max: 4, random: [1.6, 3.2] },
      { name: "cx", label: "centre x", min: -3, max: 3, random: [0.3, 1.5] },
      { name: "cy", label: "centre y", min: -3, max: 3, random: [0.3, 1.5] },
      { name: "cz", label: "centre z", min: -3, max: 3, random: [0.3, 1.5] },
    ],
    locals: [],
    lines: (p) => [`z = z * ${p("scale")} - vec3(${p("cx")}, ${p("cy")}, ${p("cz")}) * (${p("scale")} - 1.0)`, `dr = dr * abs(${p("scale")})`],
    creditFrom: ["scale-offset"],
  },
  {
    id: "scale-add",
    cls: "scale",
    words: "scaling with the point added",
    params: [{ name: "scale", label: "scale", min: -4, max: 4, random: [1.5, 3], signed: true }],
    locals: [],
    lines: (p) => [`z = z * ${p("scale")} + pos`, `dr = dr * abs(${p("scale")}) + 1.0`],
    creditFrom: ["scale-offset"],
  },
  {
    id: "menger",
    cls: "scale",
    words: "Menger fold",
    params: [
      { name: "scale", label: "Menger scale", min: 1.2, max: 4, random: [2.5, 3.3] },
      { name: "cx", label: "Menger centre x", min: 0, max: 2, random: [0.8, 1.2] },
      { name: "cy", label: "Menger centre y", min: 0, max: 2, random: [0.8, 1.2] },
      { name: "cz", label: "Menger centre z", min: 0, max: 2, random: [0.8, 1.2] },
    ],
    locals: [],
    lines: (p) => [
      "z = abs(z)",
      "z = select(z, z.yxz, z.x < z.y)",
      "z = select(z, z.zyx, z.x < z.z)",
      "z = select(z, z.xzy, z.y < z.z)",
      `z = vec3(z.x * ${p("scale")} - ${p("cx")} * (${p("scale")} - 1.0), z.y * ${p("scale")} - ${p("cy")} * (${p("scale")} - 1.0), z.z * ${p("scale")})`,
      `z = vec3(z.x, z.y, select(z.z, z.z - ${p("cz")} * (${p("scale")} - 1.0), z.z > 0.5 * ${p("cz")} * (${p("scale")} - 1.0)))`,
      `dr = dr * ${p("scale")}`,
    ],
    creditFrom: ["menger-fold"],
  },
  {
    id: "power",
    cls: "power",
    words: "triplex power (Mandelbulb step)",
    params: [{ name: "power", label: "power", min: 2, max: 16, random: [2, 10], whole: true }],
    locals: [
      ["r", "float", "0"],
      ["theta", "float", "0"],
      ["phi", "float", "0"],
    ],
    lines: (p, o) => [
      `${o("r")} = max(length(z), 0.000001)`,
      `${o("theta")} = acos(clamp(z.z / ${o("r")}, -1.0, 1.0)) * ${p("power")}`,
      `${o("phi")} = atan2(z.y, z.x) * ${p("power")}`,
      `dr = pow(${o("r")}, ${p("power")} - 1.0) * ${p("power")} * dr + 1.0`,
      `z = pow(${o("r")}, ${p("power")}) * vec3(sin(${o("theta")}) * cos(${o("phi")}), sin(${o("theta")}) * sin(${o("phi")}), cos(${o("theta")})) + pos`,
    ],
    creditFrom: ["mandelbulb"],
  },
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));
export function templateById(id: string): Template | undefined {
  return byId.get(id);
}

/** Which operations each family may use (8.21 section 3). The scale class is required, except in the power family. */
const FAMILY_POOLS: Record<FormulaFamily, { folds: string[]; scales: string[]; extras: string[] }> = {
  kifs: { folds: ["abs", "tetra", "octa", "plane"], scales: ["scale-about", "menger"], extras: ["rotate", "translate"] },
  mandelbox: { folds: ["box", "ball"], scales: ["scale-add"], extras: ["rotate"] },
  kali: { folds: ["abs", "ball"], scales: ["scale-about", "scale-add"], extras: ["rotate", "translate"] },
  mixed: { folds: ["abs", "tetra", "octa", "plane", "box", "ball"], scales: ["scale-about", "scale-add", "menger"], extras: ["rotate", "translate"] },
  power: { folds: ["abs", "octa", "tetra", "box", "ball", "plane"], scales: [], extras: ["rotate", "translate"] },
};

/** How the distance is measured at the end (8.21 section 3). */
export type FormulaEnd = { kind: "sphere"; radius: number } | { kind: "box"; size: number } | { kind: "point" } | { kind: "log" };

export interface Operation {
  template: string;
  variant?: string;
  params: Record<string, number>;
}

export interface FormulaProgram {
  grammar: typeof GRAMMAR_VERSION;
  seed: number;
  family: FormulaFamily;
  iterations: number;
  /** The round stops when dot(z, z) is above this. */
  bailout: number;
  operations: Operation[];
  end: FormulaEnd;
  /** Set for a mutation: the formula it was made from. */
  parent?: { id: string; variant: number };
}

export const MAX_OPERATIONS = 6;
export const MIN_OPERATIONS = 2;
export const FORMULA_PARAMETER_LIMIT = 16;

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function randomOperation(templateId: string, rng: Random): Operation {
  const t = byId.get(templateId)!;
  const params: Record<string, number> = {};
  for (const s of t.params) {
    let v = rng.range(s.random[0], s.random[1]);
    if (s.signed && rng.chance(0.4)) v = -v;
    v = s.whole ? Math.round(v) : round3(v);
    params[s.name] = Math.min(s.max, Math.max(s.min, v));
  }
  return { template: templateId, ...(t.variants ? { variant: rng.pick(t.variants) } : {}), params };
}

/** How many sliders a program has. */
export function parameterCount(program: Pick<FormulaProgram, "operations" | "end">): number {
  const ops = program.operations.reduce((n, op) => n + (byId.get(op.template)?.params.length ?? 0), 0);
  return ops + (program.end.kind === "sphere" || program.end.kind === "box" ? 1 : 0);
}

/** Problems with a program, by the rules of 8.21 section 1. Empty when it is fine. */
export function checkProgram(program: FormulaProgram): string[] {
  const errors: string[] = [];
  const ops = program.operations;
  if (ops.length < MIN_OPERATIONS || ops.length > MAX_OPERATIONS) errors.push(`a round has ${MIN_OPERATIONS} to ${MAX_OPERATIONS} operations`);
  for (const op of ops) if (!byId.has(op.template)) errors.push(`unknown operation "${op.template}"`);
  const cls = (op: Operation) => byId.get(op.template)?.cls;
  const powers = ops.filter((op) => cls(op) === "power").length;
  if (powers > 1) errors.push("at most one power step");
  if (program.family === "power" ? powers !== 1 : powers !== 0) errors.push("the power family has exactly one power step, the others none");
  const grows = ops.some((op) => cls(op) === "power" || (cls(op) === "scale" && Math.abs(op.params.scale ?? 0) > 1));
  if (!grows) errors.push("at least one scaling with |scale| > 1 (or a power step), or nothing grows");
  for (let i = 1; i < ops.length; i++) {
    if (ops[i]!.template === ops[i - 1]!.template && ops[i]!.variant === ops[i - 1]!.variant) errors.push("two identical operations in a row");
  }
  if (parameterCount(program) > FORMULA_PARAMETER_LIMIT) errors.push(`at most ${FORMULA_PARAMETER_LIMIT} parameters`);
  if (program.family === "power" ? program.end.kind !== "log" : program.end.kind === "log") errors.push("the power family uses the logarithmic distance, the others a linear one");
  if (!Number.isInteger(program.iterations) || program.iterations < 4 || program.iterations > 24) errors.push("4 to 24 iterations");
  return errors;
}

/** Makes the program for a seed (and a family, or one drawn from the seed). */
export function generateProgram(seed: number, options: { family?: FormulaFamily } = {}): FormulaProgram {
  // A few attempts with derived streams, so that the rules always hold; the first attempt nearly always does.
  for (let attempt = 0; attempt < 50; attempt++) {
    const rng = new Random(attemptSeed(seed, attempt + 1000));
    const drawn = rng.pick(FORMULA_FAMILIES);
    const family = options.family ?? drawn;
    const pool = FAMILY_POOLS[family];
    const operations: Operation[] = [];
    if (family === "power") {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) operations.push(randomOperation(rng.pick([...pool.folds, ...pool.extras]), rng));
      operations.splice(rng.int(0, operations.length), 0, randomOperation("power", rng));
    } else {
      const folds = rng.int(1, family === "mandelbox" ? 2 : 3);
      for (let i = 0; i < folds; i++) operations.push(randomOperation(rng.pick(pool.folds), rng));
      if (family === "mandelbox" && !operations.some((o) => o.template === "box")) operations.unshift(randomOperation("box", rng));
      if (rng.chance(0.5)) operations.splice(rng.int(0, operations.length), 0, randomOperation(rng.pick(pool.extras), rng));
      operations.push(randomOperation(rng.pick(pool.scales), rng));
    }
    const end: FormulaEnd =
      family === "power"
        ? { kind: "log" }
        : family === "mandelbox" || family === "kali"
          ? { kind: "point" }
          : rng.chance(0.5)
            ? { kind: "sphere", radius: round3(rng.range(0.5, 1.5)) }
            : { kind: "box", size: round3(rng.range(0.5, 1.2)) };
    const program: FormulaProgram = {
      grammar: GRAMMAR_VERSION,
      seed,
      family,
      iterations: family === "power" ? rng.int(6, 12) : rng.int(8, 18),
      bailout: family === "power" ? 256 : 10000,
      operations,
      end,
    };
    if (checkProgram(program).length === 0) return program;
  }
  throw new Error(`no valid formula for seed ${seed}`);
}

// ---- writing a program as a formula file

const q = (text: string): string => JSON.stringify(text);

/** The local and parameter names of operation k (1-based), so that two operations never share a name. */
const names = (k: number) => ({ p: (n: string) => `p${k}_${n}`, o: (n: string) => `o${k}_${n}` });

/** The distance expression and its end parameter (if any). */
function endCode(end: FormulaEnd): { distance: string; param?: string } {
  switch (end.kind) {
    case "sphere":
      return { distance: "(length(z) - end_radius) / abs(dr)", param: `  - { name: end_radius, label: ${q("end: sphere radius")}, default: ${end.radius}, min: 0.05, max: 3 }` };
    case "box":
      return {
        distance: "(length(max(abs(z) - vec3(end_size, end_size, end_size), vec3(0.0, 0.0, 0.0))) + min(max(abs(z).x - end_size, max(abs(z).y - end_size, abs(z).z - end_size)), 0.0)) / abs(dr)",
        param: `  - { name: end_size, label: ${q("end: box half size")}, default: ${end.size}, min: 0.05, max: 3 }`,
      };
    case "point":
      return { distance: "length(z) / abs(dr)" };
    case "log":
      return { distance: "0.5 * log(max(length(z), 0.000001)) * length(z) / abs(dr)" };
  }
}

/** The id of a generated formula. A mutation gets its own seed (made from its parent's), so ids stay unique. */
export function programId(program: FormulaProgram): string {
  return `slump-${program.seed}`;
}

/** A sentence that says what the formula does. */
export function describeProgram(program: FormulaProgram): string {
  const ops = program.operations.map((op) => {
    const t = byId.get(op.template)!;
    return op.variant && op.template === "abs" ? `${t.words} (${op.variant})` : t.words;
  });
  const end = { sphere: "the distance to a sphere", box: "the distance to a box", point: "the distance to the centre", log: "the logarithmic distance estimate" }[program.end.kind];
  return `Generated (${FAMILY_LABELS[program.family]}): ${ops.join(", then ")}; repeated ${program.iterations} times, measured by ${end}.`;
}

interface CreditLine {
  name: string;
  role?: string;
  status: string;
}
interface SourceLine {
  url?: string;
  reference?: string;
  status: string;
}

/** The credits and sources of a program: the union of those of the building blocks it uses, in order, without repeats. */
export function programCredits(program: FormulaProgram, library: readonly Formula[]): { credits: CreditLine[]; sources: SourceLine[]; missing: string[] } {
  const credits: CreditLine[] = [];
  const sources: SourceLine[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const add = <T>(list: T[], item: T) => {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      list.push(item);
    }
  };
  for (const op of program.operations) {
    for (const from of byId.get(op.template)!.creditFrom) {
      if (from === "general") {
        add(credits, { name: "General mathematics (textbook)", role: "standard definitions found in any textbook; no single person is credited (the project owner agreed that general mathematics is credited this way)", status: "unverified" });
        add(sources, { reference: "Translation of a point (textbook geometry)", status: "unverified" });
        continue;
      }
      const f = library.find((x) => x.id === from);
      if (!f) {
        missing.push(from);
        continue;
      }
      for (const c of f.credits) add(credits, { name: c.name, ...(c.role ? { role: c.role } : {}), status: c.status });
      for (const s of f.sources) add(sources, { ...(s.url ? { url: s.url } : {}), ...(s.reference ? { reference: s.reference } : {}), status: s.status });
    }
  }
  return { credits, sources, missing };
}

/**
 * The program as a formula file (format 1). The seed, the grammar version and the parent are written in `added_by`
 * and in a comment (decision 2 of 8.21: no change of the formula format). Throws if a building block whose credits
 * are needed is missing from the library, because a formula without credits must not be made (CLAUDE.md rule 2).
 */
export function programToFormulaText(program: FormulaProgram, library: readonly Formula[]): string {
  const problems = checkProgram(program);
  if (problems.length > 0) throw new Error(`the program breaks the grammar: ${problems.join("; ")}`);
  const { credits, sources, missing } = programCredits(program, library);
  if (missing.length > 0) throw new Error(`the credits of ${missing.join(", ")} are missing from the library`);

  const params: string[] = [];
  const variables: string[] = ["    - { name: z, type: vec3, init: pos }", "    - { name: dr, type: float, init: 1 }"];
  const steps: string[] = [`    - break_if: ${q(`dot(z, z) > ${program.bailout.toFixed(1)}`)}`];
  program.operations.forEach((op, i) => {
    const k = i + 1;
    const t = byId.get(op.template)!;
    const { p, o } = names(k);
    for (const s of t.params) params.push(`  - { name: ${p(s.name)}, label: ${q(`${k} ${t.words}: ${s.label}`)}, default: ${op.params[s.name]}, min: ${s.min}, max: ${s.max} }`);
    for (const [n, type, init] of t.locals) variables.push(`    - { name: ${o(n)}, type: ${type}, init: ${q(init)} }`);
    steps.push(`    # ${k}. ${t.words}${op.variant ? ` (${op.variant})` : ""}`);
    for (const line of t.lines(p, o, op.variant)) steps.push(`    - ${q(line)}`);
  });
  const end = endCode(program.end);
  if (end.param) params.push(end.param);
  const origin = `grammar ${program.grammar}, seed ${program.seed}${program.parent ? `, mutated from ${program.parent.id} (variant ${program.parent.variant})` : ""}`;
  // A Mandelbox reaches far out (about 6 units for scale 2), like the mandelbox file; the others fit in a few units.
  const cameraDistance = program.family === "mandelbox" ? 16 : 4;

  return `# A formula made by the random formula generator (${origin}). Format: see formulas/README.md
# The credits are those of the building blocks it is made of, copied with their status from their files.
format: 1
id: ${programId(program)}
name: ${q(`Random formula ${program.seed}${program.parent ? ` (variant of ${program.parent.id})` : ""}`)}
description: ${q(describeProgram(program))}
credits:
${credits.map((c) => `  - name: ${q(c.name)}\n${c.role ? `    role: ${q(c.role)}\n` : ""}    status: ${c.status}`).join("\n")}
sources:
${sources.map((s) => `  - ${s.url ? `url: ${s.url}` : `reference: ${q(s.reference!)}`}\n    status: ${s.status}`).join("\n")}
added_by: ${q(`Random formula generator (${origin})`)}
math_status: ${q("An automatic combination of the credited operations, each written fresh for this project from public mathematics; no code from any program was read or copied. Source details are unverified (see credits).")}
reviewed: false
${params.length > 0 ? `\nparameters:\n${params.join("\n")}\n` : ""}
iteration:
  iterations: ${program.iterations}
  carry: [z, dr]
  variables:
${variables.join("\n")}
  steps:
${steps.join("\n")}
  distance: ${q(end.distance)}

view:
  camera_distance: ${cameraDistance}
`;
}

/**
 * One operation alone as a transform file (no distance), for the tests that compare each template with the building
 * block it comes from.
 */
export function operationAsTransformText(op: Operation, library: readonly Formula[]): string {
  const t = byId.get(op.template)!;
  const { p, o } = names(1);
  const program: FormulaProgram = { grammar: GRAMMAR_VERSION, seed: 0, family: "mixed", iterations: 1, bailout: 1e30, operations: [op], end: { kind: "point" } };
  const { credits, sources } = programCredits(program, library);
  const params = t.params.map((s) => `  - { name: ${p(s.name)}, default: ${op.params[s.name]}, min: ${s.min}, max: ${s.max} }`);
  const variables = ["    - { name: z, type: vec3, init: pos }", "    - { name: dr, type: float, init: 1 }", ...t.locals.map(([n, type, init]) => `    - { name: ${o(n)}, type: ${type}, init: ${q(init)} }`)];
  return `format: 1
id: op-${t.id}${op.variant ? `-${op.variant}` : ""}
name: ${q(`operation ${t.id}`)}
credits:
${credits.map((c) => `  - name: ${q(c.name)}\n    status: ${c.status}`).join("\n")}
sources:
${sources.map((s) => `  - ${s.url ? `url: ${s.url}` : `reference: ${q(s.reference!)}`}\n    status: ${s.status}`).join("\n")}
added_by: test
math_status: test
reviewed: false
${params.length > 0 ? `parameters:\n${params.join("\n")}\n` : ""}iteration:
  iterations: 1
  carry: [z, dr]
  variables:
${variables.join("\n")}
  steps:
${t.lines(p, o, op.variant).map((l) => `    - ${q(l)}`).join("\n")}
`;
}

// ---- mutation (8.21 section 4)

export const MUTATION_STRENGTHS = ["small", "medium", "large"] as const;
export type MutationStrength = (typeof MUTATION_STRENGTHS)[number];
/** How far a parameter moves, as a share of its range (8.21: 5 to 15 per cent; "large" goes a little further). */
const STRENGTH_FRACTION: Record<MutationStrength, number> = { small: 0.05, medium: 0.1, large: 0.2 };

export type MutationKind = "parameters" | "swap" | "add-remove" | "reorder";

/** What variant number v of a set of 8 does: 5 small changes of numbers, then a swap, an addition or removal, a new order. */
export function mutationKind(variant: number): MutationKind {
  const k = ((variant % 8) + 8) % 8;
  return k < 5 ? "parameters" : k === 5 ? "swap" : k === 6 ? "add-remove" : "reorder";
}

function copyOps(ops: readonly Operation[]): Operation[] {
  return ops.map((o) => ({ ...o, params: { ...o.params } }));
}

/**
 * Variant number `variant` of a formula. Deterministic: the same parent, variant and strength give the same result.
 * The variant always follows the grammar's rules and differs from its parent; it carries its parent's id.
 */
export function mutateProgram(parent: FormulaProgram, variant: number, strength: MutationStrength = "medium"): FormulaProgram {
  const parentId = programId(parent);
  const pool = FAMILY_POOLS[parent.family];
  const frac = STRENGTH_FRACTION[strength];
  for (let attempt = 0; attempt < 40; attempt++) {
    const rng = new Random(attemptSeed(parent.seed, 7000 + variant * 64 + attempt + MUTATION_STRENGTHS.indexOf(strength) * 100000));
    // After 20 failed attempts of a structural change, fall back to a change of numbers, which nearly always works.
    const kind = attempt >= 20 ? "parameters" : mutationKind(variant);
    const ops = copyOps(parent.operations);
    let iterations = parent.iterations;
    let end: FormulaEnd = { ...parent.end };
    if (kind === "parameters") {
      const changes = rng.int(1, strength === "large" ? 4 : 3);
      for (let c = 0; c < changes; c++) {
        const targets: (() => void)[] = [];
        ops.forEach((op) => {
          for (const s of byId.get(op.template)!.params) {
            targets.push(() => {
              let v = op.params[s.name]! + (rng.next() * 2 - 1) * frac * (s.max - s.min);
              v = Math.min(s.max, Math.max(s.min, v));
              op.params[s.name] = s.whole ? Math.round(v) : round3(v);
            });
          }
        });
        if (end.kind === "sphere") targets.push(() => (end = { kind: "sphere", radius: round3(Math.min(3, Math.max(0.05, (end as { radius: number }).radius + (rng.next() * 2 - 1) * frac * 3))) }));
        if (end.kind === "box") targets.push(() => (end = { kind: "box", size: round3(Math.min(3, Math.max(0.05, (end as { size: number }).size + (rng.next() * 2 - 1) * frac * 3))) }));
        targets.push(() => (iterations = Math.min(24, Math.max(4, iterations + (rng.chance(0.5) ? 1 : -1) * rng.int(1, 2)))));
        rng.pick(targets)();
      }
    } else if (kind === "swap") {
      const i = rng.int(0, ops.length - 1);
      const t = byId.get(ops[i]!.template)!;
      const same = t.cls === "fold" ? pool.folds : t.cls === "scale" ? pool.scales : t.cls === "power" ? [] : pool.extras;
      const choices = same.filter((id) => id !== t.id);
      if (choices.length === 0) continue;
      ops[i] = randomOperation(rng.pick(choices), rng);
    } else if (kind === "add-remove") {
      if (ops.length > MIN_OPERATIONS && rng.chance(0.5)) ops.splice(rng.int(0, ops.length - 1), 1);
      else ops.splice(rng.int(0, ops.length), 0, randomOperation(rng.pick([...pool.folds, ...pool.extras]), rng));
    } else {
      if (ops.length < 2) continue;
      const i = rng.int(0, ops.length - 1);
      let j = rng.int(0, ops.length - 2);
      if (j >= i) j++;
      [ops[i], ops[j]] = [ops[j]!, ops[i]!];
    }
    const child: FormulaProgram = {
      ...parent,
      seed: attemptSeed(parent.seed, 9000 + variant + MUTATION_STRENGTHS.indexOf(strength) * 1000),
      iterations,
      operations: ops,
      end,
      parent: { id: parentId, variant },
    };
    const same = JSON.stringify({ o: child.operations, i: child.iterations, e: child.end }) === JSON.stringify({ o: parent.operations, i: parent.iterations, e: parent.end });
    if (!same && checkProgram(child).length === 0) return child;
  }
  throw new Error(`no valid variant ${variant} of ${parentId}`);
}
