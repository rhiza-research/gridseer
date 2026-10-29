// Fuel groups: the EPM fuels across all countries fold into these, stacked bottom to top in this order.
// Colors are the --fuel-<key> tokens in css/style.css.
import { token } from "./config.js";

export const FUELS = [
  { key: "nuclear", label: "Nuclear", match: ["uranium", "nuclear"] },
  { key: "coal", label: "Coal", match: ["coal", "lignite", "peat"] },
  { key: "gas", label: "Gas", match: ["gas"] },
  { key: "oil", label: "Oil", match: ["oil"] },
  { key: "hydro", label: "Hydro", match: ["water", "hydro"] },
  { key: "wind", label: "Wind", match: ["wind"] },
  { key: "solar", label: "Solar", match: ["solar"] },
  { key: "import", label: "Imports", match: ["import"] },
  { key: "storage", label: "Storage", match: ["storage"] },
  { key: "other", label: "Other", match: [] },
];
const BY_KEY = Object.fromEntries(FUELS.map((f) => [f.key, f]));

export const fuelColor = (key) => token(`--fuel-${key}`);

// SQL expression mapping a fuel column to its group key; anything starting "import" is an import.
export function fuelGroupSql(column) {
  const cases = FUELS.filter((f) => f.match.length).map((f) =>
    `WHEN lower(${column}) IN (${f.match.map((m) => `'${m}'`).join(", ")}) THEN '${f.key}'`);
  return `CASE ${cases.join(" ")} WHEN lower(${column}) LIKE 'import%' THEN 'import' ELSE 'other' END`;
}

export const fuelLabel = (key) => BY_KEY[key]?.label ?? key;

// Plot color scale over the groups present (fixed colors and order, whatever subset appears).
export function fuelScale(present) {
  const keys = FUELS.map((f) => f.key).filter((k) => present.has(k));
  return { domain: keys.map(fuelLabel), range: keys.map(fuelColor) };
}

export const fuelOrder = (key) => FUELS.findIndex((f) => f.key === key);
