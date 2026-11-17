// charts.js: every chart on the site, drawn by hand in SVG.
//
// One frame for all charts: a title that states the takeaway, a legend in words, a focusable plot
// (arrow keys step through the points, Escape hides the details), a tooltip mirrored to a live region,
// an <svg role="img"> with <title> and <desc>, the text summary and the source line. Marks take their
// colour from CSS custom properties (classes s-* and f-*), so a theme change needs no redraw; a chart
// redraws only when its width changes.

import { h, clear, nextId } from "./dom.js";
import { tick, monthAbbr } from "./format.js";

const LAYOUT = Object.freeze({
  heightMin: 230, // literal: px, smallest plot height
  heightMax: 380, // literal: px, tallest plot height
  aspect: 0.5,
  top: 26,
  bottom: 48,
  right: 14,
  tickGap: 10,
  minTickSpace: 64,
  rowHeight: 30,
  groupHeight: 30,
  dotR: 4,
  hitPad: 16,
  barMax: 24,
  barRadius: 4,
  narrow: 640, // literal: px, below this width the calendar strip turns into columns
  calendarRow: 18,
  calendarRowNarrow: 7,
  tipGap: 12,
  drawMs: 900, // literal: ms, the single orchestrated motion: the cited curve drawing in
  midMonthDay: 15,
  monthsPerYear: 12,
  weeksMax: 53,
  daysPerWeek: 7,
  isoThursday: 4,
  msPerDay: 86400000, // literal: unit, milliseconds in a day
  fontSize: 12,
  labelGap: 8,
  yPad: 0.06,
  stackedLabel: 16,
  stackForest: 480, // literal: px, below this width forest rows put their label above the interval
  labelShare: 0.4, // a bar chart whose row labels would take more of the width puts them above the bars
  tickY: 20,
  regular: 400, // literal: font weight of labels
  bold: 600, // literal: font weight of strong labels
});

const SVG = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") el.textContent = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

let motionDone = false;
function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Text is measured in a hidden SVG with the chart's own CSS (tabular figures included), so a label's
// width here is the width it is drawn at.
let probe = null;
const widths = new Map();
export function textWidth(str, weight = LAYOUT.regular, size = LAYOUT.fontSize) {
  const key = `${weight}|${size}|${str}`;
  if (widths.has(key)) return widths.get(key);
  if (!probe) {
    const svg = s("svg", { class: "chart measure-svg", "aria-hidden": "true", focusable: "false" });
    probe = s("text", { x: 0, y: LAYOUT.fontSize });
    svg.append(probe);
    document.body.append(svg);
  }
  probe.style.fontWeight = String(weight);
  probe.style.fontSize = `${size}px`;
  probe.textContent = String(str);
  const w = probe.getComputedTextLength();
  widths.set(key, w);
  return w;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function scaleLinear(d0, d1, r0, r1) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = (v) => r0 + (v - d0) * k;
  f.invert = (px) => (k === 0 ? d0 : d0 + (px - r0) / k);
  return f;
}

/** Round tick steps (1, 2, 5 x 10^n) covering [min, max]. */
export function niceTicks(min, max, count = 5) {
  if (!(Number.isFinite(min) && Number.isFinite(max))) return { lo: 0, hi: 1, step: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad / 2;
    max += pad / 2;
  }
  const raw = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  const step = (r >= 7 ? 10 : r >= 3 ? 5 : r >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i += 1) ticks.push(Number((lo + i * step).toPrecision(12)));
  return { lo, hi, step, ticks };
}

/**
 * Ticks for a horizontal value axis: the most ticks whose labels fit side by side in `span` px. When
 * none fits, every tick keeps its gridline and only every n-th one (and zero) its label: nt.labelled(t).
 */
function fitAxis(min, max, span, fmt) {
  let last = null;
  for (const count of [6, 5, 4, 3, 2]) {
    const nt = niceTicks(min, max, count);
    last = nt;
    const widest = Math.max(...nt.ticks.map((t) => textWidth(fmt(t))));
    const spacing = span / Math.max(1, nt.ticks.length - 1);
    if (spacing >= widest + LAYOUT.labelGap * 2) {
      nt.labelled = () => true;
      return nt;
    }
    if (count === 2) {
      const every = Math.ceil((widest + LAYOUT.labelGap * 2) / spacing);
      const zero = nt.ticks.indexOf(0);
      const anchor = zero >= 0 ? zero : 0;
      nt.labelled = (t) => (nt.ticks.indexOf(t) - anchor) % every === 0;
    }
  }
  return last;
}

/** An x tick label kept inside [0, width]: anchored inward at the edges. */
function xTickLabel(px, y, text, width) {
  const w = textWidth(text);
  if (px - w / 2 < 0) return s("text", { x: Math.max(0, px - 2), y, "text-anchor": "start", text });
  if (px + w / 2 > width) return s("text", { x: Math.min(width, px + 2), y, "text-anchor": "end", text });
  return s("text", { x: px, y, "text-anchor": "middle", text });
}

// ------------------------------------------------------------------- time

export function monthMid(key) {
  const [y, m] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, LAYOUT.midMonthDay);
}

export function monthStart(key) {
  const [y, m] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, 1);
}

export function monthEnd(key) {
  const [y, m] = key.split("-").map(Number);
  return Date.UTC(y, m, 1) - 1;
}

export function dayMs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function timeTicks(min, max, width) {
  const steps = [1, 2, 3, 6, 12, 24, 36];
  const startDate = new Date(min);
  let single = null;
  for (const step of steps) {
    const ticks = [];
    let y = startDate.getUTCFullYear();
    let m = startDate.getUTCMonth();
    if (Date.UTC(y, m, 1) < min) m += 1;
    if (step >= LAYOUT.monthsPerYear) {
      if (m > 0) {
        y += 1;
        m = 0;
      }
    } else {
      while (m % step !== 0) m += 1;
    }
    for (;;) {
      const yy = y + Math.floor(m / LAYOUT.monthsPerYear);
      const mm = ((m % LAYOUT.monthsPerYear) + LAYOUT.monthsPerYear) % LAYOUT.monthsPerYear;
      const t = Date.UTC(yy, mm, 1);
      if (t > max) break;
      let label;
      if (step >= LAYOUT.monthsPerYear) label = String(yy);
      else if (mm === 0) label = `${monthAbbr(1)} ${yy}`;
      else label = monthAbbr(mm + 1);
      ticks.push({ v: t, label });
      m += step;
    }
    if (step < LAYOUT.monthsPerYear && ticks.length && !/\d{4}/.test(ticks[0].label)) ticks[0].label = `${ticks[0].label} ${new Date(ticks[0].v).getUTCFullYear()}`;
    if (ticks.length < 2) {
      // a range shorter than the step: one labelled tick is better than none
      if (ticks.length === 1 && !single) single = ticks;
      continue;
    }
    const span = max - min || 1;
    const spacing = (width * (ticks[1].v - ticks[0].v)) / span;
    // neighbours share the space between them: the first label carries its year and is the widest
    const need = Math.max(...ticks.slice(1).map((t, i) => (textWidth(ticks[i].label) + textWidth(t.label)) / 2)) + LAYOUT.labelGap * 2;
    if (spacing >= need) return ticks;
  }
  return single || [];
}

// ------------------------------------------------------------------ frame

