// main.js: theme, hash router, data and footer. Each view lives in its own module (view-*.js).
//
// Routes: #/overview, #/curve, #/roll, #/lab, #/td3c, #/method, each with optional parameters
// (open=method,data for disclosures, panel=... for the secondary chart, and a few view-specific keys).

import { configure } from "./engine.js";
import { load, loadMany } from "./data.js";
import { h, clear, errorNote } from "./dom.js";
import { dateLong, listJoin } from "./format.js";
import overview from "./view-overview.js";
import curve from "./view-curve.js";
import roll from "./view-roll.js";
import lab from "./view-lab.js";
import td3c from "./view-td3c.js";
import method from "./view-method.js";

const SITE = "FFA basis and hedging study";
const VIEWS = [overview, curve, roll, lab, td3c, method];
const byId = new Map(VIEWS.map((v) => [v.id, v]));
const mounted = new Map();
let currentId = null;
let currentParams = {};

// ------------------------------------------------------------------- theme

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const label = document.querySelector("[data-theme-toggle] .theme-label");
  // the button names the theme it switches to
  if (label) label.textContent = theme === "dark" ? "Light theme" : "Dark theme";
}

function setupTheme() {
  const btn = document.querySelector("[data-theme-toggle]");
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  btn?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      window.localStorage.setItem("nc-theme", next);
    } catch {
      // storage can be blocked; the theme still applies for this visit
    }
  });
}

// ------------------------------------------------------------------ router

function parseHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw.startsWith("/")) return null;
  const [path, query = ""] = raw.slice(1).split("?");
  const id = path.split("/")[0];
  const params = {};
  for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  return { id, params };
}

function hashOf(id, params) {
  const pairs = Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined);
  const q = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/g, ",")}`).join("&");
  return `#/${id}${q ? `?${q}` : ""}`;
}

/** Views call this to keep their state (open sections, panel, options) in the hash. */
function setParams(id, patch) {
  if (id !== currentId) return;
  currentParams = { ...currentParams, ...patch };
  for (const [k, v] of Object.entries(currentParams)) if (v === "" || v === null || v === undefined) delete currentParams[k];
  window.history.replaceState(null, "", hashOf(id, currentParams));
}

async function show(id, params, { focus }) {
  const view = byId.get(id);
  currentId = id;
  currentParams = { ...params };
  document.title = `${view.name}: ${SITE}`;
  for (const a of document.querySelectorAll(".nav a[data-view]")) {
    if (a.dataset.view === id) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  for (const sec of document.querySelectorAll("section.view")) sec.hidden = sec.dataset.view !== id;
  const section = document.getElementById(`view-${id}`);
  let instance = mounted.get(id);
  if (!instance) {
    instance = mountView(view, section);
    mounted.set(id, instance);
  }
  const ready = await instance;
  if (currentId !== id) return;
  ready?.update?.(currentParams);
  if (focus) {
    const h1 = section.querySelector("h1");
    (h1 || section).focus({ preventScroll: false });
    window.scrollTo(0, 0);
  }
}

async function mountView(view, section) {
  clear(section);
  section.append(h("p", { class: "view-loading" }, "Loading the data for this view."));
  try {
    const data = await loadMany(view.needs);
    clear(section);
    return view.render(section, {
      data,
      params: currentParams,
      setParams: (patch) => setParams(view.id, patch),
    });
  } catch (err) {
    clear(section);
    section.append(errorNote(`This view could not load its data (${err.message}). The files are in the repository's data folder.`));
    console.error(err);
    return null;
  }
}

function route({ focus }) {
  const parsed = parseHash();
  if (!parsed || !byId.has(parsed.id)) {
    window.history.replaceState(null, "", "#/overview");
    show("overview", {}, { focus: false });
    return;
  }
  if (parsed.id === currentId && mounted.has(parsed.id)) {
    currentParams = { ...parsed.params };
    mounted.get(parsed.id).then((ready) => ready?.update?.(currentParams));
    return;
  }
  show(parsed.id, parsed.params, { focus });
}

// ------------------------------------------------------------------ footer

async function footer() {
  const el = document.querySelector("[data-footer]");
  if (!el) return;
  try {
    const manifest = await load("manifest");
    const names = (manifest.sources || []).map((src) => src.source);
    const asOf = manifest.as_of || {};
    const dates = [];
    if (asOf.ffa_curve) dates.push(`FFA curves to ${dateLong(asOf.ffa_curve)}`);
    if (asOf.daily_5tc) dates.push(`daily 5TC to ${dateLong(asOf.daily_5tc)}`);
    if (asOf.td3c_weekly) dates.push(`TD3C to the week of ${dateLong(asOf.td3c_weekly)}`);
    if (asOf.sec_marks) dates.push(`SEC marks to ${dateLong(asOf.sec_marks)}`);
    el.append(h("p", {}, `Data sources: ${names.join("; ")}.`));
    el.append(h("p", {}, `Last update ${dateLong(manifest.built_on)}: ${listJoin(dates)}.`));
    el.append(h("p", {}, "A hedging study, not a trading strategy: no signal, no position sizing, no profit and loss presented as a strategy."));
  } catch {
    el.append(h("p", {}, "The provenance manifest (data/manifest.json) could not be loaded."));
  }
}

// -------------------------------------------------------------------- boot

async function boot() {
  setupTheme();
  document.querySelector("[data-skip]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    const section = document.querySelector("section.view:not([hidden])");
    const target = section?.querySelector("h1") || document.getElementById("main");
    target.focus();
  });
  try {
    const engine = await load("engine");
    configure(engine.constants);
  } catch (err) {
    const main = document.querySelector("main .wrap");
    main.append(errorNote(`The engine's constants (data/engine.json) could not be loaded: ${err.message}.`));
    return;
  }
  try {
    await document.fonts.ready;
  } catch {
    // text measurement falls back to the system face
  }
  footer();
  window.addEventListener("hashchange", () => route({ focus: true }));
  route({ focus: false });
}

boot();
