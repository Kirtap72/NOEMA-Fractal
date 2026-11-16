/**
 * ARTIST-WORKFLOW 07: the "Utgå från ett område" section of the AI chat. The artist marks a region of the picture (it goes along as a small picture,
 * only when Skicka is pressed), chooses what to lock and how many alternative drafts to ask for. The locks are enforced by the application (draftLocks.ts),
 * the region is an artistic wish. Nothing here talks to the AI or changes the artwork.
 */
import { LOCK_EXPLANATIONS, LOCK_KEYS, LOCK_LABELS, lockedKeys } from "../../engine/draftLocks";
import type { DraftLocks, LockKey } from "../../engine/draftLocks";
import { MAX_ALTERNATIVES, describeRegion } from "./regionBrief";
import type { Region } from "./regionBrief";

export interface RegionPick { region: Region; crop: { mime: string; base64: string } }
/** What the application offers: let the artist drag a rectangle on the picture and cut that part out as a small picture. */
export interface RegionPort {
  select(): Promise<RegionPick | { error: string } | null>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
};

export class RegionPanel {
  readonly root = el("details", undefined, "ai-region");
  private pick: RegionPick | null = null;
  private locks: DraftLocks = {};
  private alternatives = 2;
  private choose = el("button", "Mark area in the picture");
  private clear = el("button", "Clear area");
  private thumb = el("img", undefined, "ai-region-thumb");
  private info = el("small", undefined, "ai-region-info");
  private note = el("small", undefined, "ai-region-note");
  private lockBoxes = new Map<LockKey, HTMLInputElement>();
  private altSelect = el("select");
  private changed: () => void = () => {};

  constructor(private port: RegionPort | undefined, onChange?: () => void) {
    if (onChange) this.changed = onChange;
    this.root.dataset.aiRegion = "";
    const summary = el("summary", "Start from an area · lock parts · alternatives");
    this.root.append(summary);

    this.choose.type = "button";
    this.choose.dataset.aiRegionChoose = "";
    this.choose.title = "Drag a rectangle over an interesting area in your picture. The area is sent as a small picture together with your wish, only when you press Send.";
    this.choose.addEventListener("click", () => void this.selectRegion());
    this.clear.type = "button";
    this.clear.dataset.aiRegionClear = "";
    this.clear.hidden = true;
    this.clear.addEventListener("click", () => this.setPick(null));
    this.thumb.hidden = true;
    this.thumb.dataset.aiRegionThumb = "";
    this.thumb.alt = "The marked area";
    this.info.dataset.aiRegionInfo = "";
    this.note.textContent = "Keeping the local character of the area is an artistic wish to the AI, not a mathematical guarantee. The area is sent as a small picture (a cloud service) only when you press Send.";
    const regionRow = el("div", undefined, "ai-region-row");
    regionRow.append(this.choose, this.clear);

    const locksBox = el("fieldset", undefined, "ai-region-locks");
    locksBox.dataset.aiRegionLocks = "";
    locksBox.append(el("legend", "Lock (enforced by the app)"));
    for (const key of LOCK_KEYS) {
      const label = el("label", undefined, "ai-region-lock");
      const box = el("input");
      box.type = "checkbox";
      box.dataset.aiLock = key;
      box.title = `Locks ${LOCK_EXPLANATIONS[key]}. The drafts cannot change it: such a change is rejected.`;
      box.setAttribute("aria-label", `Lock ${LOCK_LABELS[key]}`);
      box.addEventListener("change", () => { this.locks = { ...this.locks, [key]: box.checked }; if (!box.checked) delete this.locks[key]; this.changed(); this.draw(); });
      label.append(box, " " + LOCK_LABELS[key]);
      this.lockBoxes.set(key, box);
      locksBox.append(label);
    }
    const lockNote = el("small", "A change that touches a locked part is rejected by the app, regardless of which AI tool tries it. Formula structure means which formulas are used and how they are combined: parameters and round counts are free.", "ai-region-note");

    const alt = el("label", "Number of alternatives ", "ai-region-alt");
    for (let n = 1; n <= MAX_ALTERNATIVES; n++) this.altSelect.add(new Option(String(n), String(n)));
    this.altSelect.value = String(this.alternatives);
    this.altSelect.dataset.aiAlternatives = "";
    this.altSelect.setAttribute("aria-label", "Number of alternative drafts to ask for");
    this.altSelect.addEventListener("change", () => { this.alternatives = Number(this.altSelect.value); this.changed(); });
    alt.append(this.altSelect);

    this.root.append(regionRow, this.thumb, this.info, this.note, locksBox, lockNote, alt);
    this.draw();
  }

  private async selectRegion(): Promise<void> {
    if (!this.port) { this.info.textContent = "Area selection does not exist in this version."; return; }
    this.choose.disabled = true;
    this.info.textContent = "Drag a rectangle over the area in the picture. Esc cancels.";
    try {
      const r = await this.port.select();
      if (!r) this.info.textContent = this.pick ? this.info.textContent : "No area was chosen (the rectangle was too small or the selection was cancelled).";
      else if ("error" in r) this.info.textContent = r.error;
      else this.setPick(r);
    } catch (e) { this.info.textContent = "The area selection failed: " + (e instanceof Error ? e.message : String(e)); }
    this.choose.disabled = false;
    this.draw();
  }

  private setPick(p: RegionPick | null): void { this.pick = p; this.changed(); this.draw(); }

  private draw(): void {
    const p = this.pick;
    this.thumb.hidden = !p;
    this.clear.hidden = !p;
    this.choose.textContent = p ? "Mark another area" : "Mark area in the picture";
    if (p) {
      this.thumb.src = `data:${p.crop.mime};base64,${p.crop.base64}`;
      this.info.textContent = `The area ${describeRegion(p.region)} goes with the next message as a small picture.`;
    } else if (!this.info.textContent?.startsWith("No area") && !this.info.textContent?.startsWith("Area selection")) this.info.textContent = "";
    const keys = lockedKeys(this.locks);
    this.root.dataset.locked = keys.join(",");
    for (const [k, box] of this.lockBoxes) box.checked = this.locks[k] === true;
  }

  // ---- what the chat needs ------------------------------------------------------------------------------------------------------------
  region(): Region | undefined { return this.pick?.region; }
  crop(): { mime: string; base64: string } | undefined { return this.pick?.crop; }
  currentLocks(): DraftLocks { return { ...this.locks }; }
  alternativeCount(): number { return this.alternatives; }
  /** Starts again (a new conversation): the region goes, the locks the artist chose stay. */
  resetRegion(): void { this.pick = null; this.draw(); }
}
