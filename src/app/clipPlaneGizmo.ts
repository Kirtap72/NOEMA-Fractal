import { cameraFov } from '../engine/cameraOptics';
import type { Scene } from "../engine/scene";
import { cameraBasis } from "../engine/camera";
import { verticalFovDegrees } from "../engine/renderSetup";
import { add, cross, mul, planePivot, projectPoint, rotateClipPlane, unit, worldUnitsPerPixel } from "./clipPlaneGeometry";

const NS = "http://www.w3.org/2000/svg";
type Handle = "depth" | "pitch" | "yaw";
/** UI-only overlay: primary rendering, camera input and scene mathematics stay independent. */
export class ClipPlaneGizmo {
  readonly element = document.createElementNS(NS, "svg");
  private scene!: Scene;
  private index = -1;
  private visible = false;
  private active: { id: number; x: number; y: number; kind: Handle; scene: Scene; index: number; width: number; height: number } | null = null;
  private viewCamera(scene: Scene, width: number, height: number) {
    return { ...scene.camera, fov_degrees: verticalFovDegrees(cameraFov(scene.camera,scene.render.fov_axis,width,height),scene.render.fov_axis,width,height) };
  }
  constructor(private canvas: HTMLCanvasElement, private edit: (change: (s: Scene) => Scene) => void, private hold: (held: boolean) => void) {
    this.element.id = "clip-gizmo";
    this.element.setAttribute("aria-label", "Clip plane in the view");
    Object.assign(this.element.style, { position: "fixed", pointerEvents: "none", overflow: "hidden", touchAction: "none" });
    this.element.addEventListener("pointerdown", e => {
      const target = e.target as Element, kind = target.getAttribute("data-handle") as Handle | null;
      if (!kind || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      this.active = { id: e.pointerId, x: e.clientX, y: e.clientY, kind, scene: this.scene, index: this.index, width: this.canvas.clientWidth, height: this.canvas.clientHeight };
      this.element.setPointerCapture(e.pointerId); this.hold(true);
    });
    this.element.addEventListener("pointermove", e => {
      const a = this.active; if (!a || a.id !== e.pointerId) return;
      const original = a.scene.cutout.planes[a.index]!;
      const pivot = planePivot(original, a.scene.camera.target), basis = cameraBasis(a.scene.camera);
      const dx = e.clientX - a.x, dy = e.clientY - a.y, fine = e.shiftKey ? 0.2 : 1;
      const plane = a.kind === "depth" ? { ...original, offset: original.offset - dy * worldUnitsPerPixel(pivot, this.viewCamera(a.scene,a.width,a.height), a.height) * fine }
        : rotateClipPlane(original, pivot, a.kind === "pitch" ? basis.right : basis.up, (a.kind === "pitch" ? dy : dx) * 0.01 * fine);
      this.edit(s => ({ ...s, cutout: { ...s.cutout, planes: s.cutout.planes.map((p, i) => i === a.index ? plane : p) } }));
    });
    const finish = (cancel = false) => {
      const a = this.active; if (!a) return;
      this.active = null;
      if (cancel) this.edit(s => ({ ...s, cutout: a.scene.cutout }));
      if (this.element.hasPointerCapture(a.id)) this.element.releasePointerCapture(a.id);
      this.hold(false); this.draw();
    };
    this.element.addEventListener("pointerup", () => finish());
    this.element.addEventListener("pointercancel", () => finish(true));
    this.element.addEventListener("lostpointercapture", () => finish());
    window.addEventListener("keydown", e => { if (e.key === "Escape" && this.active) { e.preventDefault(); finish(true); } });
    window.addEventListener("blur", () => finish(true));
    document.body.append(this.element);
    new ResizeObserver(() => this.draw()).observe(canvas);
    window.addEventListener("resize", () => this.draw());
  }
  update(scene: Scene, index: number, visible: boolean): void {
    this.scene = scene; this.index = index; this.visible = visible; this.draw();
  }
  private draw(): void {
    if (!this.scene) return;
    const r = this.canvas.getBoundingClientRect();
    Object.assign(this.element.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    this.element.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    const plane = this.scene.cutout.planes[this.index];
    this.element.style.display = this.visible && plane?.enabled ? "block" : "none";
    if (!plane || !this.visible) return;
    const camera = this.viewCamera(this.scene,r.width,r.height);
    const pivot = planePivot(plane, camera.target), center = projectPoint(pivot, camera, r.width, r.height);
    if (!center) { this.element.replaceChildren(); return; }
    const x = Math.max(110, Math.min(r.width - 110, center[0])), y = Math.max(100, Math.min(r.height - 90, center[1]));
    const scale = worldUnitsPerPixel(pivot, camera, r.height) * 100, n = unit(plane.normal);
    const tangent = unit(cross(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), bitangent = cross(n, tangent);
    const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b]) => projectPoint(add(pivot, add(mul(tangent, a! * scale), mul(bitangent, b! * scale))), camera, r.width, r.height));
    // Keep captured DOM nodes stable during a drag. Only visual attributes change.
    if (!this.element.firstChild) {
      this.element.innerHTML = `<polygon fill="#ffc45322" stroke="#ffc453" stroke-width="1.5"/><line stroke="#ffc453" stroke-width="3"/><text fill="#ffe2a1" font-size="13"/><circle data-handle="depth" r="12" fill="#ffc453"/><circle data-handle="yaw" r="11" fill="#67b7ff"/><circle data-handle="pitch" r="11" fill="#8ce3b4"/><text fill="white" font-size="12"/><text fill="white" font-size="12"/>`;
      for (const node of this.element.querySelectorAll("[data-handle]")) {
        const kind = node.getAttribute("data-handle")!;
        node.setAttribute("role", "slider"); node.setAttribute("tabindex", "0");
        node.setAttribute("aria-label", kind === "depth" ? "Move clip plane" : kind === "yaw" ? "Rotate clip plane horizontally" : "Rotate clip plane vertically");
        (node as SVGElement).style.pointerEvents = "auto"; (node as SVGElement).style.cursor = kind === "depth" ? "ns-resize" : "grab";
        node.addEventListener("keydown", event => {
          const e = event as KeyboardEvent; if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
          e.preventDefault(); const p = this.scene.cutout.planes[this.index]!;
          const sign = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1, step = sign * (e.shiftKey ? 0.2 : 1);
          const next = kind === "depth" ? { ...p, offset: p.offset + step * worldUnitsPerPixel(planePivot(p,this.scene.camera.target),this.viewCamera(this.scene,this.canvas.clientWidth,this.canvas.clientHeight),this.canvas.clientHeight)*5 }
            : rotateClipPlane(p, planePivot(p,this.scene.camera.target), kind === "yaw" ? cameraBasis(this.scene.camera).up : cameraBasis(this.scene.camera).right, step * Math.PI/180);
          this.edit(s => ({ ...s, cutout: { ...s.cutout, planes: s.cutout.planes.map((v,i)=>i===this.index?next:v) } }));
        });
      }
    }
    const children = this.element.children;
    children[0]!.setAttribute("points", corners.filter((p): p is [number,number] => !!p).map(p=>p.join(",")).join(" "));
    const tip = projectPoint(add(pivot,mul(n,scale*(plane.invert?1:-1))),camera,r.width,r.height) ?? center;
    for(const [name,value] of Object.entries({x1:center[0],y1:center[1],x2:tip[0],y2:tip[1]}))children[1]!.setAttribute(name,String(value));
    const positions = [[x-90,y-65],[x,y],[x+65,y],[x,y+60],[x+80,y+4],[x+15,y+65]];
    positions.forEach(([px,py],i)=> { const node=children[i+2]!;node.setAttribute(node.tagName==="circle"?"cx":"x",String(px));node.setAttribute(node.tagName==="circle"?"cy":"y",String(py)); });
    children[2]!.textContent = `Plane ${this.index+1} · drag yellow for depth`;
    children[6]!.textContent = "rotate ↔"; children[7]!.textContent = "rotate ↕";
    for (const node of this.element.querySelectorAll("[data-handle]")) node.setAttribute("aria-valuetext", `Offset ${plane.offset.toFixed(4)}; normal ${n.map(v=>v.toFixed(3)).join(", ")}`);
  }
}
