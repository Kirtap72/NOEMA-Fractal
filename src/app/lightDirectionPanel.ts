import { SHADOW_REACHES, describeLightDirection, readLightDirection, DOMINANCE_RANGE } from "../engine/lightDirection";
import type { LightDirection, ShadowReach } from "../engine/lightDirection";
import type { Scene } from "../engine/scene";

export interface LightDirectionHandlers {
  /** The artist changed one control. The owner writes it into the scene as one undoable edit. */
  onChange(change: Partial<LightDirection>): void;
}

const REACH_LABEL: Record<ShadowReach, string> = { off: "Off", contact: "Contact", full: "Full" };
const REACH_HELP: Record<ShadowReach, string> = {
  off: "The main light casts no shadows. Most even light, fastest to draw.",
  contact: "Short shadows in corners and recesses, but large shapes do not shadow each other. Most ready-made looks do this.",
  full: "The main light casts shadows over the whole subject: large shapes shadow each other and give clear light and dark areas. Takes longer to draw.",
};

/**
 * "Light and shadow": the everyday controls for light and shadow, working with any lighting (see engine/lightDirection.ts). Plain DOM; it only reads
 * the scene and reports a change, the owner writes it as one Undo step. Advanced controls stay where they were (the light list, Skulpturlägen).
 */
export class LightDirectionPanel {
  readonly root = document.createElement("details");
  private readonly buttons = new Map<ShadowReach, HTMLButtonElement>();
  private readonly dominance = document.createElement("input");
  private readonly depth = document.createElement("input");
  private readonly ambient = document.createElement("input");
  private readonly softness = document.createElement("input");
  private readonly status = document.createElement("p");
  private readonly reachHelp = document.createElement("p");
  private shown = "";

  constructor(private readonly handlers: LightDirectionHandlers) {
    this.root.id = "light-direction"; this.root.open = true;
    const summary = document.createElement("summary"); summary.textContent = "Light and shadow"; this.root.append(summary);
    const note = document.createElement("p"); note.className = "ainfo";
    note.textContent = "Works with all lighting setups. Shadows are cast by the main light (the strongest light); fill and rim lights are not affected. Every change is one Undo step.";

    const reachRow = document.createElement("div"); reachRow.className = "arow"; reachRow.setAttribute("role", "group"); reachRow.setAttribute("aria-label", "Reach of the shadows"); reachRow.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap";
    const reachLabel = document.createElement("span"); reachLabel.textContent = "Shadows:"; reachRow.append(reachLabel);
    for (const reach of SHADOW_REACHES) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = REACH_LABEL[reach]; b.dataset.shadowReach = reach; b.title = REACH_HELP[reach];
      b.setAttribute("aria-pressed", "false"); b.onclick = () => handlers.onChange({ reach });
      this.buttons.set(reach, b); reachRow.append(b);
    }
    this.reachHelp.className = "ainfo"; this.reachHelp.id = "light-direction-reach-help";
    this.status.className = "ainfo"; this.status.id = "light-direction-status"; this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");

    const grid = document.createElement("div"); grid.className = "ainfo"; grid.style.cssText = "display:grid;gap:6px;margin-top:6px";
    const slider = (input: HTMLInputElement, id: string, label: string, min: number, max: number, step: number, title: string, key: keyof LightDirection) => {
      input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step); input.title = title; input.id = id; input.setAttribute("aria-label", label);
      const out = document.createElement("output"); out.style.cssText = "min-width:3.2em;text-align:right"; out.htmlFor = id;
      const show = () => { out.textContent = key === "dominance" ? `${Math.round(Number(input.value) * 100)} %` : Number(input.value).toFixed(2); };
      input.addEventListener("input", show); input.addEventListener("change", () => handlers.onChange({ [key]: Number(input.value) }));
      const wrap = document.createElement("label"); wrap.style.cssText = "display:grid;grid-template-columns:11em 1fr 3.4em;gap:8px;align-items:center";
      wrap.append(document.createTextNode(label), input, out); grid.append(wrap); (input as HTMLInputElement & { __show?: () => void }).__show = show;
    };
    slider(this.dominance, "light-dominance", "Main light against fill", DOMINANCE_RANGE[0], DOMINANCE_RANGE[1], 0.01, "How much of all light comes from the main light. Low = even, flat light. High = dark shadows and strong contrasts. The fill lights and the ambient light are scaled together.", "dominance");
    slider(this.depth, "light-depth", "Shadow depth", 0, 1, 0.01, "How dark cavities and large shadow areas become: broad occlusion and occlusion of indirect light. 0 = off. Switches sculpting on if it is off.", "depth");
    slider(this.ambient, "light-ambient", "Ambient light", 0, 0.6, 0.005, "The weak light that reaches even the shadows. Low = really dark shadows. Also changes the balance against the main light.", "ambient");
    slider(this.softness, "light-softness", "Shadow softness", 0, 1, 0.01, "How soft the edge of a full shadow is. 0 = sharp. Only applies when Shadows is Full.", "softness");
    this.root.append(note, reachRow, this.reachHelp, grid, this.status);
  }

  /** Brings the controls in line with the scene (not while the artist is dragging one of them). */
  update(scene: Scene): void {
    const d = readLightDirection(scene);
    const fingerprint = JSON.stringify([d, scene.lights.length, scene.lights.map((l) => l.enabled)]);
    if (fingerprint === this.shown) return;
    this.shown = fingerprint;
    for (const [reach, b] of this.buttons) b.setAttribute("aria-pressed", String(d.reach === reach));
    this.reachHelp.textContent = REACH_HELP[d.reach];
    this.softness.disabled = d.reach !== "full";
    const set = (input: HTMLInputElement, value: number) => { if (document.activeElement !== input) { input.value = String(value); (input as HTMLInputElement & { __show?: () => void }).__show?.(); } };
    set(this.dominance, d.dominance); set(this.depth, d.depth); set(this.ambient, d.ambient); set(this.softness, d.softness);
    this.status.textContent = describeLightDirection(scene);
  }

  setStatus(text: string): void { this.status.textContent = text; }
}
