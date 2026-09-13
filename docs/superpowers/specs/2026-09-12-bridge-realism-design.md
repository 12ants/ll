# Bridge rendering realism — design

**Date:** 2026-09-12
**Status:** geometry and junction-continuation work implemented; browser verification and terrain-on coverage outstanding
**Goal:** make published bridges read as roads a vehicle could drive on —
ramps, curves, junctions, railings and deck surface — rather than as raised
slabs.

## Where the realism was actually lost

Read from the code before designing, not assumed:

1. **The deck was a flat slab.** `withOffsets` set `left`/`right` Y equal to
   `center` Y, so the cross-section was literally two points: no crown, no
   kerb, no edge beam.
2. **Curves were faceted.** Every triangle carried its own flat face normal
   (a deliberate, documented scope choice), so a curved deck shaded as a
   chain of plates.
3. **Curves pinched.** Edges were offset by exactly half-width along a local
   tangent with no miter correction, so at a bend adjacent segments' edges
   failed to meet and the deck visibly narrowed.
4. **The railing was one floating bar** at 0.95 m, with sparse 8 m posts.
5. **Junctions rejected the whole bridge.** An approach reaching a junction
   with a height gap over `JUNCTION_HEIGHT_TOLERANCE` (0.5 m) discarded the
   component outright — see the measured breakdown below, which turned out to
   be the dominant cause of bridges not appearing at all.
6. **Ramps were already fine** — cubic-Hermite smoothstep, 8% max grade (12%
   for paths), 250 m max approach. Deliberately left alone.

## The finding that dominates all of the above

A reject census against the committed fixtures, replicating
`collectBridgeSurfaces` but keeping the `rejected` array that production
discards (`details-data.ts` drops it on the floor):

| view | bridge edges | solved | solve rate |
| --- | --- | --- | --- |
| Gamla Stan z15 | 89 | 4 | 4.5% |
| Gamla Stan z14 | 220 | 16 | 7.3% |
| Gamla Stan z13.6 | 157 | 23 | 14.6% |
| Amsterdam z15 | 138 | 30 | 21.7% |
| Amsterdam z14 | 440 | 115 | 26.1% |
| Amsterdam z13.6 | 421 | 124 | 29.5% |

**70–95% of bridge edges in a real view never render at all.** Every
cross-section improvement below polishes the minority that survive. This is
recorded here because it should drive priority, and because
`bridge-profile.ts`'s own doc comment already hinted at it ("the overwhelming
majority fail") without anyone having put a number to it.

## Design

### Cross-section (implemented)

`ProfileSample.left`/`right` keep meaning **the outer deck edge**. The crown
and kerb are generated *inward and below* that line inside `bridge-mesh.ts`.

This is the load-bearing decision: it leaves `bridge-profile.ts` and
`bridge-boundaries.ts` untouched, and railings already sit on `left`/`right`,
which is exactly where a kerb-mounted railing belongs.

Section ring, 7 points: `left` (kerb top) → kerb foot → crown → kerb foot →
`right` → soffit right → soffit left. 2% crossfall, 0.15 m kerb upstand,
kerb width 8% of deck width capped at 0.45 m.

### Shading (implemented)

Normals are averaged **along the run only**, never across the section, so
curves shade continuously while every section edge (kerb, crown, fascia)
stays a hard crease. Adjacent triangles keep their own vertices and simply
agree on the normal at a shared position — which is all the interpolator
needs, and costs no change to triangle count or ordering.

### Miter (implemented)

Offset along the bisector of the two segment normals, scaled by
`1 / cos(theta/2)`. Clamped by **extension length** (≤ 2× half-width), not by
angle: the factor diverges at a full reversal and OSM carries real hairpins,
so an unclamped miter throws a vertex arbitrarily far across the scene. Past
the clamp the deck keeps a finite, pinched corner — wrong but bounded.

### Level of detail (implemented)

Measured, not estimated: the profiled section is **52 triangles vs the slab's
28 on the four-sample fixture — 1.86×**, not the 4× originally guessed.
Against Gamla Stan's measured 17,280-triangle peak that is 32,090 against a
25,000 balanced-tier ceiling, so LOD is required. Full section within 350 m,
plain slab beyond, chosen in `details-data.ts` which knows the camera;
`bridge-mesh.ts` stays pure geometry.

### Railings and markings (implemented)

