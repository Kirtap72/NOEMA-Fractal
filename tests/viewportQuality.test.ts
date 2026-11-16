import { describe, expect, it } from "vitest";
import {
  ViewportQualityController,
  viewportFeatureMask,
  FULL_VIEWPORT_FEATURES,
  NAVIGATE_FEATURES,
} from "../src/engine/viewportQuality";
import { defaultQuality } from "../src/engine/renderSetup";
import {
  packUniforms,
  MARCH_OFFSET,
  PARAM_OFFSET,
} from "../src/engine/uniforms";
import { cameraBasis } from "../src/engine/camera";
import { FpsCounter } from "../src/app/fps";

describe("temporary viewport quality policy", () => {
  it("excludes idle still-preview time when measuring new navigation FPS", () => {
    const fps = new FpsCounter(500);
    fps.tick(0);
    for (let i = 1; i <= 30; i++) fps.tick((i * 1000) / 60);
    expect(fps.fps).toBeCloseTo(60);
    fps.reset();
    expect(fps.tick(60000)).toBe(0);
    for (let i = 1; i <= 15; i++) fps.tick(60000 + (i * 1000) / 30);
    expect(fps.fps).toBeCloseTo(30);
  });
  it("defaults to Automatic; held input stays NAV, releasing waits 400 ms then refines", () => {
    const p = new ViewportQualityController(),
      q = defaultQuality();
    expect(p.mode).toBe("automatic");
    expect(p.plan(0, q).state).toBe("lookdev");
    p.hold(true, 10);
    expect(p.plan(5000, q).state).toBe("navigate");
    p.hold(false, 5000);
    expect(p.plan(5399, q).state).toBe("navigate");
    expect(p.plan(5400, q).state).toBe("lookdev");
  });
  it("each continuous edit cancels refinement; obsolete GPU completions cannot degrade a new view", () => {
    const p = new ViewportQualityController(),
      q = defaultQuality();
    p.touch(0);
    const nav = p.plan(0, q);
    p.resetCost();
    p.touch(300);
    p.complete(nav, 10000);
    expect(p.plan(650, q).state).toBe("navigate");
    expect(p.plan(650, q).scale).toBe(nav.scale);
    const still = p.plan(701, q);
    p.complete(still, 20);
    expect(p.plan(702, q).quality.max_steps).toBeGreaterThan(
      still.quality.max_steps,
    );
    p.touch(703);
    p.complete(still, 1);
    expect(p.plan(704, q).state).toBe("navigate");
  });
  it("keeps adapting while continuous camera events arrive before a NAV GPU frame completes", () => {
    const p = new ViewportQualityController(),
      q = defaultQuality();
    p.touch(0);
    const nav = p.plan(0, q);
    p.touch(10);
    p.plan(10, q);
    p.complete(nav, 200);
    expect(p.plan(20, q).scale).toBeLessThan(nav.scale);
    const current = p.plan(20, q),
      scale = current.scale;
    p.setMode("final");
    p.plan(411, q);
    p.complete(current, 300);
    p.setMode("navigate");
    expect(p.plan(412, q).scale).toBe(scale);
  });
  it("adapts expensive renders down to bounded resolution/steps without touching final values or step factor", () => {
    const p = new ViewportQualityController(),
      q = {
        ...defaultQuality(),
        step_factor: 0.2,
        max_steps: 4000,
        samples_per_pixel: 16,
      };
    const before = structuredClone(q);
    p.setMode("navigate");
    for (let i = 0; i < 25; i++) p.complete(p.plan(i, q), 300);
    const plan = p.plan(30, q);
    expect(plan.scale).toBe(0.0625);
    expect(plan.quality.max_steps).toBe(24);
    expect(plan.quality.step_factor).toBe(0.2);
    expect(plan.quality.samples_per_pixel).toBe(1);
    expect(plan.features).toEqual(NAVIGATE_FEATURES);
    expect(q).toEqual(before);
    p.setMode("final");
    expect(p.plan(31, q)).toMatchObject({
      scale: 1,
      quality: q,
      features: FULL_VIEWPORT_FEATURES,
    });
  });
  it("recovers full resolution for cheap scenes, and resets learned cost for a new workload", () => {
    const p = new ViewportQualityController(),
      q = defaultQuality();
    p.setMode("navigate");
    for (let i = 0; i < 20; i++) p.complete(p.plan(i, q), 3);
    expect(p.plan(21, q).scale).toBe(1);
    for (let i = 0; i < 10; i++) p.complete(p.plan(30 + i, q), 300);
    expect(p.plan(41, q).scale).toBeLessThan(0.1);
    p.resetCost();
    expect(p.plan(42, q).scale).toBe(0.5);
  });
  it("lookdev restores full effects, refines progressively and stops increasing costly work", () => {
    const p = new ViewportQualityController(),
      q = defaultQuality();
    p.setMode("lookdev");
    const a = p.plan(0, q);
    expect(a.features).toEqual({...FULL_VIEWPORT_FEATURES,secondaryReflections:false,filmNormals:false,filmHits:false});
    p.complete(a, 10);
    const b = p.plan(1, q);
    expect(b.scale).toBeGreaterThan(a.scale);
    expect(b.quality.max_steps).toBeGreaterThan(a.quality.max_steps);
    p.complete(b, 200);
    const c = p.plan(2, q);
    expect(c.scale).toBeLessThan(b.scale);
    for (let i = 0; i < 6; i++) p.complete(p.plan(i + 3, q), 10);
    expect(p.plan(10, q).scale).toBe(c.scale);
  });
  it("retains manual selection while Final Preview temporarily navigates; idle feedback never reduces stored final quality", () => {
    const p = new ViewportQualityController(),
      q = defaultQuality();
    for (const mode of ["navigate", "lookdev", "final"] as const) {
      p.setMode(mode);
      p.hold(true, 0);
      const a = p.plan(0, q);
      expect(p.mode).toBe(mode);
      expect(a.state).toBe(mode === "final" ? "navigate" : mode);
      if (mode === "final") {
        expect(a.features.secondaryReflections).toBe(false);
        p.hold(false, 1);
        const idle = p.plan(401, q);
        expect(idle.state).toBe("final");
        p.complete(idle, 10000);
        expect(p.plan(402, q)).toMatchObject({ scale: 1, quality: q });
      }
    }
  });
  it("feature flags use a previously reserved uniform and preserve camera, parameters, Julia and final defaults", () => {
    const basis = cameraBasis({
      position: [0, 0, 4],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov_degrees: 30,
    });
    const full = packUniforms(basis, 200, 100, 30, [0.4, 2]);
    const nav = packUniforms(
      basis,
      200,
      100,
      30,
      [0.4, 2],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      viewportFeatureMask(NAVIGATE_FEATURES),
    );
    expect(viewportFeatureMask(FULL_VIEWPORT_FEATURES)).toBe(0);
    expect(nav[19]).toBe(159);
    expect(full[19]).toBe(0);
    for (let i = 0; i < full.length; i++)
      if (i !== 19) expect(nav[i]).toBe(full[i]);
    expect(nav[PARAM_OFFSET]).toBeCloseTo(0.4);
    expect(nav[MARCH_OFFSET + 2]).toBe(220);
  });
});