function legendSwatch(kind, cls) {
  const sw = s("svg", { width: 18, height: 12, viewBox: "0 0 18 12", "aria-hidden": "true" });
  if (kind === "line") sw.append(s("line", { x1: 1, y1: 6, x2: 17, y2: 6, class: `line s-${cls}` }));
  else if (kind === "thin") sw.append(s("line", { x1: 1, y1: 6, x2: 17, y2: 6, class: `line thin s-${cls}` }));
  else if (kind === "dash") sw.append(s("line", { x1: 1, y1: 6, x2: 17, y2: 6, class: `line dash s-${cls}` }));
  else if (kind === "dot") sw.append(s("circle", { cx: 9, cy: 6, r: 4, class: `f-${cls}` }));
  else if (kind === "linedot") sw.append(s("line", { x1: 1, y1: 6, x2: 17, y2: 6, class: `line s-${cls}` }), s("circle", { cx: 9, cy: 6, r: 3.5, class: `f-${cls}` }));
  else if (kind === "hollow") sw.append(s("circle", { cx: 9, cy: 6, r: 3.5, class: `dot hollow s-${cls}` }));
  else if (kind === "diamond") sw.append(s("path", { d: "M9 1.5 L13.5 6 L9 10.5 L4.5 6 Z", class: `dot hollow s-${cls}` }));
  else if (kind === "ring") sw.append(s("circle", { cx: 9, cy: 6, r: 3, class: `dot hollow s-${cls}` }));
  else if (kind === "square") sw.append(s("rect", { x: 5, y: 2, width: 8, height: 8, class: `dot hollow s-${cls}` }));
  else if (kind === "span") sw.append(s("line", { x1: 1, y1: 6, x2: 17, y2: 6, class: `span s-${cls}` }), s("circle", { cx: 9, cy: 6, r: 3, class: `f-${cls}` }));
  else if (kind === "band") sw.append(s("rect", { x: 1, y: 1, width: 16, height: 10, class: `band f-${cls}` }));
  else if (kind === "outline") sw.append(s("rect", { x: 3, y: 1.5, width: 12, height: 9, rx: 1.5, class: "outline-bar" }));
  else if (kind === "hatch") {
    sw.append(s("rect", { x: 1, y: 1, width: 16, height: 10, fill: "none", class: "hatch-line" }));
    for (let i = 0; i < 4; i += 1) sw.append(s("line", { x1: 1 + i * 5, y1: 11, x2: 5 + i * 5, y2: 1, class: "hatch-line" }));
  } else if (kind === "empty") sw.append(s("rect", { x: 3, y: 1.5, width: 12, height: 9, class: "cell-empty" }));
  else if (kind === "cellnone") sw.append(s("rect", { x: 3.5, y: 2, width: 11, height: 8, class: "cell-none" }));
  else sw.append(s("rect", { x: 3, y: 1.5, width: 12, height: 9, rx: 2, class: `f-${cls}` }));
  return sw;
}

function renderTip(tipEl, tip) {
  clear(tipEl);
  if (tip.title) tipEl.append(h("div", { class: "tip-title" }, tip.title));
  for (const r of tip.rows || []) {
    const row = h("div", { class: "tip-row" }, h("span", { class: `k ${r.key ? `k-${r.key}` : "none"}` }));
    const text = h("span");
    if (r.value) text.append(h("b", {}, r.value), " ");
    if (r.label) text.append(r.label);
    row.append(text);
    tipEl.append(row);
  }
  if (tip.note) tipEl.append(h("div", { class: "tip-note" }, tip.note));
}

function tipText(tip) {
  const parts = [tip.title];
  for (const r of tip.rows || []) parts.push([r.value, r.label].filter(Boolean).join(" "));
  if (tip.note) parts.push(tip.note);
  return parts.filter(Boolean).join(". ");
}

/**
 * The frame. spec: { title, subtitle, legend: [{ label, cls, kind }], summary, source, level,
 * mode: "x" | "xy", render(width) -> { height, nodes: [svg nodes], targets: [...], plotTop, plotBottom } }
 * A target: { x, y, tip: { title, rows: [{ key, value, label }], note }, box?: { x, y, w, h } }.
 */
export function frame(container, spec) {
  const id = nextId("chart");
  const titleId = `${id}-title`;
  const summaryId = `${id}-summary`;
  const fig = h("figure", { class: "chart", "aria-labelledby": titleId });
  const head = h("div", { class: "chart-head" });
  head.append(h(spec.level === 3 ? "h3" : "h2", { class: "chart-title", id: titleId }, spec.title));
  if (spec.subtitle) head.append(h("p", { class: "chart-sub" }, spec.subtitle));
  fig.append(head);
  if (spec.legend && spec.legend.length) {
    const ul = h("ul", { class: "legend", "aria-label": "Legend" });
    for (const item of spec.legend) ul.append(h("li", {}, legendSwatch(item.kind || "rect", item.cls), h("span", {}, item.label)));
    fig.append(ul);
  }
  const plot = h("div", { class: "plot", tabindex: "0", role: "group", "aria-describedby": summaryId });
  const svg = s("svg", { role: "img", "aria-labelledby": `${id}-svgt ${id}-svgd`, focusable: "false" });
  svg.append(s("title", { id: `${id}-svgt`, text: spec.title }), s("desc", { id: `${id}-svgd`, text: spec.summary || "" }));
  const layer = s("g", { class: "layer" });
  const hover = s("g", { class: "hover", "aria-hidden": "true" });
  svg.append(layer, hover);
  const tipEl = h("div", { class: "tip", hidden: true, "aria-hidden": "true" });
  const live = h("div", { class: "vh", "aria-live": "polite" });
  plot.append(svg, tipEl, live);
  fig.append(plot);
  const foot = h("div", { class: "chart-foot" });
  foot.append(h("p", { class: "chart-summary", id: summaryId }, spec.summary || ""));
  if (spec.footer) foot.append(spec.footer);
  if (spec.source) foot.append(h("p", { class: "chart-source" }, spec.source));
  fig.append(foot);
  container.append(fig);

  const state = { width: 0, targets: [], idx: -1, plotTop: 0, plotBottom: 0, active: false };

  function draw(force = false) {
    const w = Math.floor(plot.clientWidth);
    if (w <= 0) return;
    if (!force && w === state.width) return;
    state.width = w;
    clear(layer);
    clear(hover);
    const out = spec.render(w);
    svg.setAttribute("width", w);
    svg.setAttribute("height", out.height);
    svg.setAttribute("viewBox", `0 0 ${w} ${out.height}`);
    for (const n of out.nodes) layer.append(n);
    state.targets = out.targets || [];
    state.plotTop = out.plotTop ?? 0;
    state.plotBottom = out.plotBottom ?? out.height;
    plot.setAttribute("aria-label", `${spec.title}. ${state.targets.length ? `Use the arrow keys to step through ${state.targets.length} points; Escape hides the details.` : ""}`);
    if (out.afterDraw) out.afterDraw();
    if (state.idx >= state.targets.length) state.idx = state.targets.length - 1;
    if (state.active && state.idx >= 0) show(state.idx, false);
    else hide();
  }

  function show(i, announce) {
    const t = state.targets[i];
    if (!t) return;
    state.idx = i;
    clear(hover);
    if (spec.mode === "x") hover.append(s("line", { x1: t.x, x2: t.x, y1: state.plotTop, y2: state.plotBottom, class: "cross" }));
    if (t.box) hover.append(s("rect", { x: t.box.x - 2, y: t.box.y - 2, width: t.box.w + 4, height: t.box.h + 4, rx: 2, class: "hover-cell" }));
    else hover.append(s("circle", { cx: t.x, cy: t.y, r: (t.r || LAYOUT.dotR) + 3, class: "hover-ring" }));
    renderTip(tipEl, t.tip);
    tipEl.hidden = false;
    const pw = plot.clientWidth;
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    let left = t.x + LAYOUT.tipGap;
    if (left + tw > pw) left = t.x - LAYOUT.tipGap - tw;
    left = clamp(left, 0, Math.max(0, pw - tw));
    let top = t.y - th - LAYOUT.tipGap;
    if (top < 0) top = t.y + LAYOUT.tipGap;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
    if (announce) live.textContent = tipText(t.tip);
  }

  function hide() {
    tipEl.hidden = true;
    clear(hover);
  }

  function nearest(px, py) {
    let best = -1;
    let bestD = Infinity;
    state.targets.forEach((t, i) => {
      let d;
      if (t.box && px >= t.box.x - 2 && px <= t.box.x + t.box.w + 2 && py >= t.box.y - 2 && py <= t.box.y + t.box.h + 2) d = -1;
      else if (spec.mode === "x") d = Math.abs(t.x - px);
      else d = Math.hypot(t.x - px, t.y - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (spec.mode !== "x" && bestD > LAYOUT.hitPad * 2) return -1;
    return best;
  }

  plot.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect();
    const i = nearest(ev.clientX - r.left, ev.clientY - r.top);
    if (i < 0) {
      hide();
      return;
    }
    state.active = true;
    show(i, false);
  });
  plot.addEventListener("pointerleave", () => {
    if (document.activeElement !== plot) {
      state.active = false;
      hide();
    }
  });
  plot.addEventListener("focus", () => {
    state.active = true;
    if (state.targets.length) show(state.idx >= 0 ? state.idx : 0, true);
  });
  plot.addEventListener("blur", () => {
    state.active = false;
    hide();
  });
  plot.addEventListener("keydown", (ev) => {
    const n = state.targets.length;
    if (!n) return;
    let i = state.idx < 0 ? 0 : state.idx;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") i = Math.min(n - 1, i + 1);
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") i = Math.max(0, i - 1);
    else if (ev.key === "Home") i = 0;
    else if (ev.key === "End") i = n - 1;
    else if (ev.key === "Escape") {
      state.active = false;
      hide();
      return;
    } else return;
    ev.preventDefault();
    state.active = true;
    show(i, true);
  });

  let pending = false;
  const ro = new ResizeObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      draw();
    });
  });
  ro.observe(plot);
  requestAnimationFrame(() => draw());

  return { el: fig, redraw: () => draw(true), plot };
}