Two rail courses (handrail at the original 0.95 m / 0.14 m so earlier
captures stay comparable, plus a lower course at 0.52 m / 0.09 m). Painted
markings — solid edge lines inside each kerb, dashed centreline on a 9 m
period with 4.5 m of paint — as their own buffer, since they need a different
material and are optional under triangle pressure.

Constraint discovered while building this: on a 14 m deck the 2% crown rises
0.14 m, essentially level with the 0.15 m kerb. Paint therefore has ~1 cm of
headroom and is lifted only 6 mm.

### Budget order

Deck (mandatory) → rails → markings. Optional geometry is shed before any
deck is touched, preserving B4's "allocate complete mandatory deck/ramp
meshes first".

### Junction handling (implemented — and not what was originally scoped)

The reject tally redirected this. Of 1,251 rejections, **981 (78.4%) are
junction-attributed** — but the distribution shows why patch geometry was the
wrong fix:

- `walked` before hitting the junction: median **3.1 m**, and **44% are
  exactly 0 m** — the bridge's own end node *is* the junction, so the approach
  walk never takes a single step.
- `residual` height still to descend: median **1.14 m**, 87% within 2 m.
- junction degree: 3 (619), 4 (325), 5 (36), 6 (1).

These are not branching decks. They are ordinary bridges ending at ordinary
junctions, where the ramp needed roughly 14 m more road at the 8% limit and
`walkApproachChain` stopped dead instead of continuing. `bridge-profile.ts`'s
own doc comment already named the gap: *"the walk still stops at the first
junction (it does not choose a 'straightest' continuation)"*.

**Implemented:** the walk follows the straightest non-bridge continuation
through a junction, gated by `MIN_CONTINUATION_ALIGNMENT = 0.5` (within 60°
of the direction of travel). Below that it stops and rejects exactly as
before, so a descending ramp never turns down a perpendicular cross street —
which would look worse than drawing nothing. The degree-2 path is untouched,
making this strictly additive: it can add solved bridges, never alter one
that already solved.

**Measured recovery** (same census script, re-run):

| view | solve rate before | after |
| --- | --- | --- |
| Gamla Stan z15 | 4.5% | **12.4%** |
| Gamla Stan z14 | 7.3% | **12.7%** |
| Gamla Stan z13.6 | 14.6% | **20.4%** |
| Amsterdam z15 | 21.7% | **46.4%** |
| Amsterdam z14 | 26.1% | **56.8%** |
| Amsterdam z13.6 | 29.5% | **57.0%** |
| Manhattan z14 | 27.9% | **34.9%** |

Across the four heaviest views, total rejections fell from 702 to 310 — a 56%
reduction. Junction-attributed rejects fell from 78.4% to 57.4% of what
remains, and dead-end approaches (an approach that simply stops short, with
nothing to continue onto) are now the largest remaining category at 40.3%.

Caveat on the 78.4% figure: those 981 rejections collapse to 222 distinct
`(walked, required, residual)` signatures, so it counts *edges*, not
independent sites. That is exactly why recovery was measured by re-running
rather than predicted from the reject share.

**Patch geometry for genuinely branching decks was not built**, and on this
evidence should not be until a measurement shows branching decks are a
material share of what remains.

## Testing

Unit tests only; all geometry here is pure and offline.

- miter: exact `7/cos(45°) = 9.899 m` at a 90° corner; bounded at a hairpin
- shading: wall normals agree at shared positions on a curve, per face family
- section: crown below kerb top, every vertex inside the edge/soffit envelope
- LOD: `"slab"` reproduces the original two-height, 28-triangle topology
- rails: every course present, nothing in the gaps between them
- markings: dash pattern produces the expected gap; paint faces up and stays
  within the kerb envelope
- junctions: an approach runs straight through a side-road junction and now
  solves; an approach whose only continuations are perpendicular still
  rejects (the guard against "render everything, badly")

Suite: 154 tests across 12 files, `tsc -b` clean, `vite build` succeeds.

## Explicitly not done

- **Browser verification of any of the new geometry.** Every claim here is
  geometric and unit-tested; none of it has been looked at on screen.
- Terrain-on coverage (no DEM tiles committed; San Francisco/Chamonix)
- A true pre-B1–B4 performance baseline
- Superelevation (banking) through curves
- The full coupled multi-branch junction solve
