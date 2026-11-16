import type { AimRect } from "./lightAim";
import { cleanRegion } from "./aiBridge/regionBrief";
import type { Region } from "./aiBridge/regionBrief";

/**
 * ARTIST-WORKFLOW 07: drag a rectangle on the picture. An overlay covers exactly the displayed picture (the rectangle the surface-pick code uses), takes
 * the pointer while it is open (so the camera does not move) and gives back the rectangle as shares of the picture. Esc or a click without a drag cancels.
 * Nothing is rendered or changed here.
 */
export class RegionSelector {
  private overlay: HTMLDivElement | null = null;
  private resolve: ((r: Region | null) => void) | null = null;

  get open(): boolean { return this.overlay !== null; }

  /** Opens the overlay over `rect` (client coordinates of the displayed picture). Resolves with the chosen region, or null when cancelled or too small. */
  select(rect: AimRect, hint = "Drag a rectangle over the area you want to start from. Esc cancels."): Promise<Region | null> {
    this.cancel();
    return new Promise((resolve) => {
      this.resolve = resolve;
      const overlay = document.createElement("div");
      overlay.dataset.regionOverlay = "";
      overlay.setAttribute("role", "application");
      overlay.setAttribute("aria-label", "Mark an area in the picture");
      Object.assign(overlay.style, { position: "fixed", left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px", zIndex: "40", cursor: "crosshair", touchAction: "none", background: "rgba(0,0,0,0.12)", outline: "2px dashed #ffd25e" });
      const box = document.createElement("div");
      box.dataset.regionBox = "";
      Object.assign(box.style, { position: "absolute", border: "2px solid #ffd25e", background: "rgba(255,210,94,0.18)", display: "none", pointerEvents: "none" });
      const label = document.createElement("div");
      label.textContent = hint;
      Object.assign(label.style, { position: "absolute", left: "8px", top: "8px", padding: "3px 8px", font: "12px sans-serif", color: "#fff", background: "rgba(0,0,0,0.65)", borderRadius: "4px", pointerEvents: "none" });
      overlay.append(box, label);
      document.body.append(overlay);
      this.overlay = overlay;
      let start: { x: number; y: number } | null = null;
      const local = (e: PointerEvent): { x: number; y: number } => ({ x: Math.min(rect.width, Math.max(0, e.clientX - rect.left)), y: Math.min(rect.height, Math.max(0, e.clientY - rect.top)) });
      const draw = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
        Object.assign(box.style, { display: "block", left: Math.min(a.x, b.x) + "px", top: Math.min(a.y, b.y) + "px", width: Math.abs(a.x - b.x) + "px", height: Math.abs(a.y - b.y) + "px" });
      };
      overlay.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); start = local(e); overlay.setPointerCapture(e.pointerId); draw(start, start); });
      overlay.addEventListener("pointermove", (e) => { if (start) draw(start, local(e)); });
      overlay.addEventListener("pointerup", (e) => {
        if (!start) return;
        const end = local(e), a = start;
        start = null;
        const region = cleanRegion({ u0: a.x / rect.width, v0: a.y / rect.height, u1: end.x / rect.width, v1: end.y / rect.height });
        this.close(region);
      });
      overlay.addEventListener("pointercancel", () => { start = null; this.close(null); });
      document.addEventListener("keydown", this.onKey, true);
    });
  }

  private onKey = (e: KeyboardEvent): void => { if (e.key === "Escape" && this.overlay) { e.preventDefault(); e.stopPropagation(); this.close(null); } };

  /** Closes an open selection without a result. */
  cancel(): void { if (this.overlay) this.close(null); }

  private close(region: Region | null): void {
    document.removeEventListener("keydown", this.onKey, true);
    this.overlay?.remove();
    this.overlay = null;
    const r = this.resolve;
    this.resolve = null;
    r?.(region);
  }
}
