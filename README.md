# gridseer

A static site for browsing seer power-system planning models: a map of covered countries, and for each model
its planning inputs and solved outputs.

- Data: `gs://gridseer-data/<Country>/{inputs,outputs,derived}/*.parquet` plus `manifest.json`, written by
  `python -m seer.ccai_dataset.publish_browse` in [seer](https://github.com/rhiza-research/seer) from each
  country's baseline perturbation in the CCAI dataset.
- Site: plain HTML and ES modules, no build step. Parquet is read in the browser with DuckDB-WASM and charted
  with Observable Plot.
- Licenses: each model is derived from a World Bank EPM dataset on
  [energydata.info](https://energydata.info/group/epm) and shared under that dataset's license
  (`<Country>/LICENSE.md` in the bucket; shown on each page).

## Run locally

```bash
scripts/sync_data.sh
python3 -m http.server 8000
```

Then open http://localhost:8000. On localhost the site reads `./data`; anywhere else it reads
`https://storage.googleapis.com/gridseer-data/`, which needs the bucket to be publicly readable.
