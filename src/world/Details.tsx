import { useMap } from 'react-three-map/maplibre';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { useDetectGPU } from "@react-three/drei";
import { Color, InstancedMesh, Object3D } from "three";
import type { Detail, WorldDetails } from "./details-data";
import { QUALITY, type WorldConfig } from "./config";
import type { StructurePart } from "./structures";
const Perf = lazy(() => import("r3f-perf").then((m) => ({ default: m.Perf })));
const temp = new Object3D(),
  color = new Color();
function Instances({
  data,
  kind,
}: {
  data: Detail[];
  kind: "canopy" | "trunk" | "seat" | "legs" | "bin";
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    data.forEach((d, i) => {
      const [x, y, z] = d.position,
        s = d.scale;
      temp.position.set(
        x,
        y +
          (kind === "canopy"
            ? 7.5 * s
            : kind === "trunk"
              ? 2.5 * s
              : kind === "seat"
                ? 0.6
                : kind === "bin"
                  ? 0.55
                  : 0.3),
        z,
      );
      temp.rotation.set(0, d.rotation, 0);
      if (kind === "canopy") temp.scale.set(3.8 * s, 4.5 * s, 3.5 * s);
      else if (kind === "trunk") temp.scale.set(0.35 * s, 5 * s, 0.35 * s);
      else if (kind === "seat") temp.scale.set(2, 0.16, 0.65);
      else if (kind === "bin") {
        temp.position.x += 2;
        temp.scale.set(0.5, 1.1, 0.5);
      } else temp.scale.set(1.5, 0.6, 0.4);
      temp.updateMatrix();
      mesh.setMatrixAt(i, temp.matrix);
      if (kind === "canopy")
        color.setHSL(
          0.22 + d.tone * 0.045,
          0.19 + d.tone * 0.09,
          0.29 + d.tone * 0.09,
        );
      else
        color.set(
          kind === "trunk"
            ? "#71604a"
            : kind === "seat"
              ? "#a08b66"
              : "#626b5b",
        );
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [data, kind]);
  if (!data.length) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, data.length]}
      frustumCulled={false}
    >
      {kind === "canopy" ? (
        <icosahedronGeometry args={[1, 1]} />
      ) : kind === "trunk" || kind === "bin" ? (
        <cylinderGeometry args={[1, 1, 1, 6]} />
      ) : (
        <boxGeometry />
      )}
      <meshStandardMaterial roughness={0.95} />
    </instancedMesh>
  );
}
function Structures({ parts }: { parts: StructurePart[] }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    parts.forEach((p, i) => {
      temp.position.set(...p.position);
      temp.rotation.set(0, p.rotation, 0);
      temp.scale.set(...p.scale);
      temp.updateMatrix();
      mesh.setMatrixAt(i, temp.matrix);
      mesh.setColorAt(i, color.set(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts]);
  return parts.length ? (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, parts.length]}
      frustumCulled={false}
    >
      <boxGeometry />
      <meshStandardMaterial roughness={0.65} />
    </instancedMesh>
  ) : null;
}
function DeviceHint({ onTier }: { onTier: (tier: number) => void }) {
  const gpu = useDetectGPU();
  useLayoutEffect(() => onTier(gpu.tier), [gpu.tier, onTier]);
  return null;
}
export function Details({
  data,
  config,
  profile,
  onTier,
}: {
  data: WorldDetails;
  config: WorldConfig;
  profile: boolean;
  onTier: (tier: number) => void;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const map=useMap();
  const get=useThree(s=>s.get);
  useEffect(()=>{
    let disposed=false;
    const sync=()=>queueMicrotask(()=>{
      if(disposed)return;
      const ratio=Math.min(window.devicePixelRatio||1,QUALITY[config.quality].dpr);
      const store=get();
      if(store.viewport.dpr!==ratio)store.setDpr(ratio);
    });
    map.on('resize',sync);sync();
    return()=>{disposed=true;map.off('resize',sync)};
  },[map,config.quality,get]);
  useLayoutEffect(() => invalidate(), [data, config, profile, invalidate]);
  const sun = useMemo(() => {
    const a = ((config.hour - 6) / 14) * Math.PI;
    return [Math.cos(a) * 1000, Math.sin(a) * 900, 500] as [
      number,
      number,
      number,
    ];
  }, [config.hour]);
  return (
    <>
      <hemisphereLight args={["#fff7e5", "#77806a", 2.0]} />
      <directionalLight
        position={sun}
        intensity={config.hour > 18 ? 1 : 2.5}
        color={config.hour > 17 ? "#ffcf9b" : "#fff2d5"}
      />
      <Structures parts={data.structures} />
      <Instances data={data.trees} kind="canopy" />
      <Instances data={data.trees} kind="trunk" />
      <Instances data={data.benches} kind="seat" />
      <Instances data={data.benches} kind="legs" />
      <Instances data={data.benches} kind="bin" />
      <Suspense fallback={null}>
        <DeviceHint onTier={onTier} />
        {profile && <Perf position="bottom-left" minimal antialias={false} />}
      </Suspense>
    </>
  );
}
