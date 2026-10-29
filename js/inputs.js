// Model inputs page: what the model starts from -- demand, existing capacity, renewable resource, build options.
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/+esm";
import { displayName, token } from "./config.js";
import { query, table } from "./data.js";
import { fuelGroupSql, fuelLabel, fuelOrder, fuelScale } from "./fuels.js";
import { figure, fmt, licenseLine, list, mount, pageHead, plotStyle, withLegend, zoneWhere } from "./ui.js";

const series = () => [1, 2, 3, 4, 5].map((i) => token(`--series-${i}`));

export async function renderInputs(app, d, zone) {
  app.innerHTML = `<div class="page">${pageHead(d, "inputs", zone)}<p class="loading">Loading…</p></div>`;
  const t = Object.fromEntries(await Promise.all(
    ["times", "demand_forecast", "demand_profile", "renewable_profiles", "generator_constants", "generator_costs",
      "storage_constants"].map(async (n) => [n, await table(d.name, "inputs", n)])));
  const y0 = d.years[0], yN = d.years.at(-1);
  const where = zoneWhere(zone);
  const years = `(SELECT unnest([${d.years.join(",")}]) AS year)`;

  const [online, stats, peaks, profile, cf, capex, hoursRow] = await Promise.all([
    // non-expandable capacity in service each year (existing and committed units), by fuel group
    query(`SELECT y.year, ${fuelGroupSql("g.fuel")} AS fuel, sum(g.capacity) AS capacity
           FROM ${t.generator_constants} g, ${years} y
           WHERE NOT g.expandable AND ${where} AND g.start_year <= y.year AND y.year < g.start_year + g.life
           GROUP BY ALL
           UNION ALL
           SELECT y.year, 'storage', sum(s.capacity_mw) FROM ${t.storage_constants} s, ${years} y
           WHERE NOT s.expandable AND ${where} AND s.capacity_mw > 0 AND s.start_year <= y.year AND y.year < s.start_year + s.life
           GROUP BY ALL`),
    query(`SELECT count(*) FILTER (WHERE NOT expandable) AS existing, count(*) FILTER (WHERE expandable) AS options
           FROM ${t.generator_constants} WHERE ${where}`),
    query(`SELECT year, sum(value) AS peak FROM ${t.demand_forecast} WHERE type = 'peak' AND ${where} AND year BETWEEN ${y0} AND ${yN} GROUP BY year ORDER BY year`),
    // demand as a share of peak by hour of day: zones weighted by their first-year peak, times by their weight
    query(`SELECT CAST(substr(p.time, 7, 2) AS INTEGER) AS hour, sum(p.value * f.value * t.weight) / sum(f.value * t.weight) AS share
           FROM ${t.demand_profile} p JOIN ${t.times} t USING (time)
           JOIN ${t.demand_forecast} f ON f.zone = p.zone AND f.type = 'peak' AND f.year = ${y0}
           WHERE ${zoneWhere(zone, "p.zone")} GROUP BY hour ORDER BY hour`),
    query(`SELECT r.tech, CAST(substr(r.time, 7, 2) AS INTEGER) AS hour, sum(r.value * t.weight) / sum(t.weight) AS cf
           FROM ${t.renewable_profiles} r JOIN ${t.times} t USING (time)
           WHERE ${zoneWhere(zone, "r.zone")} AND r.tech IS NOT NULL GROUP BY ALL ORDER BY tech, hour`),
    // capital cost of each build option in the first year, $/kW, averaged over a tech's options
    query(`SELECT g.tech, ${fuelGroupSql("g.fuel")} AS fuel, avg(c."${y0}") / 1000 AS capex, count(*) AS n
           FROM ${t.generator_constants} g JOIN ${t.generator_costs} c USING (generator)
           WHERE g.expandable AND c.cost_type = 'capital' AND ${zoneWhere(zone, "g.zone")}
           GROUP BY ALL ORDER BY capex DESC`),
    query(`SELECT count(*) AS n FROM ${t.times}`),
  ]);
  online.forEach((r) => (r.label = fuelLabel(r.fuel)));
  capex.forEach((r) => (r.label = fuelLabel(r.fuel)));
  const color = fuelScale(new Set([...online, ...capex].map((r) => r.fuel)));
  const hours = hoursRow[0].n;
  const inService = (year) => online.filter((r) => r.year === year);
  const total0 = inService(y0).reduce((s, r) => s + r.capacity, 0);
  const largest = inService(y0).sort((a, b) => b.capacity - a.capacity).slice(0, 2).map((r) => r.label.toLowerCase());
  const where_ = zone ? ` in ${zone}` : "";
  const peak0 = peaks[0]?.peak ?? 0, peakN = peaks.at(-1)?.peak ?? 0;
  const techs = [...new Set(cf.map((r) => r.tech))];

  app.innerHTML = `<div class="page">${pageHead(d, "inputs", zone)}<article>
    <p class="lead">The ${displayName(d.name)} model plans the power system${d.zones.length > 1 && !zone ? ` across ${d.zones.length} zones` : where_}
      from ${y0} to ${yN}. Each year is modeled with ${hours < 8760 ? `${hours / 24} representative days (${hours} hours)` : "every hour"}.</p>

    <h2>Demand</h2>
    <p>Peak demand${where_} ${peakN >= peak0 ? "grows" : "falls"} from ${fmt.mw(peak0)} in ${y0} to ${fmt.mw(peakN)} in ${yN}.</p>
    ${figure("c-peak", "Peak demand forecast, MW.")}
    <p>Over a day, demand follows this shape, as a share of the year's peak:</p>
    ${figure("c-profile", "Average demand by hour of day, as a share of peak.")}

    <h2>Existing capacity</h2>
    <p>${fmt.mw(total0)} of capacity is in service${where_} in ${y0}, ${largest.length ? `mostly ${list(largest)}` : ""}, from
      ${stats[0].existing} existing and committed units. The model cannot retire these early; they leave as they reach the end of their lives.</p>
    ${figure("c-online", "Capacity in service each year from existing and committed units, MW.")}

    <h2>Renewable resource</h2>
    ${techs.length ? `<p>Renewable output depends on the hour. On average across the modeled days, ${list(techs)} produce:</p>
      ${figure("c-cf", "Average capacity factor by hour of day.")}` : `<p>The model has no renewable profiles${where_}.</p>`}

    <h2>Build options</h2>
    ${capex.length ? `<p>The model can choose from ${stats[0].options} build options. Their capital costs in ${y0}:</p>
      ${figure("c-capex", "Overnight capital cost, $/kW, averaged over a technology's options.")}`
      : `<p>The model has no build options${where_}: it only dispatches existing units.</p>`}
    <p class="license">${licenseLine(d.license)}</p>
  </article></div>`;

  const [s1] = series();
  const yearAxis = { label: null, type: "band", tickFormat: (y) => (y % 5 === 0 ? String(y) : "") };
  mount("c-peak", (width) => Plot.plot({
    width, height: 220, marginLeft: 56, style: plotStyle,
    x: { label: null, tickFormat: "d" }, y: { label: "MW", grid: true, zero: true },
    marks: [Plot.lineY(peaks, { x: "year", y: "peak", stroke: s1, strokeWidth: 2, tip: true }),
      Plot.dot(peaks, { x: "year", y: "peak", fill: s1, r: 2.5 })],
  }));
  mount("c-profile", (width) => Plot.plot({
    width, height: 200, marginLeft: 56, style: plotStyle,
    x: { label: "hour of day", domain: [0, 23] }, y: { label: null, grid: true, domain: [0, 1], tickFormat: "%" },
    marks: [Plot.lineY(profile, { x: "hour", y: "share", stroke: s1, strokeWidth: 2, curve: "monotone-x", tip: { format: { share: ".0%" } } })],
  }));
  mount("c-online", (width) => withLegend(online, Plot.plot({
    width, height: 280, marginLeft: 56, style: plotStyle, x: yearAxis, y: { label: "MW", grid: true }, color,
    marks: [Plot.barY(online, { x: "year", y: "capacity", fill: "label", order: (r) => fuelOrder(r.fuel), inset: 1,
      tip: { format: { capacity: (v) => fmt.mw(v) } } }), Plot.ruleY([0])],
  })));
  if (techs.length) mount("c-cf", (width) => Plot.plot({
    width, height: 220, marginLeft: 56, style: plotStyle,
    x: { label: "hour of day", domain: [0, 23] }, y: { label: null, grid: true, domain: [0, 1], tickFormat: "%" },
    color: { domain: techs, range: series(), legend: true },
    marks: [Plot.lineY(cf, { x: "hour", y: "cf", stroke: "tech", strokeWidth: 2, curve: "monotone-x", tip: { format: { cf: ".0%" } } })],
  }));
  if (capex.length) mount("c-capex", (width) => Plot.plot({
    width, height: 30 + 24 * capex.length, marginLeft: 130, style: plotStyle,
    x: { label: "$/kW", grid: true }, y: { label: null, domain: capex.map((r) => r.tech) }, color,
    marks: [Plot.barX(capex, { y: "tech", x: "capex", fill: "label", insetTop: 3, insetBottom: 3,
      tip: { format: { capex: (v) => `$${Math.round(v)}/kW` } } }), Plot.ruleX([0])],
  }));
}

