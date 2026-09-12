import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const expect = playwrightExpect.configure({ timeout: 60000 });

// Run against the Vite dev server; inspect the actual shared renderer without
// adding diagnostic globals or test-only APIs to the application.
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  // Sandboxed CI/remote containers: PW_CHROMIUM points at a preinstalled
  // browser, PW_PROXY at an egress proxy the tile hosts are only reachable
  // through. Both unset locally, where the defaults already work.
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  ...(process.env.PW_PROXY
    ? { proxy: { server: process.env.PW_PROXY, bypass: 'localhost,127.0.0.1' } }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 800, height: 600 }, deviceScaleFactor: 2,
});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(60000);
await mkdir('.artifacts', { recursive: true });
async function state() {
  return page.evaluate(() => {
    const s = window.verificationRoot.store.getState();
    const map = s.r3m.map;
    return {
      dpr: s.viewport.dpr, mapDpr: map.getPixelRatio(),
      width: map.getCanvas().width, cssWidth: map.getCanvas().clientWidth,
      calls: s.gl.info.render.calls, frames: s.internal.frames,
      frame: s.gl.info.render.frame, frameloop: s.frameloop,
      instances: s.scene.children.filter(x => x.isInstancedMesh).map(x => x.count),
      bearing: map.getBearing(), terrain: map.getTerrain(), zoom: map.getZoom(),
    };
  });
}
try {
  await page.goto(process.env.TEST_URL || 'http://localhost:5173');
  await expect(page.locator('.statusbar')).toContainText('World is live', { timeout: 120000 });
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(x => x.name)
      .find(x => x.includes('/@react-three_fiber.js'));
    const { _roots } = await import(url);
    window.verificationRoot = _roots.get(document.querySelector('.maplibregl-canvas'));
  });
  await expect.poll(async () => (await state()).calls, { timeout: 60000 }).toBeGreaterThan(0);
  assert((await state()).instances.some(n => n > 0));
  assert.equal((await state()).dpr, 1.5);
  assert.equal((await state()).mapDpr, 1.5);
  console.log('PASS: shared MapLibre/R3F renderer has visible instanced geometry');

  await page.getByRole('tab', { name: 'Render', exact: true }).click();
  await page.getByRole('button', { name: 'Eco', exact: true }).click();
  await expect.poll(async () => (await state()).dpr).toBe(1);
  await page.setViewportSize({ width: 640, height: 480 });
  await expect.poll(async () => (await state()).width).toBe(640);
  assert.equal((await state()).mapDpr, 1);
  await page.getByRole('button', { name: 'High', exact: true }).click();
  await expect.poll(async () => (await state()).dpr).toBe(2);
  await expect.poll(async () => (await state()).width).toBe(1280);
  await page.getByRole('button', { name: 'Eco', exact: true }).click();
  console.log('PASS: quality caps match both renderers at DPR 2 and after resize');

  const monitor = page.getByRole('checkbox', { name: /Performance monitor/ });
  for (let i = 0; i < 3; i++) {
    const frame = (await state()).frame;
    await monitor.check();
    await expect.poll(async () => (await state()).frame).toBeGreaterThan(frame + 2);
    await monitor.uncheck();
    await expect.poll(async () => (await state()).frameloop).toBe('demand');
  }
  await expect.poll(async () => (await state()).frames, { timeout: 30000 }).toBe(0);
  assert.deepEqual(errors, []);
  console.log('PASS: repeated profiler toggles return to demand rendering without errors');

  await page.setViewportSize({ width: 800, height: 600 });

  await page.getByRole('tab', { name: 'Atmosphere', exact: true }).click();
  await page.getByRole('button', { name: 'Golden', exact: true }).click();
  await page.getByRole('button', { name: 'Save world', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('terrene.world.v1')));
  assert.equal(saved.hour, 18.5);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.hour, 18.5);
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{bad'),
  });
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.sun-card')).toContainText('18:30');
  await page.locator('input[type=file]').setInputFiles({
    name: 'world.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...exported, hour: 12 })),
  });
  await expect(page.locator('.sun-card')).toContainText('12:00');
  console.log('PASS: save, export, import and malformed-file recovery');

  await page.evaluate(() => window.verificationRoot.store.getState().r3m.map.jumpTo({ center: [286.0232, 40.7685] }));
  await page.getByRole('button', { name: 'Save world', exact: true }).click();
  const longitude = await page.evaluate(() => JSON.parse(localStorage.getItem('terrene.world.v1')).longitude);
  assert(Math.abs(longitude + 73.9768) < 0.00001);
  await page.evaluate(() => window.verificationRoot.store.getState().r3m.map.jumpTo({ center: [-73.9768, 40.7685] }));
  const before = (await state()).bearing;
  await page.getByRole('button', { name: 'Orbit world O' }).click();
  await expect.poll(async () => (await state()).bearing).not.toBe(before);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Orbit world O' })).toBeVisible();
  await page.getByRole('button', { name: 'Enter focus mode' }).click();
  await expect(page.locator('.app')).toHaveClass(/focus-mode/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app')).not.toHaveClass(/focus-mode/);
  console.log('PASS: wrapped camera saves, orbit, focus and Escape');

  await page.getByRole('tab', { name: 'World', exact: true }).click();
  const density = page.getByRole('slider', { name: 'Tree density', exact: true });
  const meshesBefore = (await state()).instances.length;
  await density.press('Home');
  await expect(page.locator('.statusbar')).toContainText('0 trees', { timeout: 30000 });
  // Exactly the two tree meshes (canopy and trunk) unmount; every other
  // instanced mesh survives. Counted as a delta rather than against a fixed
  // total, because the total also includes the structure meshes, and whether
  // the cylinder one exists depends on whether the current camera has any
  // published bridge piers -- which is camera and map-data dependent, and is
  // not what this check is about.
  await expect.poll(async () => (await state()).instances.length).toBe(meshesBefore - 2);
  console.log('PASS: zero tree density unmounts only the tree meshes, amenities survive');

  const capturePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Capture world', exact: true }).click();
  const capture = await capturePromise;
  const png = await readFile(await capture.path());
  assert(png.length > 10000);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  await capture.saveAs('.artifacts/verified-capture.png');
  await page.screenshot({ path: '.artifacts/verified-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.artifacts/verified-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: PNG capture, mobile layout and no uncaught browser errors');

  await page.setViewportSize({ width: 800, height: 600 });
  await page.locator('.place-trigger').click();
  await page.getByRole('button', { name: /Chamonix Alpine valley/ }).click();
  await expect.poll(() => page.evaluate(() => {
    const map = window.verificationRoot.store.getState().r3m.map;
    return map.queryTerrainElevation([6.869, 45.921]) ?? 0;
  }), { timeout: 120000 }).toBeGreaterThan(500);
  await expect(page.locator('.statusbar')).toContainText('0 trees');
  assert((await state()).terrain);
  await page.screenshot({ path: '.artifacts/verified-terrain.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: Alpine preset loads real elevation and clears distant details');

  // Block the vector source the app is actually configured with, read off the
  // running style rather than hardcoded -- the tile host is overridable via
  // VITE_VECTOR_TILEJSON, and a hardcoded public URL silently matches nothing
  // when the app is pointed at the offline fixture server.
  const vectorOrigin = await page.evaluate(
    () => new URL(window.verificationRoot.store.getState().r3m.map.getStyle().sources.world.url).origin,
  );
  await page.route(`${vectorOrigin}/**`, route => route.abort());
  await page.reload();
  await expect(page.locator('.data-error')).toBeVisible();
  // MapLibre can emit load after a source error; the recovery action must
  // remain available after initialization settles.
  await page.waitForTimeout(2000);
  await expect(page.locator('.data-error').getByRole('button', { name: 'Reload' })).toBeVisible();
  console.log('PASS: initialization data failures expose a reload action');
} finally {
  await browser.close();
}
