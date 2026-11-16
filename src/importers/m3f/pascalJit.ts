/**
 * FORMULA-IMPORTER-01: a parser for the small Pascal subset that readable Mandelbulb 3D JIT formulas use. It never evaluates anything.
 *
 * Accepted shape (anything else is rejected with a named reason):
 *   procedure Name(var x, y, z, w: Double; PIteration3D: TPIteration3D);
 *   var a, b: Double; i: Integer;
 *   begin  assignments, if/then/else, begin..end, sincos(a, s, c)  end;
 * Expressions: numbers, names, PIteration3D.J1..J3, + - * / div mod, not/and/or/xor, comparisons, and a fixed list of math functions.
 * Not accepted: loops, case, functions, nested procedures, pointers, arrays, strings, records other than PIteration3D, inline assembly.
 */
export type JitType = 'real' | 'int' | 'bool';
export type Expr =
  | { k: 'num'; v: number; t: JitType }
  | { k: 'id'; name: string; t: JitType }
  | { k: 'field'; name: string; t: JitType }
  | { k: 'un'; op: '-' | '+' | 'not'; e: Expr; t: JitType }
  | { k: 'bin'; op: string; l: Expr; r: Expr; t: JitType }
  | { k: 'call'; name: string; args: Expr[]; t: JitType };
export type Stmt =
  | { k: 'assign'; name: string; e: Expr; line: number }
  | { k: 'if'; cond: Expr; then: Stmt; else: Stmt | null; line: number }
  | { k: 'block'; body: Stmt[] }
  | { k: 'sincos'; angle: Expr; sin: string; cos: string; line: number };
export interface JitProgram {
  name: string;
  coords: [string, string, string, string];
  iterVar: string;
  locals: Map<string, 'real' | 'int'>;
  body: Stmt[];
  /** Names used from the option list (read only). */
  optionsUsed: Set<string>;
  usesW: boolean;
  /** True when w really is a fourth coordinate: some value computed from w ends up in x, y or z (directly, through a local, or through a condition on w). */
  wIsCoordinate: boolean;
  usesJulia: boolean;
}
export interface Diagnostic { line: number; message: string }
export type JitParse = { ok: true; program: JitProgram; warnings: Diagnostic[] } | { ok: false; errors: Diagnostic[] };

/** Functions with their argument types and result type. `real` accepts an integer argument too. */
export const JIT_FUNCTIONS: Record<string, { args: ('real' | 'int')[]; result: 'real' | 'int' }> = {
  abs: { args: ['real'], result: 'real' }, sqrt: { args: ['real'], result: 'real' }, sqr: { args: ['real'], result: 'real' },
  sin: { args: ['real'], result: 'real' }, cos: { args: ['real'], result: 'real' }, tan: { args: ['real'], result: 'real' },
  arctan: { args: ['real'], result: 'real' }, arctan2: { args: ['real', 'real'], result: 'real' }, arcsin: { args: ['real'], result: 'real' }, arccos: { args: ['real'], result: 'real' },
  exp: { args: ['real'], result: 'real' }, ln: { args: ['real'], result: 'real' }, power: { args: ['real', 'real'], result: 'real' }, intpower: { args: ['real', 'int'], result: 'real' },
  lnxp1: { args: ['real'], result: 'real' }, sinh: { args: ['real'], result: 'real' }, cosh: { args: ['real'], result: 'real' }, tanh: { args: ['real'], result: 'real' },
  round: { args: ['real'], result: 'int' }, trunc: { args: ['real'], result: 'int' }, degtorad: { args: ['real'], result: 'real' }, radtodeg: { args: ['real'], result: 'real' },
};

interface Token { t: 'id' | 'num' | 'op' | 'eof'; v: string; line: number }
const OPS = [':=', '<>', '<=', '>=', '+', '-', '*', '/', '(', ')', ',', ';', ':', '.', '=', '<', '>', '^'];
const UNSUPPORTED_WORDS = new Set(['for', 'while', 'repeat', 'until', 'case', 'function', 'goto', 'with', 'asm', 'try', 'except', 'finally', 'array', 'record', 'string', 'class', 'inherited', 'exit', 'break', 'continue', 'uses', 'type', 'const']);

function tokenize(src: string, errors: Diagnostic[]): Token[] {
  const out: Token[] = []; let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') { while (i < src.length && src[i] !== '}') { if (src[i] === '\n') line++; i++; } i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '(' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === ')')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++; out.push({ t: 'id', v: src.slice(i, j), line }); i = j; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!; let text = m[0];
      if (text.endsWith('.') && !/^\d/.test(src[i + text.length] ?? '')) text = text.slice(0, -1); // "1." followed by a name or ".." is not part of the number
      out.push({ t: 'num', v: text, line }); i += text.length; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op, line }); i += op.length; continue; }
    errors.push({ line, message: `The character "${c}" is not part of the supported JIT subset (strings, hexadecimal numbers and similar are not accepted).` });
    i++;
  }
  out.push({ t: 'eof', v: '', line });
  return out;
}

