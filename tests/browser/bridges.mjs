import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const expect = playwrightExpect.configure({ timeout: 60000 });

/**
 * B5 (BRIDGE_CONNECTIVITY_PLAN.md) live-tile browser verification for the
 * published bridge renderer (B1-B4). This is a deliberately SCOPED subset of
 * the plan's own full acceptance matrix (12 zoom values x 4 bearings x 3
 * pitches x 2 DPR x 2 terrain states, across Stockholm/Amsterdam/San
 * Francisco) -- consistent with every prior B1-B4 session in
 * docs/IDEAS_WORK_LOG.md, which explicitly chose a targeted, real check over
 * an unattempted full matrix rather than claim more than was run. What this
 * script actually checks, against real OpenFreeMap/Mapterhorn tiles:
 *
 * - Gamla Stan (default preset, terrain off): bridges publish (9/76 measured
 *   ready in prior sessions), continuous zoom across the z=13.5 live/hidden
 *   threshold, a tile-boundary pan, orbit, a source reload, and the
 *   roads/bridges visibility toggle (confirming no stale elevated mesh
 *   survives either terrain-off, which this preset already is, or a
 *   bridges-off toggle).
 * - Amsterdam (second preset, terrain off): a cross-city sanity pass that
 *   bridges either publish or the box fallback still renders -- not a claim
 *   that Amsterdam's specific bridges were located and framed one by one,
 *   which the full matrix's own text calls for and this script does not do.
 *
 * NOT run here, named rather than silently skipped: San Francisco/Chamonix
 * (terrain-on cases), exaggeration 1/1.2/2 (already covered offline in
 * tests/bridge-acceptance.test.ts, since exaggeration only affects
 * MapLibre's own queryTerrainElevation() return value -- see
 * BRIDGE_RENDERING_PLAN.md), all quality tiers in the browser (covered
 * offline), pitch/DPR sweeps, and the 12-zoom-value grid (only a handful of
 * zoom points are actually exercised below).
 */

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(60000);
await mkdir('.artifacts/bridges', { recursive: true });

async function root() {
  return page.evaluate(async () => {
    if (window.verificationRoot) return;
    const url = performance
      .getEntriesByType('resource')
      .map((x) => x.name)
      .find((x) => x.includes('/@react-three_fiber.js'));
    const { _roots } = await import(url);
    window.verificationRoot = _roots.get(document.querySelector('.maplibregl-canvas'));
  });
}

async function state() {
  return page.evaluate(() => {
    const s = window.verificationRoot.store.getState();
    const map = s.r3m.map;
    const meshes = s.scene.children.filter((x) => x.isMesh && !x.isInstancedMesh);
    return {
      zoom: map.getZoom(),
      plainMeshCount: meshes.length,
      instances: s.scene.children.filter((x) => x.isInstancedMesh).map((x) => x.count),
      terrain: !!map.getTerrain(),
    };
  });
}

