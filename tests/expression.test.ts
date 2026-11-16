import { describe, expect, it } from "vitest";
import { translateExpression } from "../src/engine/formula/expression";

const names = new Map([
  ["pos", "pos"],
  ["z", "v_z"],
  ["power", "u.params[0].x"],
]);
const ok = (src: string): string => {
  const r = translateExpression(src, names);
  if (!r.ok) throw new Error(r.error);
  return r.wgsl;
};
const fail = (src: string): string => {
  const r = translateExpression(src, names);
  if (r.ok) throw new Error("expected failure, got: " + r.wgsl);
  return r.error;
};

describe("translateExpression", () => {
  it("turns whole numbers into floating point numbers", () => {
    expect(ok("1")).toBe("1.0");
    expect(ok("2. + .5")).toBe("2.0 + 0.5");
    expect(ok("1e4")).toBe("1e4");
  });

  it("renames variables and parameters", () => {
    expect(ok("z * power")).toBe("v_z * u.params[0].x");
  });

  it("keeps swizzles attached", () => {
    expect(ok("z.x + z.yz.x")).toBe("v_z.x + v_z.yz.x");
  });

  it("accepts vec4 and the w component", () => {
    expect(ok("vec4(1, 2, 3, 4)")).toBe("vec4f ( 1.0 , 2.0 , 3.0 , 4.0 )");
    expect(ok("z.w + z.xyzw.x")).toBe("v_z.w + v_z.xyzw.x");
  });

  it("maps vec3 to the shader's vec3f and knows pi", () => {
    expect(ok("vec3(1, 2, 3)")).toBe("vec3f ( 1.0 , 2.0 , 3.0 )");
    expect(ok("pi")).toContain("3.14159");
  });

  it("allows comparisons", () => {
    expect(ok("length(z) > 4.0")).toBe("length ( v_z ) > 4.0");
  });

  it("rejects unknown names and functions", () => {
    expect(fail("foo + 1")).toMatch(/unknown name "foo"/);
    expect(fail("textureLoad(z)")).toMatch(/unknown function/);
  });

  it("rejects inherited object keys as functions", () => {
    expect(fail("constructor(z)")).toMatch(/unknown function/);
    expect(fail("toString(z)")).toMatch(/unknown function/);
  });

  it("rejects characters that could inject shader code", () => {
    expect(fail("1; discard")).toMatch(/not allowed/);
    expect(fail("z } fn evil() {")).toMatch(/not allowed/);
    expect(fail('1 + "a"')).toMatch(/not allowed/);
    expect(fail("a[0]")).toMatch(/not allowed/);
  });

  it("rejects unbalanced parentheses and empty input", () => {
    expect(fail("(1 + 2")).toMatch(/parentheses/);
    expect(fail("1 + 2)")).toMatch(/parentheses/);
    expect(fail("   ")).toMatch(/empty/);
  });

  it("rejects bad swizzles", () => {
    expect(fail("z.q")).toMatch(/"\."/);
    expect(fail("z.xyzwx")).toMatch(/"\."/);
    expect(fail("1 .x")).toMatch(/"\."/);
  });

  it("rejects very long expressions", () => {
    expect(fail("1+".repeat(300) + "1")).toMatch(/longer/);
  });
});
