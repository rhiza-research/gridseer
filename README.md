# gridseer

A static site for browsing seer power-system planning models: a map of covered countries, and for each model
its planning inputs and solved outputs.

- Data: `data/<Country>/{inputs,outputs,derived}/*.parquet` plus `data/manifest.json`, kept in this repo and
  served with the site. `scripts/publish_data.py` writes them from each country's baseline perturbation in the
  CCAI dataset (`gs://seer-datalake/ccai_dataset`, read only).
- Site: plain HTML and ES modules, no build step. Parquet is read in the browser with DuckDB-WASM and charted
  with Observable Plot.
- Licenses: each model is derived from a World Bank EPM dataset on
  [energydata.info](https://energydata.info/group/epm) and shared under that dataset's license
  (`data/<Country>/LICENSE.md`; shown on each page).

## Update the data

Write one or more countries (or `--all`) into `data/`, then commit. The manifest keeps the countries you don't
rewrite. The script imports seer's calendar code, so it expects the [seer](https://github.com/rhiza-research/seer)
checkout next to this one (`../seer`).

```bash
uv run scripts/publish_data.py Botswana
```

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
