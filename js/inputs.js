// Model inputs page: what the model starts from -- demand, existing capacity, renewable resource, build options.
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { displayName, token } from "./config.js";
import { query, table } from "./data.js";
import { fuelColor, fuelGroupSql, fuelLabel, fuelOrder, fuelScale } from "./fuels.js";
import { figure, fmt, licenseLine, list, mount, pageHead, plotStyle, zoneWhere } from "./ui.js";

const series = () => [1, 2, 3, 4, 5].map((i) => token(`--series-${i}`));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// a times.csv day ("MM-DD") as "Jan 15"
const dayLabel = (day) => `${MONTHS[+day.slice(0, 2) - 1]} ${+day.slice(3, 5)}`;
// SQL: a time's day ("MM-DD") and hour of day
const DAY = (column) => `substr(${column}, 1, 5)`;
const HOUR = (column) => `CAST(substr(${column}, 7, 2) AS INTEGER)`;

export async function renderInputs(app, d, zone) {
  app.innerHTML = `<div class="page">${pageHead(d, "inputs", zone)}<p class="loading">Loading…</p></div>`;
  const t = Object.fromEntries(await Promise.all(
    ["times", "demand_forecast", "demand_profile", "renewable_profiles", "generator_constants", "generator_costs",
      "storage_constants"].map(async (n) => [n, await table(d.name, "inputs", n)])));
  const y0 = d.years[0], yN = d.years.at(-1);
  const where = zoneWhere(zone);
  const years = `(SELECT unnest([${d.years.join(",")}]) AS year)`;
  // some models give each year its own demand profile: then the day curves use the first year's
  const profileColumns = (await query(`DESCRIBE SELECT * FROM ${t.demand_profile}`)).map((r) => r.column_name);
  const profileYear = profileColumns.includes("year") ? `AND (p.year IS NULL OR p.year = ${y0})` : "";

  const [online, stats, peaks, demandDays, cf, capex, hoursRow] = await Promise.all([
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
    query(`SELECT year, sum(value) / 1000 AS peak FROM ${t.demand_forecast} WHERE type = 'peak' AND ${where} AND year BETWEEN ${y0} AND ${yN} GROUP BY year ORDER BY year`),
    // first-year demand on each modeled day, GW: each zone's peak times its profile, summed over zones
    query(`SELECT ${DAY("p.time")} AS day, ${HOUR("p.time")} AS hour, sum(p.value * f.value) / 1000 AS gw
           FROM ${t.demand_profile} p JOIN ${t.demand_forecast} f ON f.zone = p.zone AND f.type = 'peak' AND f.year = ${y0}
           WHERE ${zoneWhere(zone, "p.zone")} ${profileYear} GROUP BY ALL ORDER BY day, hour`),
    // capacity factor on each modeled day, averaged over a tech's zones and plants
    query(`SELECT tech, ${DAY("time")} AS day, ${HOUR("time")} AS hour, avg(value) AS cf
           FROM ${t.renewable_profiles} WHERE ${where} AND tech IS NOT NULL GROUP BY ALL ORDER BY tech, day, hour`),
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
  const totalIn = (year) => inService(year).reduce((s, r) => s + r.capacity, 0);
  const total0 = totalIn(y0), totalN = totalIn(yN);
  const largest = inService(y0).sort((a, b) => b.capacity - a.capacity).slice(0, 2).map((r) => r.label.toLowerCase());
  const where_ = zone ? ` in ${zone}` : "";
  const peak0 = peaks[0]?.peak ?? 0, peakN = peaks.at(-1)?.peak ?? 0;
  const techs = [...new Set(cf.map((r) => r.tech))];
  const days = new Set(demandDays.map((r) => r.day)).size;
  const eachDay = hours < 8760 ? `each of the ${days} representative days` : "each day of the year";

  app.innerHTML = `<div class="page">${pageHead(d, "inputs", zone)}<article>
    <p class="lead">The ${displayName(d.name)} model plans the power system${d.zones.length > 1 && !zone ? ` across ${d.zones.length} zones` : where_}
      from ${y0} to ${yN}. Each year is modeled with ${hours < 8760 ? `${hours / 24} representative days (${hours} hours)` : "every hour"}.</p>

    <h2>Demand</h2>
    <p>Peak demand${where_} ${peakN >= peak0 ? "grows" : "falls"} from ${fmt.gw(peak0)} in ${y0} to ${fmt.gw(peakN)} in ${yN}.</p>
    ${figure("c-peak", "Peak demand forecast, GW.")}
    <p>Demand over ${eachDay} in ${y0}:</p>
    ${figure("c-days", `Demand by hour, GW, one line per modeled day of ${y0}.`)}

    <h2>Existing capacity</h2>
    <p>${fmt.mw(total0)} of capacity is in service${where_} in ${y0}, ${largest.length ? `mostly ${list(largest)}` : ""}, from
      ${stats[0].existing} existing and committed units. The model cannot retire these early: they leave as they reach the end
      of their lives, while committed units come online on schedule${yN > y0 ? `. In ${yN}, these units provide ${fmt.mw(totalN)}` : ""}.</p>
    ${figure("c-online", `Capacity in service in ${y0} from existing and committed units, by fuel.`)}

    <h2>Renewable resource</h2>
    ${techs.length ? `<p>Renewable output depends on the hour and the day. The capacity factor of ${list(techs)} over ${eachDay}:</p>
      ${figure("c-cf", "Capacity factor by hour, one line per modeled day, averaged over a technology's zones and plants.")}`
      : `<p>The model has no renewable profiles${where_}.</p>`}

    <h2>Build options</h2>
    ${capex.length ? `<p>The model can choose from ${stats[0].options} build options. Their capital costs in ${y0}:</p>
      ${figure("c-capex", "Overnight capital cost, $/kW, averaged over a technology's options.")}`
      : `<p>The model has no build options${where_}: it only dispatches existing units.</p>`}
    <p class="license">${licenseLine(d.license)}</p>
  </article></div>`;

  const [s1] = series();
  mount("c-peak", (width) => Plot.plot({
    width, height: 220, marginLeft: 56, style: plotStyle,
    x: { label: null, tickFormat: "d" }, y: { label: "GW", grid: true, zero: true },
    marks: [Plot.lineY(peaks, { x: "year", y: "peak", stroke: s1, strokeWidth: 2, tip: { format: { peak: fmt.gw } } }),
      Plot.dot(peaks, { x: "year", y: "peak", fill: s1, r: 2.5 })],
  }));
  // many days draw fainter, so the spread still reads
  const dayOpacity = days > 60 ? 0.12 : days > 15 ? 0.35 : 0.6;
  const hourAxis = { label: "hour of day", domain: [0, 23], ticks: [0, 6, 12, 18, 23] };
  // hovering shows the nearest point's day, hour and value
  const dayTip = (rows, y, text, options = {}) => Plot.tip(rows, Plot.pointer({ x: "hour", y, ...options,
    title: (r) => `${dayLabel(r.day)}, ${String(r.hour).padStart(2, "0")}:00\n${text(r)}` }));
  mount("c-days", (width) => Plot.plot({
    width, height: 240, marginLeft: 56, style: plotStyle, x: hourAxis, y: { label: "GW", grid: true, zero: true },
    marks: [Plot.lineY(demandDays, { x: "hour", y: "gw", z: "day", stroke: s1, strokeWidth: 1.2, strokeOpacity: dayOpacity, curve: "monotone-x" }),
      dayTip(demandDays, "gw", (r) => fmt.gw(r.gw))],
  }));
  mount("c-online", (width) => capacityPie(inService(y0), width));
  if (techs.length) mount("c-cf", (width) => Plot.plot({
    width, height: 40 + 150 * techs.length, marginLeft: 56, marginRight: 110, style: plotStyle, x: hourAxis,
    y: { label: null, grid: true, domain: [0, 1], tickFormat: "%" },
    fy: { label: null, domain: techs, padding: 0.2 }, color: { domain: techs, range: series() },
    marks: [Plot.lineY(cf, { x: "hour", y: "cf", z: "day", fy: "tech", stroke: "tech", strokeWidth: 1.2, strokeOpacity: dayOpacity, curve: "monotone-x" }),
      dayTip(cf, "cf", (r) => `${r.tech}: ${Math.round(100 * r.cf)}%`, { fy: "tech" })],
  }));
  if (capex.length) mount("c-capex", (width) => Plot.plot({
    width, height: 30 + 24 * capex.length, marginLeft: 130, style: plotStyle,
    x: { label: "$/kW", grid: true }, y: { label: null, domain: capex.map((r) => r.tech) }, color,
    marks: [Plot.barX(capex, { y: "tech", x: "capex", fill: "label", insetTop: 3, insetBottom: 3,
      tip: { format: { capex: (v) => `$${Math.round(v)}/kW` } } }), Plot.ruleX([0])],
  }));
}

// A pie of capacity by fuel, with a legend giving each fuel's capacity and share.
function capacityPie(rows, width) {
  rows = rows.filter((r) => r.capacity > 0).sort((a, b) => fuelOrder(a.fuel) - fuelOrder(b.fuel));
  const total = rows.reduce((s, r) => s + r.capacity, 0);
  const size = Math.min(240, width);
  const arc = d3.arc().innerRadius(0).outerRadius(size / 2 - 2);
  const wrap = document.createElement("div");
  wrap.className = "pie";
  const svg = d3.select(wrap).append("svg").attr("viewBox", `${-size / 2} ${-size / 2} ${size} ${size}`)
    .attr("width", size).attr("height", size);
  svg.selectAll("path").data(d3.pie().sort(null).value((r) => r.capacity)(rows)).join("path")
    .attr("d", arc).attr("fill", (a) => fuelColor(a.data.fuel)).attr("stroke", token("--bg")).attr("stroke-width", 2)
    .append("title").text((a) => `${a.data.label}: ${fmt.mw(a.data.capacity)} (${fmt.pct(a.data.capacity / total)})`);
  d3.select(wrap).append("table").selectAll("tr").data(rows).join("tr").html((r) =>
    `<td><span class="swatch" style="background:${fuelColor(r.fuel)}"></span>${r.label}</td>` +
    `<td class="num">${fmt.mw(r.capacity)}</td><td class="num">${fmt.pct(r.capacity / total)}</td>`);
  return wrap;
}