/** A chart that has nothing to draw says why, in the chart's place. */
export function empty(container, { title, text, level }) {
  const fig = h("div", { class: "chart" });
  fig.append(h("div", { class: "chart-head" }, h(level === 3 ? "h3" : "h2", { class: "chart-title" }, title)));
  fig.append(h("p", { class: "chart-empty" }, text));
  container.append(fig);
  return fig;
}

// ------------------------------------------------------------- shared axes

function yAxis({ nodes, y, ticks, left, right, fmt, title, maxAbs }) {
  const grid = s("g", { class: "grid" });
  for (const t of ticks) {
    const py = Math.round(y(t)) + 0.5;
    grid.append(s("line", { x1: left, x2: right, y1: py, y2: py }));
    nodes.push(s("text", { x: left - LAYOUT.tickGap, y: py + 4, "text-anchor": "end", text: fmt ? fmt(t, maxAbs) : tick(t, maxAbs) }));
  }
  nodes.unshift(grid);
  if (title) nodes.push(s("text", { x: 0, y: LAYOUT.fontSize, class: "axis-title", text: title }));
}

function xTitle(nodes, text, width, height) {
  if (text) nodes.push(s("text", { x: width - LAYOUT.right, y: height - 4, "text-anchor": "end", class: "axis-title", text }));
}

function tickMargin(ticks, fmt, maxAbs) {
  return Math.ceil(Math.max(...ticks.map((t) => textWidth(fmt ? fmt(t, maxAbs) : tick(t, maxAbs))))) + LAYOUT.tickGap + 4;
}

