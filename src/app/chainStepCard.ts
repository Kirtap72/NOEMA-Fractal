import type { Formula } from "../engine";
import { formulaCatalog } from "../engine";
import { CATEGORY_LABELS } from "./formulaSearch";
import { FormulaPreferences } from "./formulaPreferences";
export interface StepCardActions {
  replace(opener: HTMLButtonElement): void;
  remove(): void;
  move(to: number): void;
  toggle(open: boolean): void;
  /** "Show the effect of the step": compare the artwork with and without a change to this step. Optional. */
  explain?(): void;
}
/** The card only dispatches edits; the existing scene functions own order and parameters. */
export function createStepCard(
  formula: Formula | undefined,
  id: string,
  index: number,
  count: number,
  open: boolean,
  preferences: FormulaPreferences,
  dragState: { index: number | null },
  actions: StepCardActions,
) {
  const card = document.createElement("div");
  card.className = "step";
  card.dataset.stepIndex = String(index);
  card.setAttribute("role", "listitem");
  const head = document.createElement("div");
  head.className = "stephead";
  const button = (
    text: string,
    label: string,
    onClick: () => void,
    disabled = false,
  ) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.disabled = disabled;
    b.addEventListener("click", onClick);
    return b;
  };
  const name = formula?.name ?? id;
  const pick = button(name, `Change the formula in step ${index + 1}: ${name}`, () =>
    actions.replace(pick),
  );
  pick.className = "step-name";
  pick.title = name;
  const num = document.createElement("span");
  num.className = "num";
  num.textContent = String(index + 1);
  const drag = button(
    "≡",
    `Move step ${index + 1} · drag or use the arrow keys`,
    () => {},
  );
  drag.className = "drag-handle";
  const reset = () => {
    dragState.index = null;
    card.parentElement
      ?.querySelectorAll(".drop-target,.dragging")
      .forEach((el) => el.classList.remove("drop-target", "dragging"));
  };
  // Pointer events work in embedded browsers and on touch screens, without HTML drag support.
  drag.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    const abort = new AbortController();
    let moved = false;
    let target: HTMLElement | null = null;
    const options = { signal: abort.signal };
    const finish = (event?: PointerEvent) => {
      if (event && event.pointerId !== e.pointerId) return;
      const to = target ? Number(target.dataset.stepIndex) : index;
      abort.abort();
      reset();
      if (drag.hasPointerCapture(e.pointerId))
        drag.releasePointerCapture(e.pointerId);
      if (event?.type === "pointerup" && moved && to !== index)
        actions.move(to);
    };
    window.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerId !== e.pointerId) return;
        if (
          !moved &&
          Math.hypot(event.clientX - e.clientX, event.clientY - e.clientY) < 5
        )
          return;
        moved = true;
        dragState.index = index;
        card.classList.add("dragging");
        target?.classList.remove("drop-target");
        const hit = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[data-step-index]");
        target = hit?.parentElement === card.parentElement ? hit : null;
        if (target !== card) target?.classList.add("drop-target");
        const scroller = card.closest<HTMLElement>("#controls");
        if (scroller) {
          const rect = scroller.getBoundingClientRect();
          if (event.clientY < rect.top + 30) scroller.scrollTop -= 20;
          else if (event.clientY > rect.bottom - 30) scroller.scrollTop += 20;
        }
      },
      options,
    );
    window.addEventListener("pointerup", finish, options);
    window.addEventListener("pointercancel", finish, options);
    window.addEventListener("blur", () => finish(), options);
    drag.addEventListener("lostpointercapture", () => finish(), options);
    // Window listeners also cover environments without active pointer capture.
    try {
      drag.setPointerCapture(e.pointerId);
    } catch {
      /* Window events remain available. */
    }
  });
  drag.addEventListener("keydown", (e) => {
    const to =
      index + (e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0);
    if (to !== index && to >= 0 && to < count) {
      e.preventDefault();
      actions.move(to);
    }
  });
  const star = button(
    preferences.isFavorite(id) ? "★" : "☆",
    `Favourite: ${name}`,
    () => preferences.toggleFavorite(id),
  );
  star.className = "favorite-toggle";
  star.dataset.favorite = id;
  star.setAttribute("aria-pressed", String(preferences.isFavorite(id)));
  const remove = button(
    "×",
    `Remove step ${index + 1}`,
    actions.remove,
    count <= 1,
  );
  remove.className = "remove-step";
  if (count <= 1) remove.title = "At least one formula must be in the chain";
  head.append(drag, num, pick, star, remove);
  card.append(head);
  const badge = document.createElement("div");
  badge.className = "step-badge";
  const metadata = formula ? formulaCatalog(formula) : null;
  badge.textContent = metadata
    ? `${CATEGORY_LABELS[metadata.category]} · ${metadata.dimension}D`
    : "The formula is not in the library";
  card.append(badge);
  const toolbar = document.createElement("div");
  toolbar.className = "step-actions";
  toolbar.append(
    button(
      "↑",
      `Move step ${index + 1} up`,
      () => actions.move(index - 1),
      index === 0,
    ),
    button(
      "↓",
      `Move step ${index + 1} down`,
      () => actions.move(index + 1),
      index === count - 1,
    ),
  );
  if (actions.explain) {
    const explain = button("Show the effect of the step", `See what step ${index + 1} contributes: compare the artwork with and without a change of the step. The artwork does not change.`, () => actions.explain?.());
    explain.className = "step-effect-open";
    explain.dataset.stepEffectOpen = String(index);
    toolbar.append(explain);
  }
  const controls = document.createElement("details");
  controls.className = "step-parameters";
  controls.open = open;
  const summary = document.createElement("summary");
  summary.textContent = "Parameters";
  controls.append(summary);
  controls.addEventListener("toggle", () => {
    if (controls.isConnected) actions.toggle(controls.open);
  });
  card.append(toolbar, controls);
  return { card, controls };
}
