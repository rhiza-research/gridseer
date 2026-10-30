// Routes: #/ (map), #/<model>/inputs, #/<model>/outputs; ?zone= and ?year= filters.
import { manifest } from "./data.js";
import { renderInputs } from "./inputs.js";
import { renderMap } from "./map.js";
import { renderOutputs } from "./outputs.js";
import { hasOutputs, sectionNav } from "./ui.js";

const app = document.getElementById("app");

function parse() {
  const [path, search = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [name, view] = path.split("/").map(decodeURIComponent);
  const params = new URLSearchParams(search);
  return { name, view, zone: params.get("zone") ?? "", year: Number(params.get("year")) || null };
}

function go({ name, view, zone, year }) {
  const params = new URLSearchParams({ ...(zone && { zone }), ...(year && { year }) });
  location.hash = `#/${encodeURIComponent(name)}/${view}${params.size ? `?${params}` : ""}`;
}

async function route() {
  const state = parse();
  window.scrollTo(0, 0);
  // the home page carries its own logo beside the intro, so it hides the page header
  document.body.classList.toggle("home", !state.name);
  try {
    if (!state.name) return await renderMap(app);
    const d = (await manifest()).countries[state.name];
    if (!d) throw new Error(`No model named "${state.name}".`);
    const view = state.view === "outputs" && hasOutputs(d) ? "outputs" : "inputs";
    if (view === "inputs") await renderInputs(app, d, state.zone);
    else await renderOutputs(app, d, state.zone, state.year);
    sectionNav(app.querySelector(".page"));
    document.getElementById("zone")?.addEventListener("change", (e) => go({ ...state, view, zone: e.target.value }));
    document.getElementById("year")?.addEventListener("change", (e) => go({ ...state, view, year: Number(e.target.value) }));
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="page"><p class="error">Couldn't load this page: ${error.message}</p></div>`;
  }
}

window.addEventListener("hashchange", route);
route();