function barPath(x, y0, y1, w, r) {
  // rounded at the data end (y1), square at the baseline (y0)
  const up = y1 < y0;
  const hgt = Math.abs(y1 - y0);
  const rr = Math.min(r, hgt / 2, w / 2);
  if (hgt < 0.5) return `M${x},${y0}h${w}`;
  if (up) {
    return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`;
}

function hbarPath(x0, x1, y, hgt, r) {
  // horizontal bar rounded at the data end (x1)
  const right = x1 > x0;
  const w = Math.abs(x1 - x0);
  const rr = Math.min(r, w / 2, hgt / 2);
  if (w < 0.5) return `M${x0},${y}v${hgt}`;
  if (right) return `M${x0},${y}H${x1 - rr}Q${x1},${y} ${x1},${y + rr}V${y + hgt - rr}Q${x1},${y + hgt} ${x1 - rr},${y + hgt}H${x0}Z`;
  return `M${x0},${y}H${x1 + rr}Q${x1},${y} ${x1},${y + rr}V${y + hgt - rr}Q${x1},${y + hgt} ${x1 + rr},${y + hgt}H${x0}Z`;
}

function hatchPattern(id) {
  const pat = s("pattern", { id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pat.append(s("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "hatch-line" }));
  return s("defs", {}, pat);
}

function plotHeight(width, opts) {
  if (opts.height) return typeof opts.height === "function" ? opts.height(width) : opts.height;
  return clamp(Math.round(width * (opts.aspect || LAYOUT.aspect)), opts.minHeight || LAYOUT.heightMin, opts.maxHeight || LAYOUT.heightMax);
}

// ------------------------------------------------------------- line chart

/**
 * lineChart: time or linear x, one y axis.
 * opts.x: { type: "time" | "linear", min, max, title, format }
 * opts.y: { min, max, title, format, includeZero }
 * opts.series: [{ cls, points: [{ x, y, tip? }], line?: true, dots?: true, hollow?, thin?, dash?, animate?, endLabel? }]
 * opts.spans: [{ x0, x1, y, cls, tip }], opts.refs: [{ y, label, cls }], opts.vlines: [{ x, label, cls }]
 * opts.bands: [{ cls, inner?, points: [{ x, y0, y1 }] }], opts.shades: [{ x0, x1 }] (hatched)
 * opts.targets: "points" (default) or a function (layout) -> targets
 */
export function lineChart(container, opts) {
  return frame(container, {
    ...opts,
    mode: opts.mode || "xy",
    render(width) {
      const nodes = [];
      const allY = [];
      const allX = [];
      for (const se of opts.series || []) for (const p of se.points) if (Number.isFinite(p.y)) {
        allY.push(p.y);
        allX.push(p.x);
      }
      for (const sp of opts.spans || []) {
        allY.push(sp.y);
        allX.push(sp.x0, sp.x1);
      }
      for (const b of opts.bands || []) for (const p of b.points) {
        allY.push(p.y0, p.y1);
        allX.push(p.x);
      }
      for (const r of opts.refs || []) allY.push(r.y);
      for (const v of opts.vlines || []) allX.push(v.x);
      let ymin = opts.y.min ?? Math.min(...allY);
      let ymax = opts.y.max ?? Math.max(...allY);
      const pad = (ymax - ymin) * LAYOUT.yPad;
      if (opts.y.min === undefined && !(opts.y.includeZero && ymin >= 0)) ymin -= pad;
      if (opts.y.max === undefined) ymax += pad;
      if (opts.y.includeZero) {
        ymin = Math.min(0, ymin);
        ymax = Math.max(0, ymax);
      }
      const nt = niceTicks(ymin, ymax, width < LAYOUT.narrow ? 4 : 5);
      const maxAbs = Math.max(Math.abs(nt.lo), Math.abs(nt.hi));
      const left = tickMargin(nt.ticks, opts.y.format, maxAbs);
      let rightPad = LAYOUT.right;
      for (const se of opts.series || []) {
        if (se.endLabel) rightPad = Math.max(rightPad, Math.ceil(textWidth(se.endLabel, LAYOUT.bold)) + LAYOUT.labelGap * 2);
      }
      rightPad = Math.min(rightPad, Math.round(width * 0.3));
      const height = plotHeight(width, opts) + LAYOUT.top + LAYOUT.bottom;
      const top = LAYOUT.top;
      const bottom = height - LAYOUT.bottom;
      const right = width - rightPad;
      const xmin = opts.x.min ?? Math.min(...allX);
      const xmax = opts.x.max ?? Math.max(...allX);
      const x = scaleLinear(xmin, xmax, left, right);
      const y = scaleLinear(nt.lo, nt.hi, bottom, top);
      yAxis({ nodes, y, ticks: nt.ticks, left, right, fmt: opts.y.format, title: opts.y.title, maxAbs });

      // x ticks
      const xticks = opts.x.type === "time" ? timeTicks(xmin, xmax, right - left) : linearXTicks(xmin, xmax, right - left, opts.x.format);
      for (const t of xticks) {
        const px = x(t.v);
        if (px < left - 1 || px > right + 1) continue;
        nodes.push(s("line", { x1: px, x2: px, y1: bottom, y2: bottom + 4, class: "axis-line" }));
        nodes.push(xTickLabel(px, bottom + LAYOUT.tickY, t.label, width));
      }
      nodes.push(s("line", { x1: left, x2: right, y1: bottom + 0.5, y2: bottom + 0.5, class: "axis-line" }));
      xTitle(nodes, opts.x.title, width, height);

      if (nt.lo < 0 && nt.hi > 0) nodes.push(s("line", { x1: left, x2: right, y1: y(0), y2: y(0), class: "zero" }));

      // hatched shades (for example thin-market weeks)
      if (opts.shades && opts.shades.length) {
        const pid = nextId("hatch");
        nodes.push(hatchPattern(pid));
        for (const sh of opts.shades) {
          const x0 = x(sh.x0);
          const x1 = Math.max(x(sh.x1), x0 + 2);
          nodes.push(s("rect", { x: x0, y: top, width: x1 - x0, height: bottom - top, fill: `url(#${pid})` }));
        }
      }

      for (const b of opts.bands || []) {
        const pts = b.points.filter((p) => Number.isFinite(p.y0) && Number.isFinite(p.y1));
        if (pts.length < 2) continue;
        const upper = pts.map((p) => `${x(p.x)},${y(p.y1)}`).join("L");
        const lower = pts.slice().reverse().map((p) => `${x(p.x)},${y(p.y0)}`).join("L");
        nodes.push(s("path", { d: `M${upper}L${lower}Z`, class: `band f-${b.cls}${b.inner ? " inner" : ""}` }));
      }

      // every data point in pixels, so reference labels can avoid them
      const occupied = [];
      for (const se of opts.series || []) for (const p of se.points) if (Number.isFinite(p.y)) occupied.push([x(p.x), y(p.y)]);
      for (const sp of opts.spans || []) occupied.push([x(sp.x0), y(sp.y)], [(x(sp.x0) + x(sp.x1)) / 2, y(sp.y)], [x(sp.x1), y(sp.y)]);
      const clashes = (x0, x1, y0, y1) => occupied.some(([px, py]) => px >= x0 - 6 && px <= x1 + 6 && py >= y0 - 2 && py <= y1 + 2);
      for (const r of opts.refs || []) {
        const py = y(r.y);
        nodes.push(s("line", { x1: left, x2: right, y1: py, y2: py, class: r.cls ? `line thin ${r.dash ? "dash " : ""}s-${r.cls}` : "ref" }));
        if (!r.label) continue;
        const tw = textWidth(r.label);
        const spots = [
          { x: right - 2, anchor: "end", y: py - 6, x0: right - 2 - tw },
          { x: right - 2, anchor: "end", y: py + 15, x0: right - 2 - tw },
          { x: left + 4, anchor: "start", y: py - 6, x0: left + 4 },
          { x: left + 4, anchor: "start", y: py + 15, x0: left + 4 },
        ];
        const pick = spots.find((sp) => !clashes(sp.x0, sp.x0 + tw, sp.y - LAYOUT.fontSize, sp.y)) || spots[0];
        nodes.push(s("text", { x: pick.x, y: pick.y, "text-anchor": pick.anchor, class: "label halo", text: r.label }));
      }

      const vlineNodes = [];
      (opts.vlines || []).forEach((v) => {
        const px = x(v.x);
        vlineNodes.push(s("line", { x1: px, x2: px, y1: top, y2: bottom, class: v.cls ? `line thin ${v.dash ? "dash " : ""}s-${v.cls}` : "event-line" }));
        if (v.label) {
          const anchorEnd = px > right - textWidth(v.label) - 6;
          vlineNodes.push(s("text", { x: anchorEnd ? px - 4 : px + 4, y: top + 10 + (v.row || 0) * 14, "text-anchor": anchorEnd ? "end" : "start", class: "label-strong halo", text: v.label }));
        }
      });
      nodes.push(...vlineNodes);

      for (const sp of opts.spans || []) {
        const x0 = x(sp.x0);
        const x1 = x(sp.x1);
        nodes.push(s("line", { x1: x0 + 1, x2: x1 - 1, y1: y(sp.y), y2: y(sp.y), class: `span s-${sp.cls}${sp.hollow ? " hollow-span" : ""}` }));
      }

      const animated = [];
      for (const se of opts.series || []) {
        const pts = se.points.filter((p) => Number.isFinite(p.y)).slice().sort((a, b) => a.x - b.x);
        if (se.line !== false && pts.length > 1) {
          const segs = [];
          let cur = [];
          for (const p of se.points.slice().sort((a, b) => a.x - b.x)) {
            if (Number.isFinite(p.y)) cur.push(p);
            else if (cur.length) {
              segs.push(cur);
              cur = [];
            }
          }
          if (cur.length) segs.push(cur);
          for (const seg of segs) {
            if (seg.length < 2) continue;
            const d = `M${seg.map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join("L")}`;
            const path = s("path", { d, class: `line s-${se.cls}${se.thin ? " thin" : ""}${se.dash ? " dash" : ""}${se.muted ? " is-muted" : ""}` });
            nodes.push(path);
            if (se.animate) animated.push(path);
          }
        }
        if (se.dots) {
          for (const p of pts) {
            const cx = x(p.x);
            const cy = y(p.y);
            const mute = se.muted ? " is-muted" : "";
            if (se.shape === "square") nodes.push(s("rect", { x: cx - 4, y: cy - 4, width: 8, height: 8, class: `dot hollow s-${se.cls}${mute}` }));
            else if (p.hollow || se.hollow) nodes.push(s("circle", { cx, cy, r: se.r || LAYOUT.dotR, class: `dot hollow s-${p.cls || se.cls}${mute}` }));
            else nodes.push(s("circle", { cx, cy, r: se.r || LAYOUT.dotR, class: `dot f-${p.cls || se.cls}${mute}` }));
          }
        }
        if (se.endLabel && pts.length) {
          const last = pts[pts.length - 1];
          nodes.push(s("text", { x: x(last.x) + LAYOUT.labelGap, y: y(last.y) + 4, class: "label-strong halo", text: se.endLabel }));
        }
      }
      for (const sp of opts.spans || []) {
        if (sp.dot === false) continue;
        const cx = (x(sp.x0) + x(sp.x1)) / 2;
        nodes.push(s("circle", { cx, cy: y(sp.y), r: LAYOUT.dotR, class: sp.hollow ? `dot hollow s-${sp.cls}` : `dot f-${sp.cls}` }));
      }
      for (const lab of opts.labels || []) {
        nodes.push(s("text", { x: x(lab.x) + (lab.dx || 0), y: y(lab.y) + (lab.dy || 0), "text-anchor": lab.anchor || "start", class: `${lab.strong ? "label-strong" : "label"} halo`, text: lab.text }));
      }

      // targets
      let targets = [];
      if (typeof opts.targets === "function") targets = opts.targets({ x, y, left, right, top, bottom });
      else {
        for (const se of opts.series || []) for (const p of se.points) if (p.tip && Number.isFinite(p.y)) targets.push({ x: x(p.x), y: y(p.y), tip: p.tip, sortX: p.x });
        for (const sp of opts.spans || []) if (sp.tip) targets.push({ x: (x(sp.x0) + x(sp.x1)) / 2, y: y(sp.y), tip: sp.tip, sortX: (sp.x0 + sp.x1) / 2 });
        targets.sort((a, b) => a.sortX - b.sortX || a.y - b.y);
      }
      const afterDraw = () => {
        if (!animated.length || motionDone || reducedMotion()) return;
        motionDone = true;
        for (const path of animated) {
          const len = path.getTotalLength();
          path.style.strokeDasharray = `${len}`;
          path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: LAYOUT.drawMs, easing: "cubic-bezier(.3,.7,.4,1)" })
            .finished.then(() => {
              path.style.strokeDasharray = "";
            }).catch(() => {});
        }
      };
      return { height, nodes, targets, plotTop: top, plotBottom: bottom, afterDraw };
    },
  });
}

