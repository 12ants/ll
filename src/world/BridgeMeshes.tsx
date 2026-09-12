import { useLayoutEffect, useRef } from "react";
import { BufferAttribute, type BufferGeometry } from "three";
import type { BridgeMeshEntry } from "./details-data";
import type { BridgeMeshData } from "./bridge-model";
import { ACCESSORY_COLOR } from "./bridge-boundaries";

/**
 * Renders one indexed R3F mesh from a `BridgeMeshData` buffer — shared by
 * both the deck (`buildBridgeMesh`) and the optional rail strip
 * (`buildRailMesh`, B4), since both are the same flat position/normal/index
 * shape. A bridge (or its rail alone, once B4's triangle budget drops it —
 * see `details-data.ts`) that stops solving simply disappears from `entries`
 * next render and React/R3F disposes that geometry alone.
 */
function MeshBuffer({ data, color }: { data: BridgeMeshData; color: string }) {
  const geometryRef = useRef<BufferGeometry>(null);
  useLayoutEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    const { positions, normals, indices } = data;
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
  }, [data]);
  if (data.indices.length === 0) return null;
  return (
    <mesh castShadow receiveShadow>
      <bufferGeometry ref={geometryRef} />
      <meshStandardMaterial color={color} roughness={0.75} />
    </mesh>
  );
}

export function BridgeMeshes({ entries }: { entries: BridgeMeshEntry[] }) {
  if (!entries.length) return null;
  return (
    <>
      {entries.map((entry, i) => (
        <MeshBuffer key={`deck-${i}`} data={entry.mesh} color={entry.color} />
      ))}
      {entries.map(
        (entry, i) =>
          entry.rail && <MeshBuffer key={`rail-${i}`} data={entry.rail} color={ACCESSORY_COLOR} />,
      )}
    </>
  );
}
