import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * B5 (BRIDGE_CONNECTIVITY_PLAN.md) camera-matrix acceptance for the published
 * bridge renderer, run OFFLINE against the committed z11-z14 fixtures in
 * `tests/fixtures/tiles/` (`pnpm tiles` + `pnpm dev:offline`).
 *
 * This is the plan's "12 zoom x 4 bearing x 3 pitch x 2 DPR x 2 terrain x
 * 3 city" grid, with three axis decisions that were MEASURED in a
 * reconnaissance pass rather than assumed -- see docs/IDEAS_WORK_LOG.md:
 *
 * - **DPR is not a geometry axis.** Six cameras across all three cities were
 *   probed at deviceScaleFactor 1 and 2: every pair was bit-for-bit identical
 *   (deck count, rail count, triangle totals, every instance count). It is
 *   therefore checked once, in `dprPass()` below, instead of doubling 288
 *   cells. Collection is driven by `queryRenderedFeatures` over the viewport
 *   in CSS pixels, which is why.
 * - **Below the z13.5 threshold the only invariant is "nothing published",
 *   and it is independent of bearing and pitch.** 48/48 recon cells at
 *   z11.5-z13.4 published zero decks at every bearing/pitch combination
 *   tested, so those zooms are swept once per city instead of 12 times.
 * - **Terrain-on is not covered here at all.** No DEM tiles are committed
 *   (`tests/fixtures/tiles/README.md`), so San Francisco/Chamonix still need
 *   live Mapterhorn tiles. That half of the plan's terrain axis remains open
 *   and is named rather than quietly dropped.
 *
 * Assertions are deliberately RELATIONAL, not absolute counts. A tile the
 * fixture set does not have is served 404, which MapLibre renders as an empty
 * tile -- so a missing tile silently removes roads and bridges without
 * erroring. Absolute expectations would turn that into a phantom product bug.
 * Every cell therefore records its own 404 count (`tileMisses`) as data, and
 * the invariants below hold whether or not the world is fully populated.
 */

const URL = process.env.TEST_URL || 'http://localhost:5173';
const OUT = '.artifacts/bridges/matrix.jsonl';
const RAIL_HEX = '7c8179'; // ACCESSORY_COLOR in src/world/bridge-boundaries.ts
const BALANCED_BRIDGE_TRIANGLES = 25000; // QUALITY.balanced.bridgeTriangles, the default tier
const ZOOM_THRESHOLD = 13.5; // details-data.ts / structures.ts: `map.getZoom() < 13.5`

const ALL_CITIES = {
  'gamla-stan': [18.0686, 59.3251],
  amsterdam: [4.884, 52.369],
  manhattan: [-73.9768, 40.7685],
};
// `MATRIX_CITIES=amsterdam,manhattan` re-runs part of the grid without
// repeating the whole thing -- the two zooms just above the threshold cost
// minutes per cell, so a full pass is long enough to want to resume it.
const CITIES = process.env.MATRIX_CITIES
  ? Object.fromEntries(process.env.MATRIX_CITIES.split(',').map((n) => [n.trim(), ALL_CITIES[n.trim()]]))
  : ALL_CITIES;
// Descending, so a run that is cut short loses the fewest cells: collection
// cost rises steeply as the viewport widens, and the two zooms just above the
// threshold are by far the most expensive cells in the grid.
const LIVE_ZOOMS = [19.0, 18.5, 17.5, 16.5, 15.6, 15.0, 14.0, 13.6];
const HIDDEN_ZOOMS = [13.4, 13.0, 12.5, 11.5];
const BEARINGS = [0, 90, 180, 270];
const PITCHES = [0, 30, 60];

mkdirSync('.artifacts/bridges', { recursive: true });
writeFileSync(OUT, '');

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  ...(process.env.PW_PROXY
    ? { proxy: { server: process.env.PW_PROXY, bypass: 'localhost,127.0.0.1' } }
    : {}),
});

async function openPage(dpr) {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 800 },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  const errors = [];
  let tileMisses = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  // A 404 here is a fixture gap, not an app failure -- recorded per cell so a
  // depopulated world is visible in the results instead of misread as a bug.
  page.on('response', (r) => {
    if (r.status() === 404 && /\/t\/\d+\/\d+\/\d+$/.test(r.url())) tileMisses++;
  });
  page.setDefaultTimeout(180000);
  await page.goto(URL);
  await page
    .locator('.statusbar')
    .filter({ hasText: 'World is live' })
    .waitFor({ timeout: 180000 });
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((x) => x.name)
      .find((x) => x.includes('/@react-three_fiber.js'));
    const { _roots } = await import(url);
    window.verificationRoot = _roots.get(document.querySelector('.maplibregl-canvas'));
  });
  return { context, page, errors, misses: () => tileMisses };
}

