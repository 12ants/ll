import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import Map, { type MapRef } from "react-map-gl/maplibre";
import { Canvas } from "react-three-map/maplibre";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
setWorkerUrl(workerUrl);
import { createWorldStyle } from "./style";
import { QUALITY, type WorldConfig } from "./config";
import { collectDetails, EMPTY_DETAILS } from "./details-data";
import { Details } from "./Details";
import "maplibre-gl/dist/maplibre-gl.css";
export interface MapStatus {
  ready: boolean;
  loading: boolean;
  trees: number;
  benches: number;
  zoom: number;
  latitude: number;
  longitude: number;
  bearing: number;
  tier?: number;
  error?: string;
}
interface Props {
  config: WorldConfig;
  profile: boolean;
  orbit: boolean;
  onReady: (map: MapLibreMap) => void;
  onStatus: (status: MapStatus) => void;
}
function WorldMapView({ config, profile, orbit, onReady, onStatus }: Props) {
  const ref = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState(EMPTY_DETAILS);
  const [tier, setTier] = useState<number>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const style = useMemo(() => createWorldStyle(config), [config]);
  const configRef = useRef(config);
  configRef.current = config;
  const styleRef = useRef(style);
  styleRef.current = style;
  // Keep the initial style stable: patch styles imperatively to preserve the R3F custom layer.
  const initialStyle = useRef(style);
  const previousStyle = useRef(initialStyle.current);
  const orbitRef = useRef(orbit); orbitRef.current = orbit;
  const tierCallback = useCallback((value: number) => setTier(value), []);
  useEffect(() => {
    if (!ready) return;
    const map = ref.current!.getMap();
    const next = styleRef.current;
    for (const layer of next.layers) {
      const previous = previousStyle.current.layers.find(item=>item.id===layer.id);
      if (!map.getLayer(layer.id)) continue;
      for (const [key, value] of Object.entries(layer.paint ?? {})) {
        if(JSON.stringify((previous?.paint as Record<string,unknown>)?.[key])===JSON.stringify(value))continue;
        map.setPaintProperty(
          layer.id,
          key as Parameters<MapLibreMap["setPaintProperty"]>[1],
          value,
        );
      }
      if (layer.layout && "visibility" in layer.layout)
        map.setLayoutProperty(layer.id, "visibility", layer.layout.visibility);
    }
    if(JSON.stringify(previousStyle.current.light)!==JSON.stringify(next.light))map.setLight(next.light!);
    if(JSON.stringify(previousStyle.current.terrain)!==JSON.stringify(next.terrain))map.setTerrain(
      config.terrain
        ? { source: "elevation", exaggeration: config.exaggeration }
        : null,
    );
    const ratio=Math.min(window.devicePixelRatio || 1, QUALITY[config.quality].dpr);
    if(map.getPixelRatio()!==ratio)map.setPixelRatio(ratio);
    previousStyle.current=next;
    map.setMaxZoom(19);
  }, [config, ready]);
  useEffect(() => {
    if (!ready) return;
    const map = ref.current!.getMap();
    let timer: ReturnType<typeof setTimeout> | undefined,
      disposed = false;
    const refresh = () => {
      if(orbitRef.current && timer)return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer=undefined;
        if (disposed || !map.isStyleLoaded() || map.isMoving()) return;
        setData(collectDetails(map, configRef.current));
        setLoading(false);
      }, orbitRef.current?1000:250);
    };
    const idle = () => {
      setLoading(false);
    };
    map.on("moveend", refresh);
    map.on("sourcedata", refresh);
    map.on("idle", idle);
    refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      map.off("moveend", refresh);
      map.off("sourcedata", refresh);
      map.off("idle", idle);
    };
  }, [
    ready,
    config.trees,
    config.parks,
    config.treeDensity,
    config.amenities,
    config.quality,
    config.terrain,
    config.exaggeration,
    config.seed,
    config.buildings,
    config.facades,
    config.heightScale,
    config.variation,
    config.roads,
    config.bridges,
  ]);
  useEffect(() => {
    const map = ref.current?.getMap();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const publish = () => {
      timer=undefined;
      const center = map?.getCenter()??{lat:configRef.current.latitude,lng:configRef.current.longitude};
      onStatus({
        ready,
        loading,
        trees: data.trees.length,
        benches: data.benches.length,
        zoom: map?.getZoom()??configRef.current.zoom,
        latitude: center.lat,
        longitude: center.lng,
        bearing: map?.getBearing()??configRef.current.bearing,
        tier,
        error,
      });
    };
    publish();
    const schedule=()=>{if(!timer)timer=setTimeout(publish,500)};
    map?.on("moveend", schedule);
    return () => {
      clearTimeout(timer);
      map?.off("moveend", schedule);
    };
  }, [ready, data, tier, error, loading, onStatus]);
  useEffect(() => {
    if (!orbit || !ready) return;
    const map = ref.current!.getMap();
    let frame = 0,
      last = performance.now();
    const tick = (now: number) => {
      map.setBearing(map.getBearing() + Math.min(100,now - last) * 0.002);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [orbit, ready]);
  return (
    <Map
      ref={ref}
      initialViewState={{
        longitude: config.longitude,
        latitude: config.latitude,
        zoom: config.zoom,
        pitch: config.pitch,
        bearing: config.bearing,
      }}
      mapStyle={initialStyle.current}
      minZoom={2}
      maxZoom={19}
      maxPitch={75}
      attributionControl={{ compact: true }}
      canvasContextAttributes={{ antialias: true }}
      maxTileCacheSize={QUALITY[config.quality].cache}
      fadeDuration={150}
      onLoad={() => {
        setReady(true);
        setLoading(false);
        onReady(ref.current!.getMap());
      }}
      onError={(event) => {
        const message = event.error.message;
        setError(
          message.includes("WebGL")
            ? "Your browser could not start WebGL. Enable hardware acceleration and reload."
            : "Some map data could not load. Check your connection, then reload to retry.",
        );
        console.warn("Map data:", message);
      }}
    >
      {ready && (
        <Canvas
          latitude={data.origin[1]}
          longitude={data.origin[0]}
          frameloop={profile ? "always" : "demand"}
          shadows
        >
          <Details
            data={data}
            config={config}
            profile={profile}
            onTier={tierCallback}
          />
        </Canvas>
      )}
    </Map>
  );
}

export const WorldMap=memo(WorldMapView);
