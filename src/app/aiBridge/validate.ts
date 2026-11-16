/**
 * A small JSON Schema subset validator for the AI bridge (defence in depth: the MCP shim validates with Zod, and the app
 * validates again here, so a hand-written client on the pipe cannot bypass the limits). Supported keywords are exactly the
 * ones the capability manifest uses: type, enum, minimum, maximum, minLength, maxLength, pattern, required, properties,
 * additionalProperties:false, items, minItems, maxItems, uniqueItems. An empty schema `{}` accepts anything.
 */
export type JsonSchema = Record<string, unknown>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Returns every problem found (empty list = valid). Paths are `$`, `$.changes[0].index`, ... */
export function validateAgainst(schema: JsonSchema, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  const type = schema.type as string | undefined;
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    return [`${path} must be one of ${JSON.stringify(schema.enum)}`];
  }
  if (type === 'object') {
    if (!isObj(value)) return [`${path} must be an object`];
    const props = isObj(schema.properties) ? schema.properties : {};
    for (const key of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
      if (!(key in value) || value[key] === undefined) errors.push(`${path}.${key} is required`);
    }
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const sub = props[key];
      if (sub === undefined) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key} is not a known field`);
        continue;
      }
      errors.push(...validateAgainst(sub as JsonSchema, v, `${path}.${key}`));
    }
    return errors;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path} must be a list`];
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${path} may have at most ${schema.maxItems} items`);
    if (schema.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push(`${path} must not repeat items`);
    if (isObj(schema.items)) value.slice(0, 1000).forEach((v, i) => errors.push(...validateAgainst(schema.items as JsonSchema, v, `${path}[${i}]`)));
    return errors;
  }
  if (type === 'string') {
    if (typeof value !== 'string') return [`${path} must be a text`];
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength} characters`);
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength} characters`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${path} has an invalid format`);
    return errors;
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path} must be a finite number`];
    if (type === 'integer' && !Number.isInteger(value)) errors.push(`${path} must be a whole number`);
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}`);
    return errors;
  }
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [`${path} must be true or false`];
  return errors;
}

/** Fills in `default` values of top-level properties that are absent. Returns a new object. */
export function withDefaults(schema: JsonSchema, value: Record<string, unknown>): Record<string, unknown> {
  const out = { ...value };
  const props = isObj(schema.properties) ? schema.properties : {};
  for (const [key, sub] of Object.entries(props)) if (out[key] === undefined && isObj(sub) && 'default' in sub) out[key] = sub.default;
  return out;
}
