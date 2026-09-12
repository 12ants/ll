import { useLayoutEffect, useRef } from "react";
import { BufferAttribute, type BufferGeometry } from "three";
import type { BridgeMeshEntry } from "./details-data";

/**
 * Renders one indexed R3F mesh per published bridge (see
 * `details-data.ts`'s `collectReadyBridgeSurfaces`/`buildBridgeMesh`). Each
 * bridge keeps its own geometry rather than a merged buffer, matching the
 * plan's "keep bridge IDs with publication metadata so fallback ownership
 * can be updated atomically" — a bridge that stops solving (config or view
 * change) simply disappears from `entries` and React unmounts its `<mesh>`,
 * disposing that geometry alone.
 */
function BridgeMesh({ entry }: { entry: BridgeMeshEntry }) {
  const geometryRef = useRef<BufferGeometry>(null);
  useLayoutEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    const { positions, normals, indices } = entry.mesh;
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
  }, [entry.mesh]);
  if (entry.mesh.indices.length === 0) return null;
  return (
    <mesh castShadow receiveShadow>
      <bufferGeometry ref={geometryRef} />
      <meshStandardMaterial color={entry.color} roughness={0.75} />
    </mesh>
  );
}

export function BridgeMeshes({ entries }: { entries: BridgeMeshEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      {entries.map((entry, i) => (
        <BridgeMesh key={i} entry={entry} />
      ))}
    </>
  );
}