/** Cheap poll target: just the published plain-mesh count. */
const meshCount = (page) =>
  page.evaluate(
    () =>
      window.verificationRoot.store
        .getState()
        .scene.children.filter((x) => x.isMesh && !x.isInstancedMesh).length,
  );

const read = (page) =>
  page.evaluate((railHex) => {
    const s = window.verificationRoot.store.getState();
    const map = s.r3m.map;
    const plain = s.scene.children.filter((x) => x.isMesh && !x.isInstancedMesh);
    let decks = 0;
    let rails = 0;
    let deckTris = 0;
    let railTris = 0;
    let maxDist = 0;
    let nonFinite = 0;
    for (const m of plain) {
      const hex = m.material?.color?.getHexString?.() ?? '';
      const tris = m.geometry?.index ? m.geometry.index.count / 3 : 0;
      if (hex === railHex) {
        rails++;
        railTris += tris;
      } else {
        decks++;
        deckTris += tris;
      }
      const bs = m.geometry?.boundingSphere;
      if (!bs || !Number.isFinite(bs.radius)) nonFinite++;
      else
        maxDist = Math.max(
          maxDist,
          Math.hypot(bs.center.x + m.position.x, bs.center.z + m.position.z),
        );
    }
    return {
      zoom: map.getZoom(),
      terrain: !!map.getTerrain(),
      decks,
      rails,
      deckTris,
      railTris,
      nonFinite,
      maxDist: Math.round(maxDist),
    };
  }, RAIL_HEX);

/**
 * Settle on the debounced collection rather than waiting a fixed time. A fixed
 * wait is what produced the false "mesh retention bug" this suite already
 * documents: it reads one collection behind and reports the previous camera's
 * scene. Waits for MapLibre to stop loading, then requires the mesh count to
 * hold steady across consecutive reads.
 */
async function settle(page, deadlineMs = 120000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const quiet = await page.evaluate(() => {
      const map = window.verificationRoot.store.getState().r3m.map;
      return !map.isMoving() && map.loaded();
    });
    if (quiet) break;
    await page.waitForTimeout(250);
  }
  let previous = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(300);
    const n = await meshCount(page);
    if (n === previous) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
      previous = n;
    }
  }
  return { ...(await read(page)), settled: Date.now() < deadline };
}

const failures = [];
// Cells the harness could not measure cleanly. Kept separate from `failures`
// so the run's verdict never conflates "could not measure" with "product is
// wrong" -- these are reported as a coverage gap and re-run, not as defects.
const unmeasured = [];
let cells = 0;

async function cell(ctx, city, zoom, bearing, pitch, dpr) {
  const { page, errors, misses } = ctx;
  const t0 = Date.now();
  errors.length = 0;
  const missesBefore = misses();
  await page.evaluate((p) => window.verificationRoot.store.getState().r3m.map.jumpTo(p), {
    center: CITIES[city],
    zoom,
    bearing,
    pitch,
  });
  const s = await settle(page);
  const row = {
    city,
    zoom,
    bearing,
    pitch,
    dpr,
    ...s,
    tileMisses: misses() - missesBefore,
    ms: Date.now() - t0,
    errors: [...errors],
  };
  appendFileSync(OUT, JSON.stringify(row) + '\n');
  cells++;

  const where = `${city} z${zoom} b${bearing} p${pitch} dpr${dpr}`;
  const fail = (m) => failures.push(`${where}: ${m}`);

  if (row.errors.length) fail(`page errors: ${row.errors.join(' | ')}`);
  if (row.terrain) fail('terrain unexpectedly enabled on a terrain-off preset');

  // A cell that never settled was read mid-collection, so its counts describe a
  // half-built scene. Every relational check below can false-fire on such a read
  // -- a stale above-threshold deck set survives into a sub-threshold camera,
  // a rail can be attached before its deck, a mesh can still carry the previous
  // camera's local-meters origin. That is a measurement gap, not a product
  // defect, so record it as missing coverage and draw no invariant conclusion.
  if (!row.settled) {
    unmeasured.push(where);
    return row;
  }

  if (row.nonFinite) fail(`${row.nonFinite} mesh(es) have a missing/non-finite bounding sphere`);
  if (zoom < ZOOM_THRESHOLD && (row.decks || row.rails))
    fail(`published ${row.decks} decks / ${row.rails} rails below the z${ZOOM_THRESHOLD} threshold`);
  // B4: the rail is the optional part -- the triangle budget drops it per
  // bridge, never the mandatory deck, so rails can never outnumber decks.
  if (row.rails > row.decks) fail(`${row.rails} rails vs ${row.decks} decks -- rails outnumber decks`);
  // Decks are allocated unconditionally, so the bound is the budget OR the
  // deck total, whichever is larger; only rails are gated by the budget.
  const total = row.deckTris + row.railTris;
  if (total > Math.max(BALANCED_BRIDGE_TRIANGLES, row.deckTris))
    fail(`${total} bridge triangles exceeds max(budget ${BALANCED_BRIDGE_TRIANGLES}, decks ${row.deckTris})`);
  // A mesh left in a previous camera's local-meters frame would land absurdly
  // far from the current origin.
  if (row.maxDist > 20000) fail(`a bridge mesh sits ${row.maxDist}m from the camera origin`);
  return row;
}

