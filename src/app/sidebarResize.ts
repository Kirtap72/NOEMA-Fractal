import { FormulaPreferences, SIDEBAR_WIDTH } from "./formulaPreferences";
/** A fixed handle stays visible while the sidebar scrolls; arrow keys are a drag alternative. */
export function attachSidebarResize(
  sidebar: HTMLElement,
  preferences: FormulaPreferences,
) {
  const handle = document.createElement("div");
  handle.id = "sidebar-resize";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Change the width of the side panel");
  handle.setAttribute("aria-valuemin", String(SIDEBAR_WIDTH.min));
  handle.setAttribute("aria-valuemax", String(SIDEBAR_WIDTH.max));
  handle.title = "Drag to change the width · arrow keys move 20 px";
  document.body.append(handle);
  let active = false,
    current = preferences.sidebarWidth;
  const apply = (width: number) => {
    current = Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width));
    sidebar.style.setProperty("--sidebar-width", `${current}px`);
    handle.style.left = `${sidebar.getBoundingClientRect().right}px`;
    handle.setAttribute("aria-valuenow", String(current));
  };
  apply(current);
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    active = true;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (active) apply(e.clientX - sidebar.getBoundingClientRect().left);
  });
  const finish = () => {
    if (active) {
      active = false;
      preferences.setSidebarWidth(current);
    }
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  handle.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    apply(
      e.key === "Home"
        ? SIDEBAR_WIDTH.min
        : e.key === "End"
          ? SIDEBAR_WIDTH.max
          : current + (e.key === "ArrowRight" ? 20 : -20),
    );
    preferences.setSidebarWidth(current);
  });
  const resize = () => apply(current);
  window.addEventListener("resize", resize);
  const observer=new ResizeObserver(resize);observer.observe(sidebar);
  return () => {
    observer.disconnect();
    handle.remove();
    window.removeEventListener("resize", resize);
  };
}