function linearXTicks(min, max, span, fmt) {
  for (const count of [6, 5, 4, 3, 2]) {
    const nt = niceTicks(min, max, count);
    const ticks = nt.ticks.filter((v) => v >= min - 1e-9 && v <= max + 1e-9).map((v) => ({ v, label: fmt ? fmt(v) : tick(v, Math.max(Math.abs(min), Math.abs(max))) }));
    if (ticks.length < 2) continue;
    const spacing = (span * (ticks[1].v - ticks[0].v)) / (max - min || 1);
    const widest = Math.max(...ticks.map((t) => textWidth(t.label)));
    if (spacing >= widest + LAYOUT.labelGap * 2) return ticks;
  }
  return [];
}

// ------------------------------------------------------------ forest plot

/**
 * forestChart: one row per estimate with its interval, grouped.
 * opts.groups: [{ label, rows: [{ label, est, lo, hi, emph?, extra?: { value }, tip }] }]
 * opts.x: { min, max, title, format }
 */
export function forestChart(container, opts) {
  return frame(container, {
    ...opts,
    mode: "xy",
    render(width) {
      const nodes = [];
      const values = [];
      for (const g of opts.groups) for (const r of g.rows) values.push(r.est, r.lo, r.hi, r.extra?.value, r.extra?.same);
      const finite = values.filter(Number.isFinite);
      // Below this width each row's label sits above its interval, so the interval gets the full width.
      const stacked = width < LAYOUT.stackForest;
      const rowH = stacked ? LAYOUT.rowHeight + LAYOUT.stackedLabel : LAYOUT.rowHeight;
      const labelW = stacked ? 0 : Math.ceil(Math.max(...opts.groups.flatMap((g) => [textWidth(g.label, LAYOUT.bold), ...g.rows.map((r) => textWidth(r.label, r.emph ? LAYOUT.bold : LAYOUT.regular) + 12)]))) + LAYOUT.labelGap;
      const valueW = Math.ceil(Math.max(...opts.groups.flatMap((g) => g.rows.map((r) => textWidth(opts.x.format(r.est), LAYOUT.bold))))) + LAYOUT.labelGap * 2;
      const left = stacked ? LAYOUT.labelGap : labelW + LAYOUT.labelGap;
      const right = width - valueW;
      const nt = fitAxis(Math.min(0, ...finite), Math.max(...finite), right - left, (t) => opts.x.format(t, true));
      let rowsN = 0;
      for (const g of opts.groups) rowsN += g.rows.length;
      const top = LAYOUT.top;
      const bodyH = opts.groups.length * LAYOUT.groupHeight + rowsN * rowH;
      const bottom = top + bodyH;
      const height = bottom + LAYOUT.bottom;
      const x = scaleLinear(nt.lo, nt.hi, left, right);
      const grid = s("g", { class: "grid" });
      for (const t of nt.ticks) {
        const px = Math.round(x(t)) + 0.5;
        grid.append(s("line", { x1: px, x2: px, y1: top, y2: bottom }));
        if (nt.labelled(t)) nodes.push(xTickLabel(px, bottom + LAYOUT.tickY, opts.x.format(t, true), width));
      }
      nodes.unshift(grid);
      nodes.push(s("line", { x1: left, x2: right, y1: bottom + 0.5, y2: bottom + 0.5, class: "axis-line" }));
      if (nt.lo < 0) nodes.push(s("line", { x1: x(0), x2: x(0), y1: top, y2: bottom, class: "zero" }));
      xTitle(nodes, opts.x.title, width, height);
      nodes.push(s("text", { x: width, y: LAYOUT.fontSize, "text-anchor": "end", class: "axis-title", text: opts.valueTitle || "" }));
      const targets = [];
      let cy = top;
      for (const g of opts.groups) {
        nodes.push(s("text", { x: 0, y: cy + LAYOUT.groupHeight - 10, class: "label-strong halo", text: g.label }));
        cy += LAYOUT.groupHeight;
        for (const r of g.rows) {
          const my = stacked ? cy + LAYOUT.stackedLabel + LAYOUT.rowHeight / 2 : cy + rowH / 2;
          nodes.push(s("text", { x: stacked ? 0 : 12, y: stacked ? cy + LAYOUT.fontSize + 2 : my + 4, class: `${r.emph ? "label-strong" : "label"} halo`, text: r.label }));
          if (Number.isFinite(r.lo) && Number.isFinite(r.hi)) {
            nodes.push(s("line", { x1: x(r.lo), x2: x(r.hi), y1: my, y2: my, class: "whisker s-ffa" }));
            nodes.push(s("line", { x1: x(r.lo), x2: x(r.lo), y1: my - 5, y2: my + 5, class: "whisker s-ffa" }));
            nodes.push(s("line", { x1: x(r.hi), x2: x(r.hi), y1: my - 5, y2: my + 5, class: "whisker s-ffa" }));
          }
          if (r.extra && Number.isFinite(r.extra.same)) {
            nodes.push(s("circle", { cx: x(r.extra.same), cy: my, r: 3.5, class: "dot hollow s-ink" }));
          }
          if (r.extra && Number.isFinite(r.extra.value)) {
            const ex = x(r.extra.value);
            nodes.push(s("path", { d: `M${ex},${my - 6}L${ex + 6},${my}L${ex},${my + 6}L${ex - 6},${my}Z`, class: "dot hollow s-ink" }));
          }
          if (Number.isFinite(r.est)) {
            nodes.push(s("circle", { cx: x(r.est), cy: my, r: r.emph ? 6 : 5, class: "dot f-ffa" }));
            nodes.push(s("text", { x: width, y: my + 4, "text-anchor": "end", class: r.emph ? "label-strong" : "label", text: opts.x.format(r.est) }));
            targets.push({ x: x(r.est), y: my, r: r.emph ? 6 : 5, tip: r.tip });
          }
          cy += rowH;
        }
      }
      return { height, nodes, targets, plotTop: top, plotBottom: bottom };
    },
  });
}

// -------------------------------------------------------- calendar strip

function isoWeek(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || LAYOUT.daysPerWeek;
  date.setUTCDate(date.getUTCDate() + LAYOUT.isoThursday - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date - yearStart) / LAYOUT.msPerDay + 1) / LAYOUT.daysPerWeek);
  return { year: date.getUTCFullYear(), week };
}

/**
 * calendarChart: one cell per ISO week, rows = years (columns on narrow screens).
 * opts.cells: [{ date, state: "contango" | "backwardation" | null, tip }]
 */
