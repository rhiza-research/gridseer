"""Publish each country's baseline perturbation (baseline_00000) as Parquet for the site, into data/.

Usage:
    uv run scripts/publish_data.py Botswana
    uv run scripts/publish_data.py --all

Reads <src>/<country>/perturbations/baseline_00000/{inputs,outputs}.zip (read only) and writes <out>/<country>/:
    inputs/<table>.parquet       the seer-schema input tables
    outputs/<table>.parquet      the model's output tables
    derived/<table>.parquet      tables computed here for the site:
        dispatch_by_fuel           zone, year, hour, datetime, fuel, dispatch (storage: fuel "storage", signed)
        demand                     zone, year, hour, datetime, weight, demand, lost_load (weight: real hours
                                   the modeled hour stands for)
        capacity_by_fuel           zone, year, fuel, capacity, built (MW; storage MWh / duration_hours)
    config.yaml                  the dataset's config and provenance
    LICENSE.md                   the source EPM dataset's license and attribution, from energydata.info
and rewrites <out>/manifest.json: every published country, its map countries (ISO3), license and tables.
"""
import argparse
import io
import json
import posixpath
import tempfile
from pathlib import Path
import urllib.request
import zipfile
from datetime import date

import fsspec
import pandas as pd

from seer.models.utils.time_utils import build_snapshot_calendar, compute_time_weights, load_time_weights, load_times

SRC = "gs://seer-datalake/ccai_dataset"
OUT = str(Path(__file__).resolve().parent.parent / "data")
BASELINE = "baseline_00000"
ENERGYDATA = "https://energydata.info/api/3/action/package_search?fq=groups:epm&rows=200"

# dataset -> (energydata.info title prefix, ISO3 codes it covers on the map)
COUNTRIES = {
    "Bosnia": ("Bosnia and Herzegovina", ["BIH"]),
    "Botswana": ("Botswana", ["BWA"]),
    "Burkina Faso": ("Burkina Faso", ["BFA"]),
    "Chad": ("Chad", ["TCD"]),
    "Djibouti": ("Djibouti", ["DJI"]),
    "Egypt": ("Egypt", ["EGY"]),
    "Gambia": ("Gambia", ["GMB"]),
    "Georgia": ("Georgia", ["GEO"]),
    "Iraq": ("Iraq", ["IRQ"]),
    "Lao": ("Lao (PDR)", ["LAO"]),
    "Liberia": ("Liberia", ["LBR"]),
    "Maldives": ("Maldives", ["MDV"]),
    "Morocco": ("Morocco", ["MAR"]),
    "Namibia": ("Namibia", ["NAM"]),
    "Nigeria": ("Nigeria", ["NGA"]),
    "Poland": ("Poland", ["POL"]),
    "Rwanda": ("Rwanda", ["RWA"]),
    "Senegal": ("Senegal", ["SEN"]),
    "Sierra Leone": ("Sierra Leone", ["SLE"]),
    "Sudan": ("Sudan", ["SDN"]),
    # the WAPP model, published from Mauritania's EPM dataset; its 16 zones cover these countries
    "WestAfrica": ("Mauritania", ["BEN", "BFA", "GMB", "GHA", "GIN", "GNB", "CIV", "LBR", "MLI", "MRT", "NER",
                                  "NGA", "SEN", "SLE", "TGO"]),
}


def read_zip(data):
    """{table name: DataFrame} in a zip (bytes) of csvs."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {posixpath.splitext(name)[0]: pd.read_csv(z.open(name)) for name in z.namelist()}


def calendar(inputs_zip):
    """(year, hour) -> time and weight, the models' own calendar (see time_utils)."""
    years = pd.read_csv(io.BytesIO(zipfile.ZipFile(io.BytesIO(inputs_zip)).read("years.csv")))["year"].tolist()
    with tempfile.TemporaryDirectory() as tmp:
        zipfile.ZipFile(io.BytesIO(inputs_zip)).extractall(tmp)
        cal = build_snapshot_calendar(years, load_times(tmp), load_time_weights(tmp))
    weights = compute_time_weights(cal)
    return cal.assign(weight=[weights[(y, h)] for y, h in zip(cal["year"], cal["hour"])])


