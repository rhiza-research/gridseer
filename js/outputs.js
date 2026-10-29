// Model outputs page: what the model builds and how it runs the system, by fuel.
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/+esm";
import { displayName, token } from "./config.js";
import { query, table } from "./data.js";
import { fuelGroupSql, fuelLabel, fuelOrder, fuelScale } from "./fuels.js";
import { figure, fmt, licenseLine, list, mount, note, pageHead, plotStyle, withLegend, zoneWhere } from "./ui.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (datetime) => `${MONTHS[+datetime.slice(5, 7) - 1]} ${+datetime.slice(8, 10)}`;

export async function renderOutputs(app, d, zone, year) {
  app.innerHTML = `<div class="page">${pageHead(d, "outputs", zone)}<p class="loading">Loading…</p></div>`;
  const [summary, capacity, dispatch, demand] = await Promise.all([
    table(d.name, "outputs", "summary"), table(d.name, "derived", "capacity_by_fuel"),
    table(d.name, "derived", "dispatch_by_fuel"), table(d.name, "derived", "demand"),
  ]);
  year = d.years.includes(year) ? year : d.years[0];
  const where = zoneWhere(zone);
  const group = fuelGroupSql("fuel");

  const [metrics, cap, energy, hourly, load] = await Promise.all([
    query(`SELECT metric, value FROM ${summary}`),
    query(`SELECT year, ${group} AS fuel, sum(capacity) AS capacity, sum(built) AS built FROM ${capacity}
           WHERE ${where} GROUP BY ALL ORDER BY year`),
    // annual generation: each modeled hour counts for the real hours it stands for
    query(`SELECT f.year, ${fuelGroupSql("f.fuel")} AS fuel, sum(f.dispatch * w.weight) AS mwh
           FROM ${dispatch} f JOIN ${demand} w USING (zone, year, hour) WHERE ${zoneWhere(zone, "f.zone")} GROUP BY ALL`),
    query(`SELECT hour, ${group} AS fuel, sum(dispatch) AS dispatch FROM ${dispatch}
           WHERE ${where} AND year = ${year} GROUP BY ALL ORDER BY hour`),
    query(`SELECT hour, min(datetime) AS datetime, sum(demand) AS demand, sum(lost_load) AS lost_load
           FROM ${demand} WHERE ${where} AND year = ${year} GROUP BY hour ORDER BY hour`),
  ]);
  for (const rows of [cap, energy, hourly]) rows.forEach((r) => (r.label = fuelLabel(r.fuel)));
  const m = Object.fromEntries(metrics.map((r) => [r.metric, r.value]));
  const color = fuelScale(new Set([...cap, ...energy, ...hourly].map((r) => r.fuel)));
  const y0 = d.years[0], yN = d.years.at(-1);
  const where_ = zone ? ` in ${zone}` : "";

  const builtByFuel = sumBy(cap.filter((r) => r.built > 0.5), (r) => r.label, (r) => r.built);
  const built = [...builtByFuel.values()].reduce((s, v) => s + v, 0);
  const topBuilt = [...builtByFuel].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k.toLowerCase());
  const genN = sumBy(energy.filter((r) => r.year === yN && r.mwh > 0), (r) => r.label, (r) => r.mwh);
  const genTotal = [...genN.values()].reduce((s, v) => s + v, 0);
  const topGen = [...genN].sort((a, b) => b[1] - a[1])[0];
  const lostShare = (m.lost_load ?? 0) / (m.demand || 1);

  app.innerHTML = `<div class="page">${pageHead(d, "outputs", zone)}<article>
    <p class="lead">Planning ${displayName(d.name)}'s system from ${y0} to ${yN} costs ${fmt.usd(m.objective ?? 0)}, discounted to ${y0}.
      The model serves ${fmt.energy((m.demand ?? 0) - (m.lost_load ?? 0))} of demand over the period${lostShare > 0.0001
        ? ` and leaves ${fmt.pct(lostShare)} unserved` : ", with almost none unserved"}.${zone ? " These totals cover all zones." : ""}</p>

    <h2>Capacity</h2>
    <p>${built > 0.5 ? `The model builds ${fmt.mw(built)} of new capacity${where_}, mostly ${list(topBuilt)}.`
      : `The model builds no new capacity${where_}.`} Installed capacity each year, including what it builds:</p>
    ${figure("c-cap", "Installed capacity, MW (storage: power rating).")}
    ${built > 0.5 ? `<p>What it adds each year:</p>${figure("c-built", "Capacity built each year, MW.")}` : ""}

    <h2>Generation</h2>
    <p>${topGen ? `By ${yN}, ${topGen[0].toLowerCase()} supplies ${fmt.pct(topGen[1] / genTotal)} of generation${where_}.` : ""}</p>
    ${figure("c-energy", "Annual generation, TWh. Storage is net: charging shows below zero.")}

    <h2>Dispatch</h2>
    <p>How the model runs the system hour by hour in
      <select id="year" class="inline-select">${d.years.map((y) => `<option ${y === year ? "selected" : ""}>${y}</option>`).join("")}</select>.
      ${load.length < 8760 ? `The ${load.length / 24} representative days are placed end to end.` : ""} The line is demand.</p>
    ${figure("c-dispatch", "Dispatch by fuel, MW.")}
    <p class="license">${licenseLine(d.license)}</p>
  </article></div>`;

  const yearAxis = { label: null, type: "band", tickFormat: (y) => (y % 5 === 0 ? String(y) : "") };
  const stackedBars = (rows, y, width, label, format) => withLegend(rows, Plot.plot({
    width, height: 260, marginLeft: 56, style: plotStyle, x: yearAxis, y: { label, grid: true }, color,
    marks: [Plot.barY(rows, { x: "year", y, fill: "label", order: (r) => fuelOrder(r.fuel), inset: 1, tip: { format: { [y]: format } } }),
      Plot.ruleY([0])],
  }));
  mount("c-cap", (width) => stackedBars(cap, "capacity", width, "MW", fmt.mw));
  if (built > 0.5) mount("c-built", (width) => stackedBars(cap.filter((r) => r.built > 0.5), "built", width, "MW", fmt.mw));
  mount("c-energy", (width) => stackedBars(energy.map((r) => ({ ...r, twh: r.mwh / 1e6 })), "twh", width, "TWh", (v) => `${v.toFixed(2)} TWh`));

  // dispatch: one stacked area over the year's modeled hours; ticks at the start of each day (or month)
  const byHour = new Map(load.map((r) => [r.hour, r]));
  const breakdown = new Map();
  for (const r of hourly) {
    if (!breakdown.has(r.hour)) breakdown.set(r.hour, []);
    if (Math.abs(r.dispatch) > 0.05) breakdown.get(r.hour).push(`${r.label}: ${fmt.mw(r.dispatch)}`);
  }
  const step = load.length > 2000 ? 24 * 30 : load.length > 24 * 14 ? 24 * 3 : 24;
  const ticks = load.filter((r) => (r.hour - 1) % step === 0).map((r) => r.hour);
  const ink = token("--ink");
  if (!hourly.length) return mount("c-dispatch", () => note("No dispatch in this zone."));
  mount("c-dispatch", (width) => withLegend(hourly, Plot.plot({
    width, height: 320, marginLeft: 56, style: plotStyle,
    x: { label: null, ticks, tickFormat: (h) => dayLabel(byHour.get(h)?.datetime ?? "") },
    y: { label: "MW", grid: true }, color,
    marks: [
      Plot.areaY(hourly, { x: "hour", y: "dispatch", fill: "label", order: (r) => fuelOrder(r.fuel), curve: "step" }),
      Plot.lineY(load, { x: "hour", y: "demand", stroke: ink, strokeWidth: 1.5, curve: "step" }),
      Plot.ruleY([0]),
      Plot.ruleX(load, Plot.pointerX({ x: "hour", stroke: ink, strokeOpacity: 0.35 })),
      Plot.tip(load, Plot.pointerX({
        x: "hour", y: "demand",
        title: (r) => [r.datetime.slice(0, 16), `Demand: ${fmt.mw(r.demand)}`,
          ...(r.lost_load > 0.05 ? [`Lost load: ${fmt.mw(r.lost_load)}`] : []), ...(breakdown.get(r.hour) ?? [])].join("\n"),
      })),
    ],
  })));
}

// Map of key -> summed value
function sumBy(rows, key, value) {
  const out = new Map();
  for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + value(r));
  return out;
}