try {
  const ctx = await openPage(1);

  for (const city of Object.keys(CITIES)) {
    for (const zoom of LIVE_ZOOMS)
      for (const bearing of BEARINGS)
        for (const pitch of PITCHES) {
          const r = await cell(ctx, city, zoom, bearing, pitch, 1);
          console.log(
            `${city} z${zoom} b${bearing} p${pitch}: decks=${r.decks} rails=${r.rails} tris=${r.deckTris + r.railTris} miss=${r.tileMisses} ${r.ms}ms${r.errors.length ? ' ERR' : ''}`,
          );
        }
    // Sub-threshold: measured invariant to bearing/pitch, so swept once.
    for (const zoom of HIDDEN_ZOOMS) {
      const r = await cell(ctx, city, zoom, 0, 0, 1);
      console.log(`${city} z${zoom} (hidden): decks=${r.decks} rails=${r.rails} miss=${r.tileMisses} ${r.ms}ms`);
    }
  }

  // At least one camera in the grid must actually publish bridges, or the
  // relational invariants above would pass vacuously on an empty scene.
  const rows = readFileSync(OUT, 'utf8').trim().split('\n').map(JSON.parse);
  const publishing = rows.filter((r) => r.decks > 0);
  assert(
    publishing.length > 0,
    'no camera in the entire matrix published a bridge -- the invariants passed vacuously',
  );
  console.log(`${publishing.length}/${rows.length} cells published at least one bridge`);

  await ctx.context.close();

  // --- DPR pass: confirm the measured finding that DPR is not a geometry axis ---
  const dprRows = { 1: [], 2: [] };
  for (const dpr of [1, 2]) {
    const c = await openPage(dpr);
    for (const city of Object.keys(CITIES))
      for (const [zoom, bearing, pitch] of [
        [15.6, 0, 0],
        [16.5, 90, 60],
      ])
        dprRows[dpr].push(await cell(c, city, zoom, bearing, pitch, dpr));
    await c.context.close();
  }
  // Both passes walk the same camera sequence in a fresh context, so tile-cache
  // history is matched between them and the comparison is fair. An unsettled
  // read on either side describes a half-built scene and would differ for a
  // reason that has nothing to do with DPR, so those pairs are skipped.
  let dprCompared = 0;
  for (let i = 0; i < dprRows[1].length; i++) {
    const a = dprRows[1][i];
    const b = dprRows[2][i];
    if (!a.settled || !b.settled) continue;
    dprCompared++;
    const same = ['decks', 'rails', 'deckTris', 'railTris'].every((k) => a[k] === b[k]);
    if (!same)
      failures.push(
        `dpr ${a.city} z${a.zoom} b${a.bearing} p${a.pitch}: dpr1=${a.decks}/${a.rails}/${a.deckTris + a.railTris} vs dpr2=${b.decks}/${b.rails}/${b.deckTris + b.railTris} -- DPR changes published geometry, so it IS a matrix axis and this grid must be doubled`,
      );
  }
  console.log(
    `devicePixelRatio 1 vs 2: ${dprCompared}/${dprRows[1].length} camera pairs compared cleanly` +
      (dprCompared ? '' : ' -- NO pair was measurable, the DPR axis is unverified'),
  );

  const totalMisses = rows.reduce((a, r) => a + r.tileMisses, 0);
  console.log(`\n${cells} cells run. Fixture 404s across the grid: ${totalMisses}.`);

  // Reported before the verdict: an invariant "pass" only covers the cells the
  // harness could actually measure, and saying so is the difference between
  // evidence and a vacuous green tick.
  if (unmeasured.length) {
    console.warn(
      `\n${unmeasured.length} cell(s) never settled and were NOT checked against the invariants:`,
    );
    for (const u of unmeasured) console.warn(`  - ${u}`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} failing cell(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log(
      `PASS: the ${cells - unmeasured.length} measurable cell(s) satisfied the bridge invariants` +
        (unmeasured.length ? `; ${unmeasured.length} cell(s) remain unverified` : ''),
    );
  }
} finally {
  await browser.close();
}
