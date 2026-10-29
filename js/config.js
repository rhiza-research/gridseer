// Site settings that aren't styling (styling lives in css/style.css).

// the site's name, shown above each page's heading
export const SITE_NAME = "seer";

// where each model's data comes from; a model without a `source` in the manifest is EPM
export const SOURCES = { epm: "World Bank EPM" };
export const DEFAULT_SOURCE = "epm";

// display names for models whose dataset name isn't how we'd write it
const DISPLAY_NAMES = {
  Bosnia: "Bosnia and Herzegovina",
  Lao: "Lao PDR",
  "Sao Tome and Principe": "São Tomé and Príncipe",
  WestAfrica: "West Africa",
};
export const displayName = (name) => DISPLAY_NAMES[name] ?? name;

// a CSS custom property's value, for chart colors (SVG attributes can't use var())
export const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