def derived_tables(inputs, outputs, cal):
    """The site's derived tables (see the module docstring)."""
    dispatch = outputs["dispatch"].assign(fuel=outputs["dispatch"]["fuel"].fillna("storage"))
    dispatch_by_fuel = dispatch.groupby(["zone", "year", "hour", "datetime", "fuel"], as_index=False)["dispatch"].sum()

    peak = inputs["demand_forecast"].query("type == 'peak'")[["zone", "year", "value"]].rename(columns={"value": "peak"})
    profile = inputs["demand_profile"]
    keys = ["zone", "time"] + (["year"] if "year" in profile.columns and profile["year"].notna().any() else [])
    demand = (cal[["year", "hour", "time", "weight"]].merge(peak, on="year").merge(profile, on=keys)
              .assign(demand=lambda d: d["peak"] * d["value"]))
    # every zone's lost load, including zones with no demand (the model can report some there)
    lost = outputs["lost_load"][["zone", "year", "hour", "datetime", "lost_load"]]
    demand = (demand[["zone", "year", "hour", "demand"]].merge(lost, on=["zone", "year", "hour"], how="outer")
              .merge(cal[["year", "hour", "weight"]], on=["year", "hour"])
              [["zone", "year", "hour", "datetime", "weight", "demand", "lost_load"]].fillna({"demand": 0.0, "lost_load": 0.0}))

    # storage_capacity is energy (MWh): its power is energy / duration
    duration = inputs["storage_constants"].set_index("storage")["duration_hours"]
    storage = outputs["storage_capacity"].rename(columns={"storage": "name"})
    storage = storage.assign(capacity=storage["capacity"] / storage["name"].map(duration))
    capacity = pd.concat([outputs["generator_capacity"].rename(columns={"generator": "name"}), storage])
    capacity = capacity.assign(fuel=capacity["fuel"].fillna("storage")).sort_values(["name", "year"])
    # (an empty table's expandable column has no type, so cast it)
    gens, stores = inputs["generator_constants"], inputs["storage_constants"]
    expandable = set(gens.loc[gens["expandable"].fillna(False).astype(bool), "generator"]) | \
        set(stores.loc[stores["expandable"].fillna(False).astype(bool), "storage"])
    # built: a build option's year-on-year increase (its first modeled year counts in full)
    built = capacity.groupby("name")["capacity"].diff().fillna(capacity["capacity"]).clip(lower=0)
    capacity = capacity.assign(built=built.where(capacity["name"].isin(expandable), 0.0))
    capacity_by_fuel = capacity.groupby(["zone", "year", "fuel"], as_index=False)[["capacity", "built"]].sum()

    return {"dispatch_by_fuel": dispatch_by_fuel, "demand": demand, "capacity_by_fuel": capacity_by_fuel}


def licenses():
    """{energydata.info title prefix: license record} for the EPM group's datasets."""
    # energydata.info refuses urllib's default User-Agent
    with urllib.request.urlopen(urllib.request.Request(ENERGYDATA, headers={"User-Agent": "seer"})) as response:
        packages = json.load(response)["result"]["results"]
    return {p["title"].split(" - ")[0]: {
        "license_id": p["license_id"], "license_title": p["license_title"], "license_url": p.get("license_url"),
        "source_title": p["title"], "source_url": f"https://energydata.info/dataset/{p['name']}",
        "author": p.get("author"), "organization": (p.get("organization") or {}).get("title")} for p in packages}


