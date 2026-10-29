// Data access: the manifest and each country's Parquet tables, queried with DuckDB-WASM.
import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";

// While testing, the bucket is private: serve a local copy at ./data (scripts/sync_data.sh).
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
export const DATA_BASE = LOCAL ? new URL("data/", location.href).href : "https://storage.googleapis.com/gridseer-data/";

let manifestPromise;
export function manifest() {
  manifestPromise ??= fetch(DATA_BASE + "manifest.json").then((r) => {
    if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
    return r.json();
  });
  return manifestPromise;
}

let connPromise;
async function connection() {
  connPromise ??= (async () => {
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    return { db, conn: await db.connect() };
  })();
  return connPromise;
}

// Tables are small (a few MB at most), so each is fetched whole once and registered with DuckDB.
const registered = new Map();
export function table(country, group, name) {
  const key = `${country}/${group}/${name}`;
  if (!registered.has(key)) {
    registered.set(key, (async () => {
      const { db } = await connection();
      const response = await fetch(DATA_BASE + key.split("/").map(encodeURIComponent).join("/") + ".parquet");
      if (!response.ok) throw new Error(`${key}.parquet: HTTP ${response.status}`);
      const file = key.replace(/[^A-Za-z0-9]/g, "_") + ".parquet";
      await db.registerFileBuffer(file, new Uint8Array(await response.arrayBuffer()));
      return `read_parquet('${file}')`;
    })());
  }
  return registered.get(key);
}

// Rows of a query as plain objects (DuckDB's BIGINTs become numbers).
export async function query(sql) {
  const { conn } = await connection();
  const result = await conn.query(sql);
  return result.toArray().map((row) => {
    const obj = row.toJSON();
    for (const k in obj) if (typeof obj[k] === "bigint") obj[k] = Number(obj[k]);
    return obj;
  });
}

export const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;
