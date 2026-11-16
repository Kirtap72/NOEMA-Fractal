import { frameRect, defaultComposition } from "../engine/composition";
import { outputSize } from "../engine/renderSetup";
import { cameraFov } from "../engine/cameraOptics";
import type { Scene } from "../engine/scene";

export class PanelVisibility {
  hidden = false;
  constructor(
    private panel: HTMLElement,
    private toggle: HTMLButtonElement,
    private change: () => void,
    private storage?: Pick<Storage, "getItem" | "setItem"> | null,
  ) {
    try {
      if (this.storage === undefined) this.storage = localStorage;
      this.hidden = this.storage?.getItem("fractal-panel-hidden") === "true";
    } catch {
      /* Optional local preference. */
    }
    toggle.onclick = () => this.setHidden(!this.hidden);
    window.addEventListener("keydown", (e) => {
      if (
        e.key.toLowerCase() === "h" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(
          e.target instanceof Element &&
          e.target.closest("input,textarea,select,[contenteditable=true]")
        )
      ) {
        e.preventDefault();
        this.setHidden(!this.hidden);
      }
    });
    this.apply();
  }
  private apply(): void {
    this.panel.hidden = this.hidden;
    document.body.classList.toggle("panel-hidden", this.hidden);
    this.toggle.textContent = this.hidden ? "☰ Show panel" : "◀ Hide panel";
    this.toggle.setAttribute("aria-expanded", String(!this.hidden));
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.apply();
    try {
      this.storage?.setItem("fractal-panel-hidden", String(hidden));
    } catch {
      /* Preference is optional. */
    }
    this.change();
  }
}

/** SVG/CSS overlay, never drawn into the renderer or its exported images. */
export class CompositionViewport {
  private svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private label = document.createElement("div");
  private key = "";
  constructor(
    private canvas: HTMLCanvasElement,
    private panel: HTMLElement,
    private visibility: () => boolean,
    private preview: HTMLElement,
    private topInset:()=>number=()=>0,
  ) {
    this.svg.id = "composition-overlay";
    this.svg.setAttribute("aria-hidden", "true");
    this.label.id = "camera-frame-label";
    document.body.append(this.svg, this.label);
  }
  available(): { left: number; width: number; height: number } {
    const left = this.visibility()
      ? 0
      : Math.min(
          this.panel.getBoundingClientRect().right + 12,
          window.innerWidth - 120,
        );
    return {
      left,
      width: Math.max(1, window.innerWidth - left),
      height: Math.max(1, window.innerHeight),
    };
  }
  aspect(): number {
    const a = this.available();
    return a.width / a.height;
  }
  update(scene: Scene): void {
    const a = this.available(),
      size = outputSize(scene.render, a.width / a.height),
      ratio = size.width / size.height;
    // Reserve UI space only: the film aspect/projection above remains unchanged.
    const top=Math.min(Math.max(0,this.topInset()),Math.max(0,a.height-1));
    const fitted=frameRect(a.width,a.height-top,ratio),f={...fitted,y:fitted.y+top};
    const r = {
      left: a.left + f.x,
      top: f.y,
      width: f.width,
      height: f.height,
    };
    const key = JSON.stringify([
      r,
      scene.composition,
      scene.camera,
      scene.render.format,
      size,
    ]);
    if (key === this.key) return;
    this.key = key;
    for (const element of [this.canvas, this.preview])
      Object.assign(element.style, {
        left: r.left + "px",
        top: r.top + "px",
        width: r.width + "px",
        height: r.height + "px",
      });
    this.canvas.classList.add("framed");
    Object.assign(this.svg.style, {
      left: a.left + "px",
      width: a.width + "px",
      height: a.height + "px",
    });
    this.svg.setAttribute("viewBox", `0 0 ${a.width} ${a.height}`);
    const c = scene.composition ?? defaultComposition(),
      lines: string[] = [];
    const line = (x1: number, y1: number, x2: number, y2: number) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    if (c.thirds)
      for (const t of [1 / 3, 2 / 3])
        lines.push(
          line(f.x + f.width * t, f.y, f.x + f.width * t, f.y + f.height),
          line(f.x, f.y + f.height * t, f.x + f.width, f.y + f.height * t),
        );
    if (c.center)
      lines.push(
        line(
          f.x + f.width / 2 - 10,
          f.y + f.height / 2,
          f.x + f.width / 2 + 10,
          f.y + f.height / 2,
        ),
        line(
          f.x + f.width / 2,
          f.y + f.height / 2 - 10,
          f.x + f.width / 2,
          f.y + f.height / 2 + 10,
        ),
      );
    if (c.diagonals)
      lines.push(
        line(f.x, f.y, f.x + f.width, f.y + f.height),
        line(f.x + f.width, f.y, f.x, f.y + f.height),
      );
    if (c.safe)
      lines.push(
        `<rect x="${f.x + f.width * 0.05}" y="${f.y + f.height * 0.05}" width="${f.width * 0.9}" height="${f.height * 0.9}" stroke-dasharray="5 5"/>`,
      );
    this.svg.innerHTML = `<path fill="#0006" fill-rule="evenodd" d="M0 0H${a.width}V${a.height}H0Z M${f.x} ${f.y}h${f.width}v${f.height}h${-f.width}Z"/><rect x="${f.x + 0.5}" y="${f.y + 0.5}" width="${Math.max(0, f.width - 1)}" height="${Math.max(0, f.height - 1)}" fill="none" stroke="#ddd9"/><g stroke="#fff7" stroke-width="1" fill="none">${lines.join("")}</g>`;
    const fov = cameraFov(
      scene.camera,
      scene.render.fov_axis,
      size.width,
      size.height,
    );
    this.label.textContent = `${scene.render.resolution ? 'Custom format' : scene.render.format.preset === 'free' ? 'Free format' : scene.render.format.preset} · ${size.width}×${size.height} · ${scene.camera.projection === "orthographic" ? "Ortho" : scene.camera.lens ? scene.camera.lens.focal_length_mm + " mm" : fov.toFixed(1) + "° FOV"}${c.locked ? " · 🔒" : ""}`;
    this.label.style.left = a.left + 12 + "px";
  }
}
