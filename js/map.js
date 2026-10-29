// Home page: a title, a line of text, and a large map. Hovering a country highlights its whole model;
// clicking opens that model.
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { displayName } from "./config.js";
import { manifest } from "./data.js";

const WORLD = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";

// ISO3 -> ISO 3166-1 numeric, the ids world-atlas uses
const NUMERIC = {
  BIH: "070", BWA: "072", BFA: "854", TCD: "148", DJI: "262", EGY: "818", GMB: "270", GEO: "268", IRQ: "368",
  LAO: "418", LBR: "430", MDV: "462", MAR: "504", NAM: "516", NGA: "566", POL: "616", RWA: "646", SEN: "686",
  SLE: "694", SDN: "729", BEN: "204", GHA: "288", GIN: "324", GNB: "624", CIV: "384", MLI: "466", MRT: "478",
  NER: "562", TGO: "768", STP: "678",
};

let worldPromise;
const world = () => (worldPromise ??= fetch(WORLD).then((r) => r.json()));

export async function renderMap(app) {
  const [m, topo] = await Promise.all([manifest(), world()]);
  const models = Object.values(m.countries);

  // the model a country opens: its own single-country model if it has one, else the regional one
  const modelOf = new Map();
  for (const d of [...models].sort((a, b) => b.iso3.length - a.iso3.length)) {
    for (const iso of d.iso3) modelOf.set(NUMERIC[iso], d);
  }

  // the home page shows the header's logo and name beside the intro
  app.innerHTML = `
    <section class="home-intro">
      ${document.querySelector(".site-header .brand").outerHTML}
      <div>
      <h1>Power-system planning models</h1>
      <p>Capacity expansion models for ${models.length} power systems, built and solved with seer.
        Choose a country to explore what a model assumes and what it builds.</p>
      </div>
    </section>
    <div id="map"></div>`;

  const features = topojson.feature(topo, topo.objects.countries).features.filter((f) => f.properties.name !== "Antarctica");
  const covered = features.filter((f) => modelOf.has(f.id));
  const container = document.getElementById("map");
  const width = container.clientWidth;
  // the whole world, at Natural Earth's ~2:1 aspect
  const height = Math.round(width * 0.5);
  const projection = d3.geoNaturalEarth1()
    .fitExtent([[8, 8], [width - 8, height - 8]], { type: "FeatureCollection", features });
  const path = d3.geoPath(projection);
  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img").attr("aria-label", "Map of countries with planning models");
  const tooltip = d3.select("body").selectAll(".tooltip").data([0]).join("div").attr("class", "tooltip");

  const highlight = (model) => {
    const ids = new Set(model ? model.iso3.map((iso) => NUMERIC[iso]) : []);
    svg.selectAll("path.model, circle.marker").classed("hover", (f) => ids.has(f.id));
  };
  const enter = (event, f) => {
    const model = modelOf.get(f.id);
    highlight(model);
    tooltip.style("display", "block").style("left", `${event.clientX + 14}px`).style("top", `${event.clientY + 14}px`)
      .text(displayName(model.name));
  };
  const leave = () => {
    highlight(null);
    tooltip.style("display", "none");
  };
  const open = (event, f) => {
    leave();
    location.hash = `#/${encodeURIComponent(modelOf.get(f.id).name)}/inputs`;
  };

  svg.append("g").selectAll("path").data(features).join("path")
    .attr("d", path)
    .attr("class", (f) => (modelOf.has(f.id) ? "land model" : "land"))
    .filter((f) => modelOf.has(f.id))
    .on("mousemove", enter).on("mouseleave", leave).on("click", open);

  // covered countries too small to point at get a marker
  const small = covered.filter((f) => path.area(f) < 6);
  svg.append("g").selectAll("circle").data(small).join("circle")
    .attr("class", "marker").attr("r", 3.5)
    .attr("transform", (f) => `translate(${path.centroid(f)})`)
    .on("mousemove", enter).on("mouseleave", leave).on("click", open);
}