export function calendarChart(container, opts) {
  return frame(container, {
    ...opts,
    mode: "xy",
    render(width) {
      const nodes = [];
      const cells = opts.cells.map((c) => ({ ...c, ...isoWeek(c.date) }));
      const years = [];
      const y0 = Math.min(...cells.map((c) => c.year));
      const y1 = Math.max(...cells.map((c) => c.year));
      for (let yy = y0; yy <= y1; yy += 1) years.push(yy);
      const narrow = width < LAYOUT.narrow;
      const targets = [];
      const byKey = new Map(cells.map((c) => [`${c.year}-${c.week}`, c]));
      const cls = (c) => (c.state === "contango" ? "f-contango" : c.state === "backwardation" ? "f-backwardation" : "cell-none");
      // month start weeks (in a non-leap reference year) for labels
      const monthWeeks = [];
      for (let m = 1; m <= LAYOUT.monthsPerYear; m += 1) monthWeeks.push({ m, week: isoWeek(`${y1}-${String(m).padStart(2, "0")}-04`).week });
      if (!narrow) {
        const labelW = Math.ceil(textWidth("2026")) + LAYOUT.labelGap * 2;
        const cw = (width - labelW) / LAYOUT.weeksMax;
        const rh = LAYOUT.calendarRow;
        const top = LAYOUT.top;
        const height = top + years.length * (rh + 4) + 8;
        for (const mw of monthWeeks) {
          if (cw * 4.3 < textWidth("Mar") + 6 && (mw.m - 1) % 3 !== 0) continue;
          nodes.push(s("text", { x: labelW + (mw.week - 1) * cw, y: top - 8, text: monthAbbr(mw.m) }));
        }
        years.forEach((yy, i) => {
          const ry = top + i * (rh + 4);
          nodes.push(s("text", { x: 0, y: ry + rh / 2 + 4, class: "row-label", text: String(yy) }));
          for (let w = 1; w <= LAYOUT.weeksMax; w += 1) {
            const c = byKey.get(`${yy}-${w}`);
            const rx = labelW + (w - 1) * cw;
            const cwI = Math.max(1, cw - 1.5);
            if (!c) {
              if (w <= 52 || isoWeek(`${yy}-12-31`).week === LAYOUT.weeksMax) nodes.push(s("rect", { x: rx + 0.5, y: ry + 0.5, width: Math.max(0.5, cwI - 1), height: rh - 1, class: "cell-empty" }));
              continue;
            }
            nodes.push(s("rect", { x: rx, y: ry, width: cwI, height: rh, rx: 1, class: cls(c) }));
            targets.push({ x: rx + cwI / 2, y: ry + rh / 2, box: { x: rx, y: ry, w: cwI, h: rh }, tip: c.tip, order: c.date });
          }
        });
        targets.sort((a, b) => (a.order < b.order ? -1 : 1));
        return { height, nodes, targets };
      }
      // narrow: years are columns, weeks run down
      const labelW = Math.ceil(textWidth("Mar")) + LAYOUT.labelGap;
      const colW = (width - labelW) / years.length;
      const rh = LAYOUT.calendarRowNarrow;
      const top = LAYOUT.top;
      const height = top + LAYOUT.weeksMax * rh + 8;
      years.forEach((yy, i) => {
        nodes.push(s("text", { x: labelW + i * colW + colW / 2, y: top - 8, "text-anchor": "middle", class: "row-label", text: String(yy) }));
      });
      for (const mw of monthWeeks) {
        if ((mw.m - 1) % 3 !== 0) continue;
        nodes.push(s("text", { x: 0, y: top + (mw.week - 1) * rh + rh, text: monthAbbr(mw.m) }));
      }
      years.forEach((yy, i) => {
        const cx = labelW + i * colW + 2;
        const cwI = colW - 4;
        for (let w = 1; w <= LAYOUT.weeksMax; w += 1) {
          const c = byKey.get(`${yy}-${w}`);
          const ry = top + (w - 1) * rh;
          if (!c) {
            if (w <= 52 || isoWeek(`${yy}-12-31`).week === LAYOUT.weeksMax) nodes.push(s("rect", { x: cx + 0.5, y: ry + 0.5, width: cwI - 1, height: rh - 2, class: "cell-empty" }));
            continue;
          }
          nodes.push(s("rect", { x: cx, y: ry, width: cwI, height: rh - 1, rx: 1, class: cls(c) }));
          targets.push({ x: cx + cwI / 2, y: ry + rh / 2, box: { x: cx, y: ry, w: cwI, h: rh - 1 }, tip: c.tip, order: c.date });
        }
      });
      targets.sort((a, b) => (a.order < b.order ? -1 : 1));
      return { height, nodes, targets };
    },
  });
}

// --------------------------------------------------------- vertical bars

/**
 * barChart: categories along x; each category a stack of segments or one signed bar.
 * opts.cats: [{ key, label, sub? }]
 * opts.stacks: [{ cls, label, values: { key: number } }] (segments stack from zero, 2px gaps)
 * opts.bars: [{ key, value, cls, outline? }] (one bar per category, signed)
 * opts.y: { min, max, title, format }
 * opts.tips: { key: tip }
 */
export function barChart(container, opts) {
  return frame(container, {
    ...opts,
    mode: "xy",
    render(width) {
      const nodes = [];
      const totals = [];
      if (opts.stacks) {
        for (const c of opts.cats) totals.push(opts.stacks.reduce((a, st) => a + (st.values[c.key] || 0), 0));
      }
      const vals = opts.bars ? opts.bars.map((b) => b.value) : totals;
      const nt = niceTicks(opts.y.min ?? Math.min(0, ...vals), opts.y.max ?? Math.max(0, ...vals), width < LAYOUT.narrow ? 4 : 5);
      const maxAbs = Math.max(Math.abs(nt.lo), Math.abs(nt.hi));
      const left = tickMargin(nt.ticks, opts.y.format, maxAbs);
      const right = width - LAYOUT.right;
      const subRows = opts.cats.some((c) => c.sub) ? 14 : 0;
      const height = plotHeight(width, opts) + LAYOUT.top + LAYOUT.bottom + subRows;
      const top = LAYOUT.top;
      const bottom = height - LAYOUT.bottom - subRows;
      const y = scaleLinear(nt.lo, nt.hi, bottom, top);
      yAxis({ nodes, y, ticks: nt.ticks, left, right, fmt: opts.y.format, title: opts.y.title, maxAbs });
      const band = (right - left) / opts.cats.length;
      const bw = Math.max(4, Math.min(LAYOUT.barMax, band * 0.62));
      const targets = [];
      const labelEvery = Math.max(1, Math.ceil(Math.max(...opts.cats.map((c) => Math.max(textWidth(c.label), c.sub ? textWidth(c.sub) : 0))) / (band - 4)));
      opts.cats.forEach((c, i) => {
        const cx = left + band * i + band / 2;
        const bx = cx - bw / 2;
        if (i % labelEvery === 0) {
          nodes.push(s("text", { x: cx, y: bottom + LAYOUT.tickY, "text-anchor": "middle", class: c.muted ? "muted-text" : null, text: c.label }));
          if (c.sub) nodes.push(s("text", { x: cx, y: bottom + LAYOUT.tickY + 14, "text-anchor": "middle", class: c.muted ? "muted-text" : null, text: c.sub }));
        }
        let yTop = bottom;
        let yBot = bottom;
        if (opts.stacks) {
          let acc = 0;
          const segs = opts.stacks.map((st) => ({ st, v: st.values[c.key] || 0 })).filter((sg) => sg.v > 0);
          segs.forEach((sg, j) => {
            const y0 = y(acc);
            const y1 = y(acc + sg.v);
            const last = j === segs.length - 1;
            const gap = j > 0 ? 1 : 0;
            const mute = c.muted ? " is-muted" : "";
            if (last) nodes.push(s("path", { d: barPath(bx, y0 - gap, y1, bw, LAYOUT.barRadius), class: `bar f-${sg.st.cls}${mute}` }));
            else nodes.push(s("rect", { x: bx, y: y1 + 1, width: bw, height: Math.max(0, y0 - y1 - 1 - gap), class: `bar f-${sg.st.cls}${mute}` }));
            acc += sg.v;
          });
          yTop = y(acc);
        } else {
          const b = opts.bars.find((bb) => bb.key === c.key);
          if (b && Number.isFinite(b.value)) {
            const y0 = y(0);
            const y1 = y(b.value);
            nodes.push(s("path", { d: barPath(bx, y0, y1, bw, LAYOUT.barRadius), class: b.outline ? "outline-bar" : `bar f-${b.cls}` }));
            yTop = Math.min(y0, y1);
            yBot = Math.max(y0, y1);
            if (opts.valueLabels) {
              const above = b.value >= 0;
              nodes.push(s("text", { x: cx, y: above ? y1 - 6 : y1 + 14, "text-anchor": "middle", class: "label", text: opts.valueLabels(b) }));
            }
          }
        }
        if (nt.lo < 0 && nt.hi > 0) nodes.push(s("line", { x1: left, x2: right, y1: y(0), y2: y(0), class: "zero" }));
        const tip = opts.tips?.[c.key];
        if (tip) targets.push({ x: cx, y: yTop, box: { x: bx, y: yTop, w: bw, h: Math.max(2, yBot - yTop) }, tip });
      });
      nodes.push(s("line", { x1: left, x2: right, y1: y(Math.max(nt.lo, 0)) + 0.5, y2: y(Math.max(nt.lo, 0)) + 0.5, class: "axis-line" }));
      xTitle(nodes, opts.x?.title, width, height);
      return { height, nodes, targets };
    },
  });
}