export function parseJit(source: string, options: ReadonlyMap<string, 'real' | 'int'>, constants: ReadonlyMap<string, number> = new Map()): JitParse {
  const errors: Diagnostic[] = [], warnings: Diagnostic[] = [];
  const toks = tokenize(source, errors);
  if (errors.length) return { ok: false, errors };
  let p = 0;
  const peek = (): Token => toks[p]!;
  const lower = (t: Token): string => t.v.toLowerCase();
  const fail = (line: number, message: string): never => { throw Object.assign(new Error(message), { line }); };
  const isId = (w: string): boolean => peek().t === 'id' && lower(peek()) === w;
  const isOp = (o: string): boolean => peek().t === 'op' && peek().v === o;
  const expectOp = (o: string): void => { if (!isOp(o)) fail(peek().line, `Expected "${o}" but found "${peek().v || 'end of file'}".`); p++; };
  const expectId = (w: string): void => { if (!isId(w)) fail(peek().line, `Expected "${w}" but found "${peek().v || 'end of file'}".`); p++; };
  const ident = (): Token => { const t = peek(); if (t.t !== 'id') fail(t.line, `Expected a name but found "${t.v || 'end of file'}".`); p++; return t; };

  const program: JitProgram = { name: '', coords: ['x', 'y', 'z', 'w'], iterVar: 'PIteration3D', locals: new Map(), body: [], optionsUsed: new Set(), usesW: false, wIsCoordinate: false, usesJulia: false };
  try {
    for (const t of toks) if (t.t === 'id' && UNSUPPORTED_WORDS.has(lower(t))) fail(t.line, `"${t.v}" is not supported: the JIT subset has no loops, case statements, functions or nested declarations.`);
    expectId('procedure'); program.name = ident().v; expectOp('(');
    expectId('var');
    const coords: string[] = [ident().v]; while (isOp(',')) { p++; coords.push(ident().v); }
    expectOp(':'); expectId('double'); expectOp(';');
    if (coords.length !== 4) fail(peek().line, 'The procedure must take exactly four coordinates (x, y, z, w).');
    program.coords = coords as JitProgram['coords'];
    program.iterVar = ident().v; expectOp(':'); expectId('tpiteration3d'); expectOp(')'); expectOp(';');
    const cl = coords.map((c) => c.toLowerCase());
    if (new Set(cl).size !== 4) fail(peek().line, 'The four coordinate names must differ.');
    const scope = new Map<string, 'real' | 'int'>(); for (const c of cl) scope.set(c, 'real');
    const iter = program.iterVar.toLowerCase();
    // optional declarations
    while (isId('var')) {
      p++;
      while (peek().t === 'id' && !isId('begin') && !isId('var')) {
        const names = [ident().v]; while (isOp(',')) { p++; names.push(ident().v); }
        expectOp(':'); const ty = ident(); const tl = lower(ty);
        if (tl !== 'double' && tl !== 'integer') fail(ty.line, `The type "${ty.v}" is not supported: only Double and Integer variables.`);
        expectOp(';');
        for (const n of names) { const nl = n.toLowerCase(); if (scope.has(nl) || options.has(nl) || nl === iter) fail(ty.line, `The name "${n}" is declared twice.`); scope.set(nl, tl === 'double' ? 'real' : 'int'); program.locals.set(nl, tl === 'double' ? 'real' : 'int'); }
      }
    }
    // expressions with Pascal precedence: relational < additive < multiplicative < unary
    const mk = {
      num: (v: number, t: JitType): Expr => ({ k: 'num', v, t }),
    };
    const need = (e: Expr, want: 'real' | 'int' | 'bool', line: number, what: string): void => {
      const ok = want === 'real' ? e.t === 'real' || e.t === 'int' : e.t === want;
      if (!ok) fail(line, `${what} must be ${want === 'bool' ? 'a condition' : want === 'int' ? 'an integer' : 'a number'}, not ${e.t === 'bool' ? 'a condition' : e.t === 'int' ? 'an integer' : 'a real number'}.`);
    };
    const primary = (): Expr => {
      const t = peek();
      if (t.t === 'num') { p++; const v = Number(t.v); return mk.num(v, /^\d+$/.test(t.v) ? 'int' : 'real'); }
      if (isOp('(')) { p++; const e = expr(); expectOp(')'); return e; }
      if (t.t !== 'id') fail(t.line, `Expected a value but found "${t.v || 'end of file'}".`);
      p++; const name = lower(t);
      if (name === iter) {
        if (isOp('^')) p++; // PIteration3D^.J1: the parameter is a pointer to the record, written with a dereference
        expectOp('.'); const f = ident(); const fl = f.v.toUpperCase();
        if (fl !== 'J1' && fl !== 'J2' && fl !== 'J3') fail(f.line, `PIteration3D.${f.v} is not supported: only J1, J2 and J3 (the iteration constant) can be read.`);
        program.usesJulia = true; return { k: 'field', name: fl, t: 'real' };
      }
      if (isOp('(')) {
        const fn = JIT_FUNCTIONS[name];
        if (!fn) fail(t.line, `The function "${t.v}" is not supported.`);
        p++; const args: Expr[] = []; if (!isOp(')')) { args.push(expr()); while (isOp(',')) { p++; args.push(expr()); } } expectOp(')');
        const sig = JIT_FUNCTIONS[name]!;
        if (args.length !== sig.args.length) fail(t.line, `${t.v} takes ${sig.args.length} argument(s), not ${args.length}.`);
        args.forEach((a, i) => need(a, sig.args[i] === 'int' ? 'int' : 'real', t.line, `Argument ${i + 1} of ${t.v}`));
        return { k: 'call', name, args, t: sig.result };
      }
      const ty = scope.get(name);
      if (ty) { if (cl[3] === name) program.usesW = true; return { k: 'id', name, t: ty }; }
      const oty = options.get(name);
      if (oty) { program.optionsUsed.add(name); return { k: 'id', name, t: oty }; }
      // A constant of the file's own [CONSTANTS] section: a fixed number, written into the tree as the literal the file states.
      const cv = constants.get(name);
      if (cv !== undefined) return mk.num(cv, 'real');
      fail(t.line, `The name "${t.v}" is not declared (not a coordinate, a local variable or a formula option).`);
      return mk.num(0, 'real');
    };
    const unary = (): Expr => {
      const t = peek();
      if (isOp('-') || isOp('+')) { p++; const e = unary(); need(e, 'real', t.line, `The operand of "${t.v}"`); return { k: 'un', op: t.v as '-' | '+', e, t: e.t }; }
      if (isId('not')) { p++; const e = unary(); need(e, 'bool', t.line, 'The operand of "not"'); return { k: 'un', op: 'not', e, t: 'bool' }; }
      return primary();
    };
    const mulop = (): Expr => {
      let l = unary();
      for (;;) {
        const t = peek(); const w = lower(t);
        const op = t.t === 'op' && (t.v === '*' || t.v === '/') ? t.v : t.t === 'id' && (w === 'div' || w === 'mod' || w === 'and') ? w : '';
        if (!op) return l;
        p++; const r = unary();
        if (op === 'and') { need(l, 'bool', t.line, 'The left side of "and"'); need(r, 'bool', t.line, 'The right side of "and"'); l = { k: 'bin', op, l, r, t: 'bool' }; continue; }
        if (op === 'div' || op === 'mod') { need(l, 'int', t.line, `The left side of "${op}"`); need(r, 'int', t.line, `The right side of "${op}"`); l = { k: 'bin', op, l, r, t: 'int' }; continue; }
        need(l, 'real', t.line, 'The left operand'); need(r, 'real', t.line, 'The right operand');
        l = { k: 'bin', op, l, r, t: op === '/' ? 'real' : l.t === 'int' && r.t === 'int' ? 'int' : 'real' };
      }
    };
    const addop = (): Expr => {
      let l = mulop();
      for (;;) {
        const t = peek(); const w = lower(t);
        const op = t.t === 'op' && (t.v === '+' || t.v === '-') ? t.v : t.t === 'id' && (w === 'or' || w === 'xor') ? w : '';
        if (!op) return l;
        p++; const r = mulop();
        if (op === 'or' || op === 'xor') { need(l, 'bool', t.line, `The left side of "${op}"`); need(r, 'bool', t.line, `The right side of "${op}"`); l = { k: 'bin', op, l, r, t: 'bool' }; continue; }
        need(l, 'real', t.line, 'The left operand'); need(r, 'real', t.line, 'The right operand');
        l = { k: 'bin', op, l, r, t: l.t === 'int' && r.t === 'int' ? 'int' : 'real' };
      }
    };
    function expr(): Expr {
      const l = addop(); const t = peek();
      if (t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        p++; const r = addop(); need(l, 'real', t.line, 'The left side of a comparison'); need(r, 'real', t.line, 'The right side of a comparison');
        return { k: 'bin', op: t.v, l, r, t: 'bool' };
      }
      return l;
    }
    const stmt = (): Stmt => {
      const t = peek();
      if (isId('begin')) { p++; const body: Stmt[] = []; while (!isId('end')) { if (peek().t === 'eof') fail(t.line, 'A "begin" has no matching "end".'); const s = stmt(); body.push(s); if (isOp(';')) p++; else if (!isId('end')) fail(peek().line, `Expected ";" or "end" but found "${peek().v}".`); } p++; return { k: 'block', body }; }
      if (isId('if')) {
        p++; const cond = expr(); need(cond, 'bool', t.line, 'The condition of "if"'); expectId('then');
        const th = stmtOrEmpty(); let el: Stmt | null = null; if (isId('else')) { p++; el = stmtOrEmpty(); }
        return { k: 'if', cond, then: th, else: el, line: t.line };
      }
      if (t.t === 'id' && lower(t) === 'sincos') {
        p++; expectOp('('); const angle = expr(); need(angle, 'real', t.line, 'The angle of sincos'); expectOp(',');
        const s = ident(), sl = s.v.toLowerCase(); expectOp(','); const c = ident(), cl2 = c.v.toLowerCase(); expectOp(')');
        for (const n of [sl, cl2]) if (scope.get(n) !== 'real') fail(t.line, `sincos needs real variables for its results; "${n}" is not one.`);
        return { k: 'sincos', angle, sin: sl, cos: cl2, line: t.line };
      }
      if (t.t === 'id') {
        const name = lower(t);
        if (name === iter || (options.has(name) || constants.has(name)) && !scope.has(name)) fail(t.line, `"${t.v}" is read only (formula options and PIteration3D cannot be assigned).`);
        if (!scope.has(name)) fail(t.line, `The name "${t.v}" is not declared.`);
        p++; expectOp(':='); const e = expr(); const ty = scope.get(name)!;
        if (ty === 'int' && e.t !== 'int') fail(t.line, `"${t.v}" is an Integer: assign it an integer expression (use round or trunc).`);
        if (ty === 'real' && e.t === 'bool') fail(t.line, `"${t.v}" is a number: a condition cannot be assigned to it.`);
        if (cl[3] === name) program.usesW = true;
        return { k: 'assign', name, e, line: t.line };
      }
      return fail(t.line, `A statement cannot start with "${t.v || 'end of file'}".`);
    };
    const stmtOrEmpty = (): Stmt => (isOp(';') || isId('else') || isId('end') ? { k: 'block', body: [] } : stmt());
    expectId('begin'); p--; // let stmt() read the block
    const main = stmt() as { k: 'block'; body: Stmt[] };
    if (isOp(';') || isOp('.')) p++;
    if (peek().t !== 'eof') fail(peek().line, `Unexpected "${peek().v}" after the end of the procedure (only one procedure is supported).`);
    program.body = main.body;
    if (program.usesW) program.wIsCoordinate = wFeedsXyz(program);
    return { ok: true, program, warnings };
  } catch (e) {
    const err = e as Error & { line?: number };
    return { ok: false, errors: [{ line: err.line ?? 0, message: err.message }] };
  }
}


