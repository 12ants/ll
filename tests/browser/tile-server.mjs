/**
 * Serves the committed vector tiles in `tests/fixtures/tiles/` over plain HTTP
 * so the browser suite can run offline, fast and deterministically.
 *
 * The app needs no code change to use it — point its own documented overrides
 * at this server (see `pnpm dev:offline` / `pnpm test:browser:offline`):
 *
 *   VITE_VECTOR_TILEJSON=http://127.0.0.1:8099/planet
 *
 * The fixture covers the zoom levels the suite actually asserts on. Every miss
 * is answered 404, which MapLibre treats as an empty tile exactly as upstream
 * does. Misses *inside* the covered zoom range are printed once each, because
 * those mean the suite's camera path has drifted — re-capture with
 * `node tests/browser/capture-tiles.mjs` when that is intentional.
 *
 * Misses below the covered range are silent and expected: MapLibre
 * opportunistically requests low-zoom parent tiles it never displays at these
 * cameras, and a single world-overview level costs more than 3 MB — far more
 * than committing it is worth for tiles no assertion depends on.
 *
 * OpenFreeMap's planet source has maxzoom 14; z15+ views are overzoomed from
 * z14 tiles, which is why no higher zoom directories exist.
 *
 * The DEM fixture is metadata only. MapLibre loads a source's TileJSON even
 * when terrain is off, so `/dem` is needed for the suite to run offline at
 * all, but no DEM *tile* is ever requested at `terrain: false` — the
 * terrain-on presets still need live Mapterhorn tiles.
 */
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "tiles");
const PORT = Number(process.env.TILE_PORT || 8099);
const misses = new Set();
const zooms = (await readdir(join(ROOT, "planet"))).map(Number);
const minZoom = Math.min(...zooms);

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (req.url === "/planet") {
      const json = JSON.parse(await readFile(join(ROOT, "planet.tilejson.json"), "utf8"));
      json.tiles = [`http://127.0.0.1:${PORT}/t/{z}/{x}/{y}`];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
      return;
    }
    if (req.url === "/dem") {
      const json = JSON.parse(await readFile(join(ROOT, "dem.tilejson.json"), "utf8"));
      json.tiles = [`http://127.0.0.1:${PORT}/d/{z}/{x}/{y}.webp`];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
      return;
    }
    const tile = req.url?.match(/^\/t\/(\d+)\/(\d+)\/(\d+)$/);
    if (tile) {
      const [, z, x, y] = tile;
      const body = await readFile(join(ROOT, "planet", z, x, `${y}.pbf`));
      res.writeHead(200, { "content-type": "application/x-protobuf" });
      res.end(body);
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    if (error.code === "ENOENT") {
      const zoom = Number(req.url.split("/")[2]);
      if (zoom >= minZoom && !misses.has(req.url)) {
        misses.add(req.url);
        console.warn(`tile-server: no fixture for ${req.url}`);
      }
      res.writeHead(404).end();
      return;
    }
    res.writeHead(500).end(String(error.message ?? error));
  }
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(
    `tile-server: serving ${ROOT} (z${minZoom}-z${Math.max(...zooms)}) on http://127.0.0.1:${PORT}`,
  ),
);
