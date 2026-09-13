# Lighting and Shadow Plan

Goal: make the world read as lit — buildings casting real shadows across
streets, surfaces responding to the sun's angle — without giving up the
frame budget the quality tiers exist to protect.

## Measured starting point

Read from the code, not assumed.

- **One hemisphere light and one directional light**, both in
  `src/world/Details.tsx:199-213`. The sun position is derived from
  `config.hour` on a simple semicircle (`Details.tsx:180-187`).
- **Shadow map scales with the quality tier** (`Details.tsx:191-196`):
  1024/400 m on Eco, 2048/600 m on Balanced, 4096/800 m on High, with
  `shadow-bias -0.0015`.
- **Only R3F objects participate in shadows.** `castShadow`/`receiveShadow`
  are set on bridge meshes (`BridgeMeshes.tsx:28`) and on the instanced
  detail meshes (`Details.tsx:76-77`, `118-119`).

## The central problem

**Buildings are drawn by MapLibre, not by three.js.** `style.ts:251-255`
renders them as a `fill-extrusion` layer. The two renderers share a canvas
and depth buffer via `react-three-map`, so they occlude each other correctly
— but a three.js `directionalLight` shadow map only contains three.js
objects. The buildings are therefore invisible to the shadow pass in both
directions:

- they **cast** no shadow onto streets, bridges, trees or each other
- they **receive** no shadow from anything

That single fact explains most of why the scene reads flat. Adding more
lights will not fix it; the geometry has to be in the shadow pass.

## Options, cheapest first

### A. Shadow-caster proxies for nearby buildings (recommended first step)

Build invisible three.js boxes matching the footprint and height of
buildings within a radius, and let *those* cast shadows. The visible
building stays MapLibre's extrusion; the proxy contributes only to the
shadow map.

- `collectStructures` already walks building rings with height, base and
  terrain ground (`structures.ts:67-97`) — the data needed exists and is
  already being read every collection.
- Render as a single `InstancedMesh` of boxes with
  `material.colorWrite = false` (or `visible = false` plus `castShadow`,
  measured to confirm three.js still renders it into the shadow map), so
  there is no extra colour-pass cost.
- Budget it exactly like every other detail: a per-tier cap and a radius,
  sorted nearest-first, matching the existing `cap` pattern.

Risk: a box proxy is wrong for a non-convex footprint. Use the footprint's
extruded ring rather than its bounding box where the ring has more than
four points; fall back to the box beyond a distance where the difference is
sub-pixel.

Acceptance: a street between two tall buildings is visibly shadowed at
`hour` 8 and 17 and unshadowed at noon; frame time at Balanced within 10%
of the pre-change baseline at the same camera.

### B. Cascaded shadow maps

A single 600 m orthographic shadow camera at 2048² is roughly 0.3 m per
texel — too coarse for a kerb, too tight for a skyline. Two or three
cascades (near/mid/far) would sharpen near-field contact shadows without
widening the far extent.

Do this **after** A: cascades sharpen shadows that exist; they do not create
the missing ones.

### C. Ambient occlusion in the gaps

Screen-space AO would give buildings weight where they meet the ground.
Costly and easy to over-apply; defer until A and B land, and gate it to the
High tier.

### D. Sky and sun colour coupling

`daylight(config.hour)` already returns `hemi`, `sceneSun` and `sunColor`.
The sun's *elevation* currently drives a semicircle that never goes below
the horizon. Low-angle light (long shadows near dawn/dusk) is the single
cheapest readability win once shadows exist at all: extend the curve, and
let shadow length follow it.

## Sequencing

1. Building shadow-caster proxies (A) — the unlock.
2. Re-measure. If shadows are present but mushy, cascades (B).
3. Low-sun angles (D), which cost nothing once A works.
4. AO (C) only on High, only if still wanted.

## What not to do

- Do not port buildings to three.js geometry to get shadows. MapLibre's
  extrusion handles tile lifecycle, filtering and styling; reimplementing it
  is a far larger project than proxies, and the two would drift.
- Do not raise `shadow-camera-far` to cover the whole view. Shadow-map
  resolution is a fixed budget spread over the extent; widening it blurs
  every shadow in the scene.
