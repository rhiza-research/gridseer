// Shared page pieces: title, tabs and selectors, figures, fuel legend, number formats.
import { DEFAULT_SOURCE, SITE_NAME, SOURCES, displayName } from "./config.js";
import { FUELS, fuelColor } from "./fuels.js";

export function licenseLine(l) {
  return `Derived from <a href="${l.source_url}">${l.source_title}</a> (${l.organization}), ` +
    `<a href="${l.license_url ?? "#"}">${l.license_id}</a>. Shared under the same license.`;
}

// a model whose baseline didn't solve has inputs only
export const hasOutputs = (d) => Boolean(d.tables.outputs);

// the model's title, the inputs/outputs tabs, and the source and zone selectors
export function pageHead(d, view, zone) {
  const name = encodeURIComponent(d.name);
  const source = d.source ?? DEFAULT_SOURCE;
  const zones = d.zones.length < 2 ? "" : `<label>Zone <select id="zone">
      <option value="">All zones</option>
      ${d.zones.map((z) => `<option ${z === zone ? "selected" : ""}>${z}</option>`).join("")}
    </select></label>`;
  return `
    <p class="site-name">${SITE_NAME}</p>
    <h1>${displayName(d.name)}</h1>
    <div class="controls">
      <nav class="tabs">
        <a class="${view === "inputs" ? "active" : ""}" href="#/${name}/inputs">Model inputs</a>
        ${hasOutputs(d) ? `<a class="${view === "outputs" ? "active" : ""}" href="#/${name}/outputs">Model outputs</a>` : ""}
      </nav>
      <div class="selectors">
        <label>Source <select id="source">${Object.entries(SOURCES).map(([k, v]) =>
          `<option value="${k}" ${k === source ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        ${zones}
      </div>
    </div>`;
}

// A list of the page's sections beside it: clicking one scrolls there, and the one being read is highlighted.
export function sectionNav(page) {
  const headings = [...page.querySelectorAll("article h2")];
  if (headings.length < 2) return;
  const nav = document.createElement("nav");
  nav.className = "toc";
  nav.setAttribute("aria-label", "Sections");
  nav.innerHTML = headings.map((h, i) => `<button type="button" data-i="${i}">${h.textContent}</button>`).join("");
  page.classList.add("has-toc");
  page.append(nav);
  const buttons = [...nav.children];
  const mark = (i) => buttons.forEach((b, j) => b.classList.toggle("active", i === j));
  let clickedAt = 0;
  nav.addEventListener("click", (e) => {
    const i = e.target.dataset?.i;
    if (i === undefined) return;
    mark(+i);
    clickedAt = Date.now();
    headings[i].scrollIntoView({ behavior: "smooth", block: "start" });
  });
  // the section being read: the last heading above the top third of the window
  const update = () => {
    if (!nav.isConnected) return removeEventListener("scroll", update);
    if (Date.now() - clickedAt < 800) return;  // let a click's smooth scroll finish
    const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    const i = atBottom ? headings.length - 1 : headings.findLastIndex((h) => h.getBoundingClientRect().top < innerHeight / 3);
    mark(Math.max(i, 0));
  };
  addEventListener("scroll", update, { passive: true });
  update();
}

export const figure = (id, caption = "") => `<figure><div id="${id}"></div>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;

export function fuelLegend(present) {
  return `<div class="fuel-legend">${FUELS.filter((f) => present.has(f.key)).map((f) =>
    `<span><span class="swatch" style="background:${fuelColor(f.key)}"></span>${f.label}</span>`).join("")}</div>`;
}

// put a Plot figure into a figure slot, sized to it
export function mount(id, make) {
  const el = document.getElementById(id);
  el.replaceChildren(make(el.clientWidth || 720));
}

// a chart with a fuel legend above it
export function withLegend(rows, fig) {
  const wrap = document.createElement("div");
  wrap.innerHTML = fuelLegend(new Set(rows.map((r) => r.fuel)));
  wrap.append(fig);
  return wrap;
}

export const note = (text) => Object.assign(document.createElement("p"), { className: "muted", textContent: text });

// Plot defaults shared by every chart
export const plotStyle = { fontFamily: "var(--font-body)", fontSize: "12px", background: "transparent", overflow: "visible" };

export const fmt = {
  gw: (v) => `${v.toFixed(v < 10 ? 2 : 1)} GW`,
  mw: (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)} GW` : `${Math.round(v)} MW`),
  energy: (mwh) => (mwh >= 1e6 ? `${(mwh / 1e6).toFixed(1)} TWh` : `${(mwh / 1e3).toFixed(0)} GWh`),
  usd: (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)} billion` : `$${(v / 1e6).toFixed(0)} million`),
  pct: (v) => `${(100 * v).toFixed(v < 0.01 ? 2 : 1)}%`,
};

// "a, b and c"
export const list = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

// SQL filter on zone (empty: all zones)
export const zoneWhere = (zone, column = "zone") => (zone ? `${column} = '${zone.replace(/'/g, "''")}'` : "TRUE");
