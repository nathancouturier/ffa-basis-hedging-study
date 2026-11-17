// dom.js: small DOM helpers and the shared view furniture (takeaway, panels, disclosures, tables).
//
// Text from the artifacts always goes in through textContent, never innerHTML.

let uid = 0;
export function nextId(prefix = "id") {
  uid += 1;
  return `${prefix}-${uid}`;
}

/** h("p", { class: "x" }, "text", child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function link(href, text, attrs = {}) {
  return h("a", { href, ...attrs }, text);
}

/** A paragraph from parts: strings and nodes. */
export function p(attrs, ...parts) {
  return h("p", attrs, ...parts);
}

export function note(...parts) {
  return h("p", { class: "note" }, ...parts);
}

/** The view's opening sentence (h1), with the view's name for screen readers. */
export function takeaway(viewName, sentence) {
  const el = h("h1", { class: "takeaway", tabindex: "-1" });
  el.append(h("span", { class: "vh" }, `${viewName}: `), document.createTextNode(sentence));
  return el;
}

export function setTakeaway(el, viewName, sentence) {
  clear(el);
  el.append(h("span", { class: "vh" }, `${viewName}: `), document.createTextNode(sentence));
}

// a header longer than `wrap` characters gets a minimum width of its length over `per` (in ch), at most
// `maxCh`: with whole words to a line that wraps it to about three lines
const HEAD = Object.freeze({ wrap: 12, per: 2.4, maxCh: 16 });

/**
 * A box that scrolls sideways fades on the side that has more to show (classes more-left, more-right),
 * so a table wider than a phone says so before anyone tries to scroll it.
 */
export function scrollCue(el) {
  const sync = () => {
    const more = el.scrollWidth - el.clientWidth;
    el.classList.toggle("more-left", more > 2 && el.scrollLeft > 2);
    el.classList.toggle("more-right", more > 2 && el.scrollLeft < more - 2);
  };
  el.addEventListener("scroll", sync, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
  }
  return sync;
}

/**
 * Table: columns [{ key, label, num?, format?(row) -> string|Node }], rows [...].
 * Wrapped in a focusable region that scrolls sideways inside its own box.
 */
export function table({ caption, columns, rows, note: tableNote, label, rowAttrs, limit, wrap: wrapText = false }) {
  // a long header over a narrow column would stack word by word: give it room for whole words
  const headStyle = (c) => (typeof c.label === "string" && c.label.length > HEAD.wrap ? `min-width: ${Math.min(HEAD.maxCh, Math.ceil(c.label.length / HEAD.per))}ch` : null);
  const thead = h("thead", {}, h("tr", {}, columns.map((c) => h("th", { scope: "col", class: c.num ? "num" : null, style: headStyle(c) }, c.label))));
  const tbody = h("tbody");
  const cut = limit && rows.length > limit + 2 ? limit : null;
  const extra = [];
  rows.forEach((row, ri) => {
    const tr = h("tr", rowAttrs ? rowAttrs(row) : {});
    if (cut && ri >= cut) {
      tr.hidden = true;
      extra.push(tr);
    }
    columns.forEach((c, i) => {
      const value = c.format ? c.format(row) : row[c.key];
      const cell = h(i === 0 && c.rowHeader ? "th" : "td", { class: c.num ? "num" : null, scope: i === 0 && c.rowHeader ? "row" : null });
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value === null || value === undefined ? "" : String(value);
      tr.append(cell);
    });
    tbody.append(tr);
  });
  const tableEl = h("table", { class: wrapText ? null : "is-compact" }, caption ? h("caption", { class: "vh" }, caption) : null, thead, tbody);
  const wrap = h("div", { class: "table-wrap", role: "region", tabindex: "0", "aria-label": label || caption || "Table" }, tableEl);
  scrollCue(wrap);
  const out = h("div", { class: "table-block" });
  if (caption) out.append(h("p", { class: "table-caption", "aria-hidden": "true" }, caption));
  out.append(wrap);
  if (cut) {
    const tid = nextId("rows");
    tbody.id = tid;
    const more = h("button", { type: "button", class: "btn more-rows", "aria-expanded": "false", "aria-controls": tid }, `Show all ${rows.length} rows`);
    more.addEventListener("click", () => {
      const open = more.getAttribute("aria-expanded") !== "true";
      for (const tr of extra) tr.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      more.textContent = open ? `Show the first ${cut} rows` : `Show all ${rows.length} rows`;
    });
    out.append(h("div", { class: "table-more" }, more));
  }
  if (tableNote) out.append(h("p", { class: "table-note" }, tableNote));
  return out;
}

/**
 * Disclosure sections behind native buttons (Method, Assumptions, Data, ...).
 * sections: [{ id, label, render(body) }]; bodies render on first open.
 * open: Set of open ids; onChange(openIds) keeps the hash in step.
 */
