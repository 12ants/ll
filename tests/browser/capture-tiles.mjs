/**
 * Re-captures `tests/fixtures/tiles/` from the live upstream.
 *
 * Run this only when the browser suite's camera path changes and
 * `tile-server.mjs` starts reporting misses. It stands in for the fixture
 * server, forwarding every request upstream and writing the response into the
 * fixture tree on the way back, so the capture is exactly what the suite asks
 * for — no more, no less:
 *
 *   node tests/browser/capture-tiles.mjs          # terminal 1
 *   pnpm dev:offline                              # terminal 2
 *   pnpm test:browser                             # terminal 3
 *
 * then commit whatever appeared under `tests/fixtures/tiles/`.
 *
 * Fetches with `curl` rather than `fetch` so it works unchanged behind the
 * HTTPS proxies common in CI and sandboxed containers, which `fetch` ignores.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "tiles");
const PORT = Number(process.env.TILE_PORT || 8099);
const UPSTREAM =
  process.env.CAPTURE_VECTOR_TILEJSON || "https://tiles.openfreemap.org/planet";

function download(url, file) {
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      ["-sS", "--fail", "--compressed", "-L", "--max-time", "60", "-o", file, url],
      (error) => (error ? rm(file, { force: true }).then(() => reject(error), reject) : resolve()),
    );
  });
}

let tileTemplate = null;

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (req.url === "/planet") {
      const file = join(ROOT, "planet.tilejson.json");
      await mkdir(ROOT, { recursive: true });
      await download(UPSTREAM, file);
      const json = JSON.parse(await readFile(file, "utf8"));
      tileTemplate = json.tiles[0];
      // Store upstream's own TileJSON verbatim; only the served copy is
      // rewritten, so a re-capture never bakes a localhost URL into the fixture.
      json.tiles = [`http://127.0.0.1:${PORT}/t/{z}/{x}/{y}`];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
      return;
    }
    const tile = req.url?.match(/^\/t\/(\d+)\/(\d+)\/(\d+)$/);
    if (tile && tileTemplate) {
      const [, z, x, y] = tile;
      await mkdir(join(ROOT, "planet", z, x), { recursive: true });
      const file = join(ROOT, "planet", z, x, `${y}.pbf`);
      await download(
        tileTemplate.replace("{z}", z).replace("{x}", x).replace("{y}", y),
        file,
      );
      console.log(`captured ${z}/${x}/${y}`);
      res.writeHead(200, { "content-type": "application/x-protobuf" });
      res.end(await readFile(file));
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(502).end(String(error.message ?? error));
  }
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`capture-tiles: recording into ${ROOT} from ${UPSTREAM}`),
);