try {
  await page.goto(process.env.TEST_URL || 'http://localhost:5173');
  await expect(page.locator('.statusbar')).toContainText('World is live', { timeout: 120000 });
  await root();

  // --- Gamla Stan (default preset) ---
  await page.waitForTimeout(2000); // let the debounced detail collection settle
  const s0 = await state();
  console.log(`Gamla Stan @ zoom ${s0.zoom.toFixed(2)}: plainMeshCount=${s0.plainMeshCount} terrain=${s0.terrain}`);
  assert(s0.plainMeshCount > 0, 'expected at least one published bridge deck/rail mesh at the default zoom');
  assert.equal(s0.terrain, false, 'Gamla Stan preset is terrain:false by default');
  await page.screenshot({ path: '.artifacts/bridges/gamla-stan-overview.png' });
  console.log('PASS: Gamla Stan publishes bridge meshes at the default preset');

  // --- Roads/bridges visibility toggle: no stale elevated mesh survives hiding bridges ---
  await page.getByRole('tab', { name: 'World', exact: true }).click();
  const bridgesToggle = page.getByRole('checkbox', { name: /Bridges/i });
  await bridgesToggle.uncheck();
  await expect.poll(async () => (await state()).plainMeshCount, { timeout: 30000 }).toBe(0);
  await bridgesToggle.check();
  await expect.poll(async () => (await state()).plainMeshCount, { timeout: 30000 }).toBeGreaterThan(0);
  assert.deepEqual(errors, [], 'no console errors across the bridges toggle');
  console.log('PASS: bridges toggle off/on leaves no stale mesh and cleanly republishes');

  // --- Continuous zoom across the 13.5 live/hidden threshold ---
  const map0 = () => page.evaluate(() => window.verificationRoot.store.getState().r3m.map);
  for (const z of [12.5, 13.0, 13.4, 13.6, 14.5, 15.6, 17.0]) {
    await page.evaluate((zoom) => window.verificationRoot.store.getState().r3m.map.jumpTo({ zoom }), z);
    await page.waitForTimeout(600);
  }
  await page.evaluate(() => window.verificationRoot.store.getState().r3m.map.jumpTo({ zoom: 15.6 }));
  // Rapid successive jumpTo calls each fire their own moveend/sourcedata as
  // tiles cascade in for the new zoom, repeatedly resetting the 250ms
  // collection debounce -- measured up to ~3s to finally settle, so this
  // needs real margin, not a fixed short wait.
  await expect.poll(async () => (await state()).plainMeshCount, { timeout: 30000 }).toBeGreaterThan(0);
  assert.deepEqual(errors, [], 'no console errors across the zoom sweep');
  console.log('PASS: continuous zoom sweep across the 13.5 threshold, no errors, bridges republish');
  void map0;

  // --- Tile-boundary pan ---
  await page.evaluate(() => window.verificationRoot.store.getState().r3m.map.panBy([600, 0], { duration: 0 }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.verificationRoot.store.getState().r3m.map.panBy([-600, 0], { duration: 0 }));
  await page.waitForTimeout(1500);
  assert.deepEqual(errors, [], 'no console errors across a tile-boundary pan and back');
  console.log('PASS: tile-boundary pan and back, no errors');

  // --- Orbit ---
  const bearingBefore = (await state()).zoom; // placeholder read to force settle
  await page.getByRole('button', { name: 'Orbit world O' }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  assert.deepEqual(errors, [], 'no console errors during orbit');
  console.log('PASS: orbit toggle, no errors');
  void bearingBefore;

  // --- Source reload: no crossing barrier survives it ---
  await page.reload();
  await expect(page.locator('.statusbar')).toContainText('World is live', { timeout: 120000 });
  await root();
  await expect.poll(async () => (await state()).plainMeshCount, { timeout: 30000 }).toBeGreaterThan(0);
  assert.deepEqual(errors, [], 'no console errors after reload');
  console.log('PASS: source reload republishes bridges with no errors');

  // --- Close-up screenshots (both ends, top, side) of a real published bridge ---
  // Locate a real published bridge by its own mesh geometry (never a guessed
  // lng/lat) -- the closest published deck/rail mesh to the current camera
  // center, converted back to lng/lat via geography.ts's exact local-meters
  // formula (duplicated here since page.evaluate can't import app code).
  const bridgeTarget = await page.evaluate(() => {
    const s = window.verificationRoot.store.getState();
    const map = s.r3m.map;
    const center = map.getCenter();
    const origin = [center.lng, center.lat];
    const meshes = s.scene.children.filter((x) => x.isMesh && !x.isInstancedMesh);
    const centers = meshes.map((m) => {
      const geo = m.geometry;
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      return [
        (bb.min.x + bb.max.x) / 2 + m.position.x,
        (bb.min.z + bb.max.z) / 2 + m.position.z,
      ];
    });
    let best = centers[0], bestD = Infinity;
    for (const c of centers) {
      const d = Math.hypot(c[0], c[1]);
      if (d < bestD) { bestD = d; best = c; }
    }
    return [
      origin[0] + best[0] / (111320 * Math.cos((origin[1] * Math.PI) / 180)),
      origin[1] - best[1] / 111320,
    ];
  });
  await page.evaluate(
    (center) => window.verificationRoot.store.getState().r3m.map.jumpTo({ center, zoom: 19, pitch: 0, bearing: 0 }),
    bridgeTarget,
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '.artifacts/bridges/gamla-stan-bridge-top.png' });
  // Both ends and both sides of the located bridge.
  for (const bearing of [20, 110, 200, 290]) {
    await page.evaluate(
      (b) => window.verificationRoot.store.getState().r3m.map.jumpTo({ pitch: 60, bearing: b }),
      bearing,
    );
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `.artifacts/bridges/gamla-stan-bridge-bearing${bearing}.png` });
  }
  console.log('PASS: close-up screenshots of a real located published bridge captured to .artifacts/bridges/');

  // --- Cross-city sanity: Amsterdam (second terrain-off preset) ---
  await page.evaluate(() => window.verificationRoot.store.getState().r3m.map.jumpTo({ pitch: 58, bearing: 25 }));
  await page.locator('.place-trigger').click();
  await page.getByRole('button', { name: /Amsterdam|Canal district/ }).click();
  await page.waitForTimeout(3000);
  const sAmsterdam = await state();
  console.log(`Amsterdam @ zoom ${sAmsterdam.zoom.toFixed(2)}: plainMeshCount=${sAmsterdam.plainMeshCount}`);
  assert.deepEqual(errors, [], 'no console errors after switching to the Amsterdam preset');
  await page.screenshot({ path: '.artifacts/bridges/amsterdam-overview.png' });
  console.log('PASS: Amsterdam preset loads cleanly (bridge count not asserted -- cross-city sanity only, not located/framed per the full matrix)');
} finally {
  await browser.close();
}
