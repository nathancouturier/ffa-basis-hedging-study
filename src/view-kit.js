// view-kit.js: what every view shares: the basket rule, source lines, and the wiring of panels and
// disclosure sections to the hash.

import { basket_of } from "./engine.js";
import { h, disclosures, panelSwitch } from "./dom.js";
import { exists } from "./data.js";
import { num, dateLong, addDays, plural, tenorLabel, capitalise } from "./format.js";

/** The 5TC basket rule from data/engine.json, with the basket sizes produced by engine.js. */
export function basketRule(engine) {
  const from = engine?.constants?.BASKET_182_FROM;
  if (!from) return null;
  const before = basket_of(addDays(from, -1));
  const after = basket_of(from);
  return { from, before, after, text: `5TC figures are on the ${num(before)} t basket before ${dateLong(from)} and on the ${num(after)} t basket from then` };
}

/** Basket statement for a window of dates [first, last]. */
export function basketForWindow(engine, first, last) {
  const rule = basketRule(engine);
  if (!rule || !first || !last) return null;
  if (last < rule.from) return `${num(rule.before)} t basket throughout`;
  if (first >= rule.from) return `${num(rule.after)} t basket throughout`;
  return `${num(rule.before)} t basket before ${dateLong(rule.from)}, ${num(rule.after)} t from then`;
}

/** A source line from the artifact's own sources_line when present, else a composed one. */
export function sourceLine(artifact, fallback) {
  const line = typeof artifact?.sources_line === "string" ? artifact.sources_line : null;
  return `Source: ${line || fallback}`;
}

export function retrievedTo(manifest) {
  const last = (manifest?.sources || []).map((s) => s.last_retrieved).filter(Boolean).sort().pop();
  return last ? `Retrieved to ${dateLong(last.slice(0, 10))}.` : "";
}

/** "retrieved 17 November 2026" for the manifest source whose name contains `needle`. */
export function retrievedOf(manifest, needle) {
  const src = (manifest?.sources || []).find((x) => x.source.includes(needle));
  return src?.last_retrieved ? `retrieved ${dateLong(src.last_retrieved.slice(0, 10))}` : retrievedTo(manifest).replace(/\.$/, "").toLowerCase();
}

export function openIds(params) {
  return (params.open || "").split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * Wire a view's panels and disclosures to the hash.
 * Returns { panelsEl, disclosuresEl, update(params) }.
 */
export function wire(ctx, viewId, { panels, sections, panelLabel, onOpenChange }) {
  let pn = null;
  if (panels && panels.length) {
    pn = panelSwitch({ viewId, panels, active: ctx.params.panel, label: panelLabel, onChange: (id) => ctx.setParams({ panel: id }) });
  }
  const ds = disclosures({ viewId, sections, open: openIds(ctx.params), onChange: onOpenChange || ((ids) => ctx.setParams({ open: ids.join(",") })) });
  return {
    panelsEl: pn ? pn.el : null,
    disclosuresEl: ds.el,
    update(params) {
      if (pn && params.panel) pn.set(params.panel);
      ds.setOpen(openIds(params));
    },
    /** What the view shows now, for the hash. */
    state() {
      return { panel: pn ? pn.current() : undefined, open: ds.ids().join(",") };
    },
  };
}

export function sectionHead(text) {
  return h("h2", { class: "section-title" }, text);
}

export function csvLink(file, text) {
  return h("a", { href: `data/downloads/${file}` }, text || file);
}

/**
 * "Download: a.csv, b.csv." listing only the files that exist in this build (a HEAD request each), so a
 * file the pipeline has not written never shows as a dead link. items: [{ file, what? }]
 */
export function downloadLine(items) {
  const el = h("p", { hidden: true }, "Download: ");
  Promise.all(items.map((it) => exists(`data/downloads/${it.file}`))).then((found) => {
    const present = items.filter((_, i) => found[i]);
    present.forEach((it, i) => {
      if (i) el.append(", ");
      el.append(csvLink(it.file));
      if (it.what) el.append(` (${it.what})`);
    });
    el.append(".");
    el.hidden = present.length === 0;
  });
  return el;
}

/** A short text summary of the quarter-end strips (and the spot prints): the range and the latest strip. */
export function stripSummary(strips, bw = []) {
  const all = strips.flatMap((st) => st.months.map((mm) => ({ ...mm, as_of: st.as_of })));
  if (!all.length) return "";
  const lo = all.reduce((a, b) => (b.usd_t < a.usd_t ? b : a));
  const hi = all.reduce((a, b) => (b.usd_t > a.usd_t ? b : a));
  const last = strips[strips.length - 1];
  let text = `${plural(strips.length, "quarter-end strip", "quarter-end strips")} from ${dateLong(strips[0].as_of)} to ${dateLong(last.as_of)}, USD a tonne: lowest ${num(lo.usd_t, 2)} (${tenorLabel(lo.month)}, marked ${dateLong(lo.as_of)}), highest ${num(hi.usd_t, 2)} (${tenorLabel(hi.month)}, marked ${dateLong(hi.as_of)}); the latest strip, of ${dateLong(last.as_of)}: ${last.months.map((mm) => `${tenorLabel(mm.month)} ${num(mm.usd_t, 2)}`).join(", ")}.`;
  const prints = bw.filter((b) => Number.isFinite(b.td3c_usd_t));
  if (prints.length) {
    const plo = prints.reduce((a, b) => (b.td3c_usd_t < a.td3c_usd_t ? b : a));
    const phi = prints.reduce((a, b) => (b.td3c_usd_t > a.td3c_usd_t ? b : a));
    text += ` ${plural(prints.length, "Breakwave spot print", "Breakwave spot prints")} from ${dateLong(prints[0].date)} to ${dateLong(prints[prints.length - 1].date)}: lowest ${num(plo.td3c_usd_t, 2)} (${dateLong(plo.date)}), highest ${num(phi.td3c_usd_t, 2)} (${dateLong(phi.date)}).`;
  }
  return capitalise(text);
}