/**
 * Dataflow over the syntax tree: does anything computed from w reach x, y or z? Conditions count (an `if` on a w-dependent test that
 * assigns x, y or z makes them w-dependent). Pure syntax analysis; nothing is evaluated.
 */
export function wFeedsXyz(program: JitProgram): boolean {
  const [cx, cy, cz, cw] = program.coords.map((n) => n.toLowerCase()) as [string, string, string, string];
  const tainted = new Set<string>([cw]);
  const reads = (e: Expr): boolean => { switch (e.k) { case 'id': return tainted.has(e.name); case 'un': return reads(e.e); case 'bin': return reads(e.l) || reads(e.r); case 'call': return e.args.some(reads); default: return false; } };
  let changed = true;
  const walk = (s: Stmt, underTaint: boolean): void => {
    if (s.k === 'block') { s.body.forEach((t) => walk(t, underTaint)); return; }
    if (s.k === 'if') { const c = underTaint || reads(s.cond); walk(s.then, c); if (s.else) walk(s.else, c); return; }
    if (s.k === 'sincos') { if ((underTaint || reads(s.angle)) && !(tainted.has(s.sin) && tainted.has(s.cos))) { tainted.add(s.sin); tainted.add(s.cos); changed = true; } return; }
    if ((underTaint || reads(s.e)) && !tainted.has(s.name)) { tainted.add(s.name); changed = true; }
  };
  for (let i = 0; i < 50 && changed; i++) { changed = false; program.body.forEach((s) => walk(s, false)); }
  return [cx, cy, cz].some((n) => tainted.has(n));
}