def license_md(country, record):
    license_link = f" (<{record['license_url']}>)" if record.get("license_url") else ""
    return (f"# {country}: license\n\n"
            f"Derived from **{record['source_title']}** by {record['author']} ({record['organization']}), "
            f"<{record['source_url']}>, licensed under {record['license_title']}{license_link}.\n\n"
            f"Modified by Rhiza Research: converted to the seer schema, with the changes documented in "
            f"<https://github.com/rhiza-research/seer-planning-models/blob/main/from_epm/{country.replace(' ', '%20')}/NOTES.md>, "
            f"and solved with seer. This dataset (inputs, outputs and derived tables) is shared under the same "
            f"license, {record['license_id']}.\n")


def put(fs, path, data):
    """Write data to path, making its directory first."""
    fs.makedirs(posixpath.dirname(path), exist_ok=True)
    fs.pipe(path, data)


def publish(country, src, out, license):
    """Write one country's Parquet tables, config.yaml and LICENSE.md to out; returns its manifest entry."""
    src_fs, src_root = fsspec.core.url_to_fs(posixpath.join(src, country))
    out_fs, out_root = fsspec.core.url_to_fs(posixpath.join(out, country))
    base = posixpath.join(src_root, "perturbations", BASELINE)
    inputs_zip, outputs_zip = src_fs.cat(posixpath.join(base, "inputs.zip")), src_fs.cat(posixpath.join(base, "outputs.zip"))
    inputs, outputs = read_zip(inputs_zip), read_zip(outputs_zip)
    groups = {"inputs": inputs, "outputs": outputs, "derived": derived_tables(inputs, outputs, calendar(inputs_zip))}

    tables = {}
    for group, frames in groups.items():
        for name, df in frames.items():
            buffer = io.BytesIO()
            df.to_parquet(buffer, index=False, compression="zstd")
            put(out_fs, posixpath.join(out_root, group, f"{name}.parquet"), buffer.getvalue())
            tables.setdefault(group, {})[name] = {"rows": len(df), "bytes": buffer.tell()}
    put(out_fs, posixpath.join(out_root, "config.yaml"), src_fs.cat(posixpath.join(src_root, "config.yaml")))
    put(out_fs, posixpath.join(out_root, "LICENSE.md"), license_md(country, license).encode())

    summary = outputs["summary"].set_index("metric")["value"]
    return {"name": country, "iso3": COUNTRIES[country][1], "zones": inputs["zones"]["zone"].tolist(),
            "years": inputs["years"]["year"].tolist(), "license": license, "tables": tables,
            "summary": {k: float(summary[k]) for k in ["objective", "demand", "lost_load"] if k in summary}}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("countries", nargs="*", help="dataset names, e.g. Botswana 'Sierra Leone'")
    parser.add_argument("--all", action="store_true", help="every country in COUNTRIES")
    parser.add_argument("--src", default=SRC)
    parser.add_argument("--out", default=OUT, help="local directory or gs:// URL")
    args = parser.parse_args()
    countries = list(COUNTRIES) if args.all else args.countries
    unknown = set(countries) - set(COUNTRIES)
    if not countries or unknown:
        parser.error(f"name countries or pass --all; unknown: {sorted(unknown)}")

    records = licenses()
    out_fs, out_root = fsspec.core.url_to_fs(args.out)
    manifest_path = posixpath.join(out_root, "manifest.json")
    manifest = json.loads(out_fs.cat(manifest_path)) if out_fs.exists(manifest_path) else {"countries": {}}
    for country in countries:
        print(f"{country} ...", flush=True)
        manifest["countries"][country] = publish(country, args.src, args.out, records[COUNTRIES[country][0]])
    manifest["updated"] = date.today().isoformat()
    manifest["countries"] = dict(sorted(manifest["countries"].items()))
    put(out_fs, manifest_path, json.dumps(manifest, indent=1).encode())
    print(f"wrote {len(countries)} countries to {args.out}; manifest has {len(manifest['countries'])}")


if __name__ == "__main__":
    main()