// ------------------------------------------------------- horizontal bars

/**
 * hbarChart: signed horizontal bars around zero, in groups.
 * opts.groups: [{ label, rows: [{ label, value, cls, valueLabel, tip }] }]
 * opts.x: { title, format }, opts.sides: { neg: "label left of zero", pos: "label right of zero" }
 */
export function hbarChart(container, opts) {
  return frame(container, {
    ...opts,
    mode: "xy",
    render(width) {
      const nodes = [];
      const rowsAll = opts.groups.flatMap((g) => g.rows);
      const vals = rowsAll.map((r) => r.value).filter(Number.isFinite);
      const labelText = Math.ceil(Math.max(...rowsAll.map((r) => textWidth(r.label))));
      // long row labels on a narrow chart go above their bars, so the bars keep the width
      const stacked = labelText + LAYOUT.labelGap * 2 + 12 > width * LAYOUT.labelShare;
      const rowH = stacked ? LAYOUT.rowHeight + LAYOUT.stackedLabel : LAYOUT.rowHeight;
      const labelW = stacked ? 12 : labelText + LAYOUT.labelGap * 2;
      const valW = Math.ceil(Math.max(...rowsAll.map((r) => textWidth(r.valueLabel || "")))) + LAYOUT.labelGap;
      const left = labelW + valW;
      const right = width - valW;
      const hMax = Math.max(...vals.map(Math.abs));
      const hfmt = (t) => (opts.x.format ? opts.x.format(t, hMax) : tick(t, hMax));
      const nt = fitAxis(Math.min(0, ...vals), Math.max(0, ...vals), right - left, hfmt);
      const x = scaleLinear(nt.lo, nt.hi, left, right);
      // the two sides' names sit either side of zero; when the right one does not fit, it goes a line up
      const sidesSplit = opts.sides && x(0) + 6 + textWidth(opts.sides.pos, LAYOUT.bold) > width;
      const top = LAYOUT.top + (opts.sides ? (sidesSplit ? 32 : 16) : 0);
      const bottom = top + opts.groups.length * LAYOUT.groupHeight + rowsAll.length * rowH;
      const height = bottom + LAYOUT.bottom;
      const grid = s("g", { class: "grid" });
      for (const t of nt.ticks) {
        const px = Math.round(x(t)) + 0.5;
        grid.append(s("line", { x1: px, x2: px, y1: top, y2: bottom }));
        if (nt.labelled(t)) nodes.push(xTickLabel(px, bottom + LAYOUT.tickY, hfmt(t), width));
      }
      nodes.unshift(grid);
      nodes.push(s("line", { x1: left, x2: right, y1: bottom + 0.5, y2: bottom + 0.5, class: "axis-line" }));
      nodes.push(s("line", { x1: x(0), x2: x(0), y1: top - 4, y2: bottom, class: "zero" }));
      if (opts.sides) {
        nodes.push(s("text", { x: x(0) - 6, y: top - 10, "text-anchor": "end", class: "label-strong", text: opts.sides.neg }));
        if (sidesSplit) nodes.push(s("text", { x: width, y: top - 26, "text-anchor": "end", class: "label-strong", text: opts.sides.pos }));
        else nodes.push(s("text", { x: x(0) + 6, y: top - 10, "text-anchor": "start", class: "label-strong", text: opts.sides.pos }));
      }
      xTitle(nodes, opts.x.title, width, height);
      const targets = [];
      let cy = top;
      const bh = Math.min(LAYOUT.barMax, LAYOUT.rowHeight - 12);
      for (const g of opts.groups) {
        nodes.push(s("text", { x: 0, y: cy + LAYOUT.groupHeight - 10, class: "label-strong halo", text: g.label }));
        cy += LAYOUT.groupHeight;
        for (const r of g.rows) {
          const barTop = stacked ? cy + LAYOUT.stackedLabel : cy;
          const by = barTop + (LAYOUT.rowHeight - bh) / 2;
          const ly = stacked ? cy + LAYOUT.stackedLabel - 2 : cy + LAYOUT.rowHeight / 2 + 4;
          nodes.push(s("text", { x: 12, y: ly, class: `label halo${r.muted ? " muted-text" : ""}`, text: r.label }));
          if (Number.isFinite(r.value)) {
            const x0 = x(0);
            const x1 = x(r.value);
            nodes.push(s("path", { d: hbarPath(x0, x1, by, bh, LAYOUT.barRadius), class: `bar f-${r.cls}${r.muted ? " is-muted" : ""}` }));
            if (r.valueLabel) {
              const pos = r.value >= 0;
              nodes.push(s("text", { x: pos ? x1 + 6 : x1 - 6, y: by + bh / 2 + 4, "text-anchor": pos ? "start" : "end", class: "label halo", text: r.valueLabel }));
            }
            targets.push({ x: x1, y: by + bh / 2, box: { x: Math.min(x0, x1), y: by, w: Math.max(2, Math.abs(x1 - x0)), h: bh }, tip: r.tip });
          }
          cy += rowH;
        }
      }
      return { height, nodes, targets };
    },
  });
}

// ------------------------------------------------------------ strip plot

/**
 * stripChart: dots per category (one per observation) with the mean and its interval.
 * opts.cats: [{ key, label, points: [{ y, hollow?, tip }], mean, lo, hi, tip }]
 * opts.y: { title, format }
 */