export function disclosures({ viewId, sections, open, onChange, label = "More on this view" }) {
  const root = h("div", { class: "disclosures" });
  const row = h("div", { class: "button-row", role: "group", "aria-label": label });
  root.append(row);
  const state = new Set(open || []);
  const entries = sections.map((s) => {
    const bodyId = `${viewId}-${s.id}`;
    const btn = h("button", { type: "button", class: "btn", "aria-expanded": "false", "aria-controls": bodyId, dataset: { section: s.id } },
      h("span", {}, s.label), h("span", { class: "chev", "aria-hidden": "true" }));
    const body = h("div", { class: "disclosure-body", id: bodyId, hidden: true, inert: true });
    row.append(btn);
    root.append(body);
    const entry = { ...s, btn, body, rendered: false };
    btn.addEventListener("click", () => {
      if (state.has(s.id)) state.delete(s.id);
      else state.add(s.id);
      sync();
      onChange?.(sections.map((x) => x.id).filter((id) => state.has(id)));
      if (state.has(s.id)) body.querySelector("h2")?.setAttribute("tabindex", "-1");
    });
    return entry;
  });
  function sync() {
    for (const e of entries) {
      const isOpen = state.has(e.id);
      e.btn.setAttribute("aria-expanded", String(isOpen));
      if (isOpen && !e.rendered) {
        e.body.append(h("h2", {}, e.label));
        e.render(e.body);
        e.rendered = true;
      }
      e.body.hidden = !isOpen;
      if (isOpen) e.body.removeAttribute("inert");
      else e.body.setAttribute("inert", "");
    }
  }
  sync();
  return {
    el: root,
    setOpen(ids) {
      state.clear();
      for (const id of ids) if (entries.some((e) => e.id === id)) state.add(id);
      sync();
    },
    ids: () => sections.map((x) => x.id).filter((id) => state.has(id)),
  };
}

/**
 * Panels: secondary charts in a view, one at a time, chosen by buttons (aria-pressed).
 * panels: [{ id, label, render(body) }]
 */
export function panelSwitch({ viewId, panels, active, onChange, label = "Other charts in this view" }) {
  const root = h("div", { class: "panels" });
  const lab = h("p", { class: "panels-label", id: `${viewId}-panels-label` }, label);
  const row = h("div", { class: "button-row", role: "group", "aria-labelledby": `${viewId}-panels-label` });
  root.append(lab, row);
  let current = panels.some((x) => x.id === active) ? active : panels[0].id;
  const entries = panels.map((pn) => {
    const btn = h("button", { type: "button", class: "btn", "aria-pressed": "false", "aria-controls": `${viewId}-panel-${pn.id}`, dataset: { panel: pn.id } }, pn.label);
    const body = h("div", { class: "panel-body", id: `${viewId}-panel-${pn.id}`, hidden: true });
    row.append(btn);
    root.append(body);
    const e = { ...pn, btn, body, rendered: false };
    btn.addEventListener("click", () => {
      if (current === pn.id) return;
      current = pn.id;
      sync();
      onChange?.(current);
    });
    return e;
  });
  function sync() {
    for (const e of entries) {
      const on = e.id === current;
      e.btn.setAttribute("aria-pressed", String(on));
      if (on && !e.rendered) {
        e.render(e.body);
        e.rendered = true;
      }
      e.body.hidden = !on;
    }
  }
  sync();
  return {
    el: root,
    set(id) {
      if (panels.some((x) => x.id === id) && id !== current) {
        current = id;
        sync();
      }
    },
    current: () => current,
  };
}

/** Radio group styled as a segmented control. options: [{ value, label }] */
export function segmented({ legend, name, options, value, onChange, hideLegend = false }) {
  const fs = h("fieldset", { class: "seg" });
  fs.append(h("legend", { class: hideLegend ? "vh" : null }, legend));
  const wrap = h("div", { class: "seg-options" });
  for (const o of options) {
    const input = h("input", { type: "radio", name, value: o.value });
    if (o.value === value) input.checked = true;
    input.addEventListener("change", () => {
      if (input.checked) onChange(o.value);
    });
    wrap.append(h("label", {}, input, h("span", {}, o.label)));
  }
  fs.append(wrap);
  return {
    el: fs,
    set(v) {
      for (const input of fs.querySelectorAll("input")) input.checked = input.value === v;
    },
  };
}

/** Definition list from [{ term, desc }] where desc may be a node or string. */
export function defs(items) {
  const dl = h("dl", { class: "defs" });
  for (const it of items) {
    const dd = h("dd");
    append(dd, [it.desc]);
    dl.append(h("div", { class: "def" }, h("dt", {}, it.term), dd));
  }
  return dl;
}

export function errorNote(text) {
  return h("p", { class: "view-error" }, text);
}
