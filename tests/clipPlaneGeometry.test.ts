import { describe, expect, it } from "vitest";
import { alignClipPlane, planePivot, rotateClipPlane, projectPoint, worldUnitsPerPixel, dot } from "../src/app/clipPlaneGeometry";
import { defaultClipPlane, clipRay } from "../src/engine/renderDetails";
import { cameraBasis, type SceneCamera } from "../src/engine/camera";
import { verticalFovDegrees } from "../src/engine/renderSetup";
const camera: SceneCamera = { position: [3,2,5], target: [1,-1,0], up: [0,1,0], fov_degrees: 60 };
describe("visual clip plane geometry", () => {
  it("camera alignment removes near half and passes through target", () => {
    const p = alignClipPlane(defaultClipPlane(),camera,"view"), b=cameraBasis(camera);
    expect(p.normal).toEqual(b.forward);expect(p.enabled&&p.invert).toBe(true);
    expect(clipRay(camera.position,b.forward,100,{planes:[p]})[0]).toBeCloseTo(Math.hypot(2,3,5),10);
    expect(camera.position).toEqual([3,2,5]);
  });
  it("left/right/top use camera axes and front uses world Z", () => {
    const b=cameraBasis(camera),left=alignClipPlane(defaultClipPlane(),camera,"left"),right=alignClipPlane(defaultClipPlane(),camera,"right");
    expect(left.normal.map(v=>-v)).toEqual(right.normal);expect(right.normal).toEqual(b.right);
    expect(alignClipPlane(defaultClipPlane(),camera,"top").normal).toEqual(b.up);
    expect(alignClipPlane(defaultClipPlane(),camera,"front").normal).toEqual([0,0,1]);
    for(const p of [left,right])expect(dot(p.normal,camera.target)).toBeCloseTo(p.offset);
  });
  it("scaled normal pivot and rotations preserve world point and inversion", () => {
    const p={...defaultClipPlane(),normal:[0,0,4] as [number,number,number],offset:2,invert:true},pivot=planePivot(p,camera.target);
    expect(pivot).toEqual([1,-1,2]);const r=rotateClipPlane(p,pivot,[0,1,0],Math.PI/2);
    expect(r.normal[0]).toBeCloseTo(1);expect(r.offset).toBeCloseTo(1);expect(r.invert).toBe(true);expect(dot(r.normal,pivot)).toBeCloseTo(r.offset);
  });
  it("projects in CSS pixels independent of adaptive resolution", () => {
    const projected=projectPoint(camera.target,camera,960,540)!;expect(projected[0]).toBeCloseTo(480);expect(projected[1]).toBeCloseTo(270);
    const b=cameraBasis(camera),scale=worldUnitsPerPixel(camera.target,camera,540),right=camera.target.map((v,i)=>v+b.right[i]!*scale*100) as [number,number,number];
    const r=projectPoint(right,camera,960,540)!;expect(r[0]).toBeCloseTo(580);expect(r[1]).toBeCloseTo(270);
    expect(projectPoint(camera.position,camera,960,540)).toBeNull();
  });
  it("horizontal FOV keeps horizontal handle scale through viewport aspect changes", () => {
    const c: SceneCamera={position:[0,0,0],target:[0,0,-1],up:[0,1,0],fov_degrees:60};
    for(const height of [540,960]) {
      const view={...c,fov_degrees:verticalFovDegrees(60,"horizontal",960,height)};
      expect(projectPoint([1,0,-2],view,960,height)![0]).toBeCloseTo(480+240/Math.tan(Math.PI/6));
    }
  });
});