export function stripChart(container, opts) {
  return frame(container, {
    ...opts,
    mode: "xy",
    render(width) {
      const nodes = [];
      const vals = opts.cats.flatMap((c) => [...c.points.map((p) => p.y), c.lo, c.hi, c.mean]).filter(Number.isFinite);
      const nt = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), width < LAYOUT.narrow ? 4 : 6);
      const maxAbs = Math.max(Math.abs(nt.lo), Math.abs(nt.hi));
      const left = tickMargin(nt.ticks, opts.y.format, maxAbs);
      const right = width - LAYOUT.right;
      const subRows = opts.cats.some((c) => c.sub) ? 14 : 0;
      const height = plotHeight(width, { ...opts, minHeight: 280, maxHeight: 420 }) + LAYOUT.top + LAYOUT.bottom + subRows; // literal: px, strip plot height bounds
      const top = LAYOUT.top;
      const bottom = height - LAYOUT.bottom - subRows;
      const y = scaleLinear(nt.lo, nt.hi, bottom, top);
      yAxis({ nodes, y, ticks: nt.ticks, left, right, fmt: opts.y.format, title: opts.y.title, maxAbs });
      nodes.push(s("line", { x1: left, x2: right, y1: y(0), y2: y(0), class: "zero" }));
      const band = (right - left) / opts.cats.length;
      const targets = [];
      opts.cats.forEach((c, i) => {
        const cx = left + band * i + band * 0.42;
        const fits = (t) => textWidth(t) <= band - 6;
        const label = fits(c.label) || !c.short ? c.label : c.short;
        nodes.push(s("text", { x: left + band * i + band / 2, y: bottom + LAYOUT.tickY, "text-anchor": "middle", class: "label", text: label }));
        if (c.sub) nodes.push(s("text", { x: left + band * i + band / 2, y: bottom + LAYOUT.tickY + 14, "text-anchor": "middle", text: fits(c.sub) || !c.subShort ? c.sub : c.subShort }));
        // simple dodge: points in the same 9px row step sideways
        const rows = new Map();
        const pts = c.points.filter((pp) => Number.isFinite(pp.y)).map((pp) => ({ ...pp, py: y(pp.y) })).sort((a, b) => a.py - b.py);
        const spread = Math.min(band * 0.3, 40);
        for (const pp of pts) {
          const key = Math.round(pp.py / 9);
          const k = rows.get(key) || 0;
          rows.set(key, k + 1);
          const off = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * 8;
          pp.px = cx + clamp(off, -spread, spread);
        }
        for (const pp of pts) {
          nodes.push(s("circle", { cx: pp.px, cy: pp.py, r: LAYOUT.dotR, class: pp.hollow ? "dot hollow s-ffa" : "dot f-ffa" }));
          targets.push({ x: pp.px, y: pp.py, tip: pp.tip, order: i * 1e6 + pp.py });
        }
        const mx = cx + spread + 14;
        if (Number.isFinite(c.lo) && Number.isFinite(c.hi)) {
          nodes.push(s("line", { x1: mx, x2: mx, y1: y(c.lo), y2: y(c.hi), class: "whisker s-ink" }));
          nodes.push(s("line", { x1: mx - 5, x2: mx + 5, y1: y(c.lo), y2: y(c.lo), class: "whisker s-ink" }));
          nodes.push(s("line", { x1: mx - 5, x2: mx + 5, y1: y(c.hi), y2: y(c.hi), class: "whisker s-ink" }));
        }
        if (Number.isFinite(c.mean)) {
          nodes.push(s("line", { x1: mx - 9, x2: mx + 9, y1: y(c.mean), y2: y(c.mean), class: "whisker s-ink", "stroke-width": 3 }));
          targets.push({ x: mx, y: y(c.mean), tip: c.tip, order: i * 1e6 + 9e5 });
        }
      });
      targets.sort((a, b) => a.order - b.order);
      xTitle(nodes, opts.x?.title, width, height);
      return { height, nodes, targets };
    },
  });
}

// --------------------------------------------------------------- waterfall

/**
 * waterfallChart: horizontal steps. steps: [{ label, value, cls, kind: "start" | "delta" | "total" | "part", tip }]
 * "start" and "total" run from zero; "delta" from the running sum; "part" splits a total from zero.
 */
export function waterfallChart(container, opts) {
  return frame(container, {
    ...opts,
    mode: "xy",
    render(width) {
      const nodes = [];
      let run = 0;
      let partRun = 0;
      const bars = opts.steps.map((st) => {
        let a;
        let b;
        if (st.kind === "start" || st.kind === "total") {
          a = 0;
          b = st.value;
          run = st.value;
          partRun = 0;
        } else if (st.kind === "part") {
          a = partRun;
          b = partRun + st.value;
          partRun = b;
        } else {
          a = run;
          b = run + st.value;
          run = b;
        }
        return { ...st, a, b };
      });
      const vals = bars.flatMap((b) => [b.a, b.b]).filter(Number.isFinite);
      const stacked = width < LAYOUT.narrow;
      const rowH = stacked ? LAYOUT.rowHeight + LAYOUT.stackedLabel : LAYOUT.rowHeight;
      const labelW = stacked ? 0 : Math.ceil(Math.max(...bars.map((b) => textWidth(b.label, b.kind === "total" ? LAYOUT.bold : LAYOUT.regular)))) + LAYOUT.labelGap * 2;
      const valW = Math.ceil(Math.max(...bars.map((b) => textWidth(b.valueLabel || "")))) + LAYOUT.labelGap;
      const left = labelW + valW;
      const right = width - valW;
      const wMax = Math.max(...vals.map(Math.abs));
      const wfmt = (t) => (opts.x.format ? opts.x.format(t, wMax) : tick(t, wMax));
      const nt = fitAxis(Math.min(0, ...vals), Math.max(0, ...vals), right - left, wfmt);
      const top = LAYOUT.top;
      const bottom = top + bars.length * rowH;
      const height = bottom + LAYOUT.bottom;
      const x = scaleLinear(nt.lo, nt.hi, left, right);
      const grid = s("g", { class: "grid" });
      for (const t of nt.ticks) {
        const px = Math.round(x(t)) + 0.5;
        grid.append(s("line", { x1: px, x2: px, y1: top, y2: bottom }));
        if (nt.labelled(t)) nodes.push(xTickLabel(px, bottom + LAYOUT.tickY, wfmt(t), width));
      }
      nodes.unshift(grid);
      nodes.push(s("line", { x1: left, x2: right, y1: bottom + 0.5, y2: bottom + 0.5, class: "axis-line" }));
      nodes.push(s("line", { x1: x(0), x2: x(0), y1: top - 4, y2: bottom, class: "zero" }));
      xTitle(nodes, opts.x.title, width, height);
      const bh = Math.min(LAYOUT.barMax, LAYOUT.rowHeight - 12);
      const targets = [];
      bars.forEach((b, i) => {
        const ry = top + i * rowH;
        const by = stacked ? ry + LAYOUT.stackedLabel + (LAYOUT.rowHeight - bh) / 2 : ry + (rowH - bh) / 2;
        nodes.push(s("text", { x: 0, y: stacked ? ry + LAYOUT.fontSize + 2 : ry + rowH / 2 + 4, class: `${b.kind === "total" ? "label-strong" : "label"} halo`, text: b.label }));
        const x0 = x(b.a);
        const x1 = x(b.b);
        if (b.outline) nodes.push(s("rect", { x: Math.min(x0, x1), y: by, width: Math.max(1, Math.abs(x1 - x0)), height: bh, rx: 2, class: "outline-bar" }));
        else nodes.push(s("path", { d: hbarPath(x0, x1, by, bh, LAYOUT.barRadius), class: `bar f-${b.cls}` }));
        if (i > 0) {
          const prev = bars[i - 1];
          const join = b.kind === "delta" ? x(prev.b) : null;
          if (join !== null) nodes.push(s("line", { x1: join, x2: join, y1: by - (rowH - bh) + 2, y2: by, class: "connector" }));
        }
        if (b.valueLabel) {
          const pos = b.b >= b.a;
          nodes.push(s("text", { x: pos ? Math.max(x0, x1) + 6 : Math.min(x0, x1) - 6, y: by + bh / 2 + 4, "text-anchor": pos ? "start" : "end", class: "label halo", text: b.valueLabel }));
        }
        targets.push({ x: x1, y: by + bh / 2, box: { x: Math.min(x0, x1), y: by, w: Math.max(2, Math.abs(x1 - x0)), h: bh }, tip: b.tip });
      });
      return { height, nodes, targets };
    },
  });
}
