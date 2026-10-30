// The Code, Data and About pages: their content is plain HTML in pages/<name>.html.
import { SITE_NAME } from "./config.js";

export const PAGES = ["code", "data", "about"];

export async function renderPage(app, name) {
  const response = await fetch(`pages/${name}.html`);
  if (!response.ok) throw new Error(`pages/${name}.html: HTTP ${response.status}`);
  app.innerHTML = `<div class="page"><article><p class="site-name">${SITE_NAME}</p>${await response.text()}</article></div>`;
}
