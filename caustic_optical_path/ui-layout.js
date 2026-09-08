const key = "caustic-optical-path-ui-v2",
  test = new URLSearchParams(location.search).has("test");
let saved = {};
try {
  if (!test) saved = JSON.parse(localStorage.getItem(key) || "{}");
} catch {}
const preferences = { left: false, right: false, sections: {}, ...saved };
export const compactQuery =
  "(max-width: 760px), (max-height: 500px) and (max-width: 1000px)";
export const isCompact = () => window.matchMedia(compactQuery).matches;
let mobileSection = null;
const layoutChanged = () =>
  requestAnimationFrame(() =>
    window.dispatchEvent(new Event("optical-layout-change")),
  );

export function closeMobilePanels() {
  mobileSection = null;
  document
    .querySelectorAll(".mobile-open")
    .forEach((e) => e.classList.remove("mobile-open"));
  document
    .querySelectorAll("button[data-mobile-section]")
    .forEach((b) => b.setAttribute("aria-expanded", "false"));
  delete document.querySelector(".workspace").dataset.mobileSection;
  layoutChanged();
}
function openMobileSection(section) {
  const again = mobileSection === section;
  closeMobilePanels();
  window.dispatchEvent(new Event("optical-clear-selection"));
  if (again) return;
  mobileSection = section;
  document.querySelector(".workspace").dataset.mobileSection = section;
  const p = document.getElementById(
    section === "view" ? "mobileViewPanel" : "leftPanel",
  );
  p.classList.add("mobile-open");
  p.scrollTop = 0;
  const detail = document.getElementById(`${section}Section`);
  if (detail) detail.open = true;
  document
    .querySelectorAll("button[data-mobile-section]")
    .forEach((b) =>
      b.setAttribute(
        "aria-expanded",
        String(b.dataset.mobileSection === section),
      ),
    );
  layoutChanged();
}

export function sceneInsets(host) {
  if (!isCompact()) return { top: 0, bottom: 0, right: 0 };
  const rect = host.getBoundingClientRect();
  const top =
    document.querySelector(".stage-top").getBoundingClientRect().bottom -
    rect.top +
    8;
  const panel = document.querySelector(".mobile-open");
  if (panel && panel.getBoundingClientRect().width < rect.width * 0.7)
    return { top, bottom: 80, right: panel.getBoundingClientRect().width + 16 };
  const bottom =
    rect.bottom -
    (panel || document.querySelector(".stage-bottom")).getBoundingClientRect()
      .top +
    10;
  return { top, bottom: Math.min(bottom, rect.height - top - 90), right: 0 };
}
// Apply the new starting layout once, without touching any optical draft or
// later choices to expand a module.
if (preferences.moduleDefaults !== 3) {
  Object.assign(preferences.sections, {
    presets: false,
    outline: false,
    target: true,
    model: false,
  });
  preferences.moduleDefaults = 3;
}
const save = () => {
  try {
    if (!test) localStorage.setItem(key, JSON.stringify(preferences));
  } catch {}
};
export const icon = (path) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
export function moduleBlock(id, title, body, { open = true, meta = "" } = {}) {
  return `<details class="field-group module" data-section="${id}" ${(preferences.sections[id] ?? open) ? "open" : ""}><summary class="module-summary"><span>${title}</span><small>${meta}</small></summary><div class="module-content">${body}</div></details>`;
}
function panel(side) {
  const closed = preferences[side],
    p = document.getElementById(`${side}Panel`),
    b = p.querySelector("[data-panel]"),
    name = side === "left" ? "光路设置" : "物体参数";
  p.classList.toggle("collapsed", closed);
  document
    .querySelector(".workspace")
    .classList.toggle(`${side}-closed`, closed);
  b.setAttribute("aria-expanded", String(!closed));
  b.setAttribute("aria-label", `${closed ? "展开" : "收起"}${name}`);
  b.title = b.getAttribute("aria-label");
}
export function revealInspector() {
  if (isCompact()) {
    closeMobilePanels();
    document.getElementById("rightPanel").classList.add("mobile-open");
    document.querySelector(".workspace").dataset.mobileSection = "inspector";
  }
  preferences.right = false;
  panel("right");
  document.getElementById("rightPanel").hidden = false;
}
export function initializeLayout() {
  for (const side of ["left", "right"]) panel(side);
  document.querySelectorAll("details[data-section]").forEach((d) => {
    if (d.dataset.section in preferences.sections)
      d.open = preferences.sections[d.dataset.section];
  });
  save();
  document.addEventListener(
    "toggle",
    (e) => {
      if (e.target.matches("details[data-section]") && !isCompact()) {
        preferences.sections[e.target.dataset.section] = e.target.open;
        save();
      }
    },
    true,
  );
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-panel]");
    if (b) {
      if (isCompact()) {
        closeMobilePanels();
        return;
      }
      const side = b.dataset.panel;
      preferences[side] = !preferences[side];
      panel(side);
      save();
    }
    const mobile = e.target.closest("button[data-mobile-section]");
    if (mobile && isCompact()) openMobileSection(mobile.dataset.mobileSection);
    if (e.target.closest("[data-mobile-close]")) closeMobilePanels();
  });
  const placements = [
    [
      document.querySelector(".history-tools"),
      document.getElementById("mobileHistory"),
    ],
    [
      document.querySelector(".statusbar"),
      document.getElementById("mobileViewContent"),
    ],
    [
      document.getElementById("metrics"),
      document.getElementById("mobileViewContent"),
    ],
  ].map(([element, destination]) => {
    const anchor = document.createComment("desktop position");
    element.before(anchor);
    return { element, destination, anchor };
  });
  const media = window.matchMedia(compactQuery);
  const responsive = () => {
    closeMobilePanels();
    document.body.classList.toggle("compact-ui", media.matches);
    for (const { element, destination, anchor } of placements)
      if (media.matches) destination.append(element);
      else anchor.after(element);
    if (!media.matches)
      document.querySelectorAll("details[data-section]").forEach((d) => {
        if (d.dataset.section in preferences.sections)
          d.open = preferences.sections[d.dataset.section];
      });
    layoutChanged();
  };
  media.addEventListener("change", responsive);
  responsive();
  const viewport = () => {
    document.documentElement.style.setProperty(
      "--app-height",
      `${window.visualViewport?.height || window.innerHeight}px`,
    );
    layoutChanged();
  };
  window.visualViewport?.addEventListener("resize", viewport);
  window.addEventListener("resize", viewport);
  viewport();
  // Scene hit testing closes a drawer only after an empty-space tap finishes.
  // Closing on pointerdown changed the camera offset before pointerup, so the
  // same gesture could hit a newly shifted object and reopen the inspector.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobilePanels();
  });
  const observer = new ResizeObserver(layoutChanged);
  for (const p of document.querySelectorAll(
    ".panel, .mobile-view-panel, .stage-top",
  ))
    observer.observe(p);
  // A short downward swipe on a sheet heading dismisses it without a backdrop.
  for (const header of document.querySelectorAll(".panel-heading")) {
    let start = null;
    header.addEventListener("pointerdown", (e) => {
      if (!isCompact() || e.target.closest("button")) return;
      start = e.clientY;
      header.setPointerCapture(e.pointerId);
    });
    header.addEventListener("pointerup", (e) => {
      if (start !== null && e.clientY - start > 45) closeMobilePanels();
      start = null;
    });
    header.addEventListener("pointercancel", () => {
      start = null;
    });
  }
}
