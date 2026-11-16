/**
 * The small expression language used in formula files.
 *
 * Only numbers, names we have declared, a fixed list of functions and a few
 * operators are allowed. Everything else is rejected, so a formula file can
 * never smuggle arbitrary shader code into the program.
 */

export type TranslateResult = { ok: true; wgsl: string } | { ok: false; error: string };

/** Formula function name -> shader function name. */
const FUNCTIONS: Record<string, string> = {
  length: "length",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  asin: "asin",
  acos: "acos",
  atan: "atan",
  atan2: "atan2",
  sqrt: "sqrt",
  pow: "pow",
  log: "log",
  exp: "exp",
  abs: "abs",
  min: "min",
  max: "max",
  floor: "floor",
  fract: "fract",
  dot: "dot",
  cross: "cross",
  normalize: "normalize",
  clamp: "clamp",
  mix: "mix",
  sign: "sign",
  step: "step",
  select: "select",
  vec3: "vec3f",
  vec4: "vec4f",
};

export const RESERVED_NAMES: ReadonlySet<string> = new Set([...Object.keys(FUNCTIONS), "pi", "pos"]);

const MAX_LENGTH = 400;
const TOKEN =
  /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|[-+*/(),.<>]))/y;

function numberLiteral(text: string): string {
  let t = text;
  if (t.startsWith(".")) t = "0" + t;
  if (/^\d+$/.test(t)) return t + ".0";
  if (/^\d+\.(?![0-9])/.test(t)) return t.replace(/^(\d+)\./, "$1.0");
  return t;
}

/**
 * Translates one expression to shader code.
 * `names` maps each allowed variable/parameter name to the name used in the shader.
 */
export function translateExpression(source: string, names: ReadonlyMap<string, string>): TranslateResult {
  if (source.length > MAX_LENGTH) return { ok: false, error: `expression is longer than ${MAX_LENGTH} characters` };

  const tokens: { kind: "num" | "id" | "op"; text: string }[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < source.length) {
    if (/^\s*$/.test(source.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(source);
    if (!m) {
      const bad = source.slice(pos).trim()[0];
      return { ok: false, error: `character "${bad}" is not allowed in an expression` };
    }
    if (m[1] !== undefined) tokens.push({ kind: "num", text: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: "id", text: m[2] });
    else tokens.push({ kind: "op", text: m[3]! });
    pos = TOKEN.lastIndex;
  }
  if (tokens.length === 0) return { ok: false, error: "expression is empty" };

  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];

    if (tok.kind === "num") {
      out.push(numberLiteral(tok.text));
    } else if (tok.kind === "op") {
      if (tok.text === "(") depth++;
      if (tok.text === ")") {
        depth--;
        if (depth < 0) return { ok: false, error: "unbalanced parentheses" };
      }
      if (tok.text === ".") {
        const swizzle = next?.kind === "id" && /^[xyzw]{1,4}$/.test(next.text);
        const afterValue = prev !== undefined && (prev.kind === "id" || prev.text === ")");
        if (!swizzle || !afterValue) return { ok: false, error: 'a "." must be followed by x, y, z or w (for example z.x)' };
        out.push("." + next!.text);
        i++; // the swizzle letters are already emitted
        continue;
      }
      out.push(tok.text);
    } else if (next?.text === "(") {
      const fn = FUNCTIONS[tok.text];
      if (fn === undefined || !Object.hasOwn(FUNCTIONS, tok.text)) {
        return { ok: false, error: `unknown function "${tok.text}"` };
      }
      out.push(fn);
    } else if (tok.text === "pi") {
      out.push("3.14159265358979");
    } else if (names.has(tok.text)) {
      out.push(names.get(tok.text)!);
    } else {
      return { ok: false, error: `unknown name "${tok.text}"` };
    }
  }
  if (depth !== 0) return { ok: false, error: "unbalanced parentheses" };
  return { ok: true, wgsl: out.join(" ").replace(/ \./g, ".") };
}
