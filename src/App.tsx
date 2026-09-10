import { wrapLongitude } from './world/geography';
import {
  Component,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import {
  Mountain,
  ChevronDown,
  ArrowUpRight,
  Plus,
  Minus,
  Compass,
  LocateFixed,
  SlidersHorizontal,
  Camera,
  Download,
  Upload,
  Check,
  X,
  Play,
  Pause,
  Maximize,
  Minimize,
  MapPin,
  Layers3,
  Keyboard,
  ArrowRight,
  Building2,
  Waves,
  Save,
} from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { WorldMap, type MapStatus } from "./world/WorldMap";
import { Inspector } from "./components/Inspector";
import { DEFAULT_CONFIG, PLACES, parseConfig, useWorld } from "./world/config";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
class WorldBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="world-error">
        <Mountain size={40} />
        <h2>The world could not start</h2>
        <p>
          Enable WebGL and hardware acceleration in your browser, then try
          again.
        </p>
        <button onClick={() => location.reload()}>Reload world</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const config = useWorld((s) => s.config),
    update = useWorld((s) => s.update),
    replace = useWorld((s) => s.replace),
    save = useWorld((s) => s.save);
  const [inspector, setInspector] = useState(true),
    [places, setPlaces] = useState(false),
    [profile, setProfile] = useState(false),
    [orbit, setOrbit] = useState(false),
    [focus, setFocus] = useState(false),
    [help, setHelp] = useState(false);
  const [toast, setToast] = useState(""),
    [coordinates, setCoordinates] = useState(""),
    [coordinateError, setCoordinateError] = useState("");
  const [status, setStatus] = useState<MapStatus>({
    ready: false,
    loading: true,
    trees: 0,
    benches: 0,
    zoom: config.zoom,
    longitude: config.longitude,
    latitude: config.latitude,
    bearing: config.bearing,
  });
  const mapRef = useRef<MapLibreMap | null>(null),
    fileRef = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const place = PLACES.find((p) => p.id === config.place);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);
  const onReady = useCallback((map: MapLibreMap) => {
    mapRef.current = map;
  }, []);
  const cameraConfig = useCallback(() => {
    const map = mapRef.current;
    if (!map) return config;
    const center = map.getCenter();
    return {
      ...config,
      longitude: wrapLongitude(center.lng),
      latitude: center.lat,
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
  }, [config]);
  function selectPlace(p: (typeof PLACES)[number]) {
    setOrbit(false);
    update({
      place: p.id,
      longitude: p.longitude,
      latitude: p.latitude,
      zoom: p.zoom,
      pitch: p.pitch,
      bearing: p.bearing,
      terrain: p.terrain,
    });
    mapRef.current?.flyTo({
      center: [p.longitude, p.latitude],
      zoom: p.zoom,
      pitch: p.pitch,
      bearing: p.bearing,
      duration: 2300,
      essential: false,
    });
    setPlaces(false);
  }
  function reset() {
    replace(DEFAULT_CONFIG);
    setOrbit(false);
    mapRef.current?.flyTo({
      center: [DEFAULT_CONFIG.longitude, DEFAULT_CONFIG.latitude],
      zoom: DEFAULT_CONFIG.zoom,
      pitch: DEFAULT_CONFIG.pitch,
      bearing: DEFAULT_CONFIG.bearing,
    });
    notify("World restored to its starting point");
  }
  function goCoordinates(e: React.FormEvent) {
    e.preventDefault();
    const parts = coordinates.split(",").map((s) => s.trim());
    const [lat, lng] = parts.map(Number);
    if (
      parts.length !== 2 ||
      parts.some((s) => !s) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 85 ||
      Math.abs(lng) > 180
    ) {
      setCoordinateError("Enter latitude, longitude. Example: 48.8584, 2.2945");
      return;
    }
    setCoordinateError("");
    setOrbit(false);
    update({ place: "custom", latitude: lat, longitude: lng });
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: 15.5,
      pitch: 60,
      duration: 2000,
    });
    setPlaces(false);
  }
  const capture = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.once("render", () =>
      map.getCanvas().toBlob((blob) => {
        if (blob) {
          download(blob, "terrene-world.png");
          notify("World image exported");
        } else notify("Could not capture this frame. Please try again.");
      }, "image/png"),
    );
    map.triggerRepaint();
  }, [notify]);
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 64000)
        throw new Error("World files must be smaller than 64 KB.");
      const next = parseConfig(await file.text());
      replace(next);
      setOrbit(false);
      mapRef.current?.flyTo({
        center: [next.longitude, next.latitude],
        zoom: next.zoom,
        pitch: next.pitch,
        bearing: next.bearing,
      });
      notify("World configuration imported");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not read world file.");
    }
    if (fileRef.current) fileRef.current.value = "";
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "Escape") {
        setFocus(false);
        setPlaces(false);
        setHelp(false);
        setOrbit(false);
      }
      if (e.key.toLowerCase() === "h") setFocus((v) => !v);
      if (e.key.toLowerCase() === "o") setOrbit((v) => !v);
      if (e.key.toLowerCase() === "p") capture();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [capture]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  return (
    <main
      className={`app ${focus ? "focus-mode" : ""} ${inspector ? "inspector-open" : ""}`}
    >
      <div
        className="world-canvas"
        aria-label="Interactive 3D geographic world"
      >
        <WorldBoundary>
          <WorldMap
            config={config}
            profile={profile}
            orbit={orbit}
            onReady={onReady}
            onStatus={setStatus}
          />
        </WorldBoundary>
      </div>
      <header className="topbar chrome">
        <a className="brand" href="/" aria-label="Terrene home">
          <span className="brand-mark">
            <Mountain size={24} strokeWidth={1.5} />
          </span>
          <span>
            terrene<span className="brand-dot">.</span>
          </span>
          <small>WORLD STUDIO</small>
        </a>
        <div className="topbar-right">
          <span className="project-title">
            Untitled world
            <span className="unsaved-dot" title="Local world" />
          </span>
          <button
            className="quiet-button"
            onClick={() => {
              try {
                replace(cameraConfig());
                save();
                notify("World saved in this browser");
              } catch {
                notify(
                  "Browser storage is unavailable. Export your world instead.",
                );
              }
            }}
          >
            <Save size={15} />
            <span>Save world</span>
          </button>
          <button
            className="primary-button"
            onClick={() => {
              download(
                new Blob([JSON.stringify(cameraConfig(), null, 2)], {
                  type: "application/json",
                }),
                "terrene-world.json",
              );
              notify("World configuration exported");
            }}
          >
            <Download size={15} />
            <span>Export</span>
            <ArrowUpRight size={13} />
          </button>
        </div>
      </header>
      <div className="location-control chrome">
        <button
          className={`place-trigger ${places ? "active" : ""}`}
          onClick={() => setPlaces(!places)}
          aria-expanded={places}
        >
          <span className="location-icon">
            <MapPin size={19} />
          </span>
          <span>
            <strong>{place?.name ?? "Custom location"}</strong>
            <small>
              {place?.region ??
                `${config.latitude.toFixed(4)}°, ${config.longitude.toFixed(4)}°`}
            </small>
          </span>
          <ChevronDown size={16} />
        </button>
        <span className="world-badge">
          <span className="live-dot" />
          REAL-WORLD DATA
        </span>
        {places && (
          <div className="places-menu">
            <div className="menu-heading">
              <span className="eyebrow">A WORLD TO EXPLORE</span>
              <button
                aria-label="Close locations"
                onClick={() => setPlaces(false)}
              >
                <X size={16} />
              </button>
            </div>
            {PLACES.map((p) => (
              <button
                key={p.id}
                className={`place-option ${config.place === p.id ? "selected" : ""}`}
                onClick={() => selectPlace(p)}
              >
                <span className={`place-preview ${p.icon}`}>
                  {p.icon === "city" ? (
                    <Building2 />
                  ) : p.icon === "mountain" ? (
                    <Mountain />
                  ) : (
                    <Waves />
                  )}
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.type}</small>
                </span>
                {config.place === p.id ? (
                  <Check size={16} />
                ) : (
                  <ArrowUpRight size={14} />
                )}
              </button>
            ))}
            <form className="coordinates-form" onSubmit={goCoordinates}>
              <label htmlFor="coordinates">Go to coordinates</label>
              <div>
                <input
                  id="coordinates"
                  placeholder="Latitude, longitude"
                  value={coordinates}
                  onChange={(e) => setCoordinates(e.target.value)}
                />
                <button aria-label="Go to coordinates">
                  <ArrowRight size={16} />
                </button>
              </div>
              {coordinateError && <p role="alert">{coordinateError}</p>}
            </form>
          </div>
        )}
      </div>
      {!focus && inspector && (
        <Inspector
          profile={profile}
          setProfile={setProfile}
          onReset={reset}
          onClose={() => setInspector(false)}
        />
      )}
      {!inspector && !focus && (
        <button
          className="reopen-settings icon-button chrome"
          aria-label="Open world settings"
          onClick={() => setInspector(true)}
        >
          <SlidersHorizontal size={19} />
        </button>
      )}
      <div className="world-caption chrome">
        <span className="caption-line" />
        <span>THE WORLD, REIMAGINED.</span>
        <p>A little closer to somewhere real.</p>
      </div>
      <div className="map-tools">
        <div className="tool-group">
          <button
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => mapRef.current?.zoomIn()}
          >
            <Plus size={18} />
          </button>
          <button
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => mapRef.current?.zoomOut()}
          >
            <Minus size={18} />
          </button>
          <span />
          <button
            title="Reset north"
            aria-label="Reset north"
            onClick={() => mapRef.current?.easeTo({ bearing: 0, pitch: 60 })}
          >
            <Compass
              size={19}
              style={{ transform: `rotate(${-status.bearing}deg)` }}
            />
          </button>
          <button
            title="Return to location"
            aria-label="Return to location"
            onClick={() =>
              mapRef.current?.flyTo({
                center: [config.longitude, config.latitude],
                zoom: config.zoom,
                pitch: config.pitch,
                bearing: config.bearing,
              })
            }
          >
            <LocateFixed size={18} />
          </button>
        </div>
        <div className="tool-group">
          <button
            title="Capture world (P)"
            aria-label="Capture world"
            onClick={capture}
          >
            <Camera size={18} />
          </button>
          <button
            title="Focus mode (H)"
            aria-label={focus ? "Exit focus mode" : "Enter focus mode"}
            onClick={() => setFocus(!focus)}
          >
            {focus ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
      <div className="bottom-controls chrome">
        <button
          className={`orbit-button ${orbit ? "active" : ""}`}
          onClick={() => setOrbit(!orbit)}
        >
          {orbit ? (
            <Pause size={13} fill="currentColor" />
          ) : (
            <Play size={13} fill="currentColor" />
          )}
          {orbit ? "Pause orbit" : "Orbit world"}
          <kbd>O</kbd>
        </button>
        <span className="navigation-hint">
          Drag to explore<span>·</span>Right-drag to tilt
        </span>
      </div>
      <footer className="statusbar chrome">
        <div>
          <span className={`live-dot ${status.loading ? "loading" : ""}`} />
          {!status.ready
            ? "Preparing your world"
            : status.loading
              ? "Streaming landscape"
              : "World is live"}
          <span className="status-divider" />
          <span>
            <TreesIcon />
            {status.trees.toLocaleString()} trees
          </span>
          <span className="desktop-status">
            <Layers3 size={12} />
            {config.terrain ? "3D terrain" : "Flat terrain"}
          </span>
        </div>
        <div className="status-coords">
          {status.latitude.toFixed(4)}° {status.latitude >= 0 ? "N" : "S"}
          <span> / </span>
          {Math.abs(status.longitude).toFixed(4)}°{" "}
          {status.longitude >= 0 ? "E" : "W"}
          <span className="status-divider" />
          <span>z {status.zoom.toFixed(1)}</span>
        </div>
        <div>
          <button
            title="Import world"
            aria-label="Import world"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={13} />
          </button>
          <button
            title="Keyboard & controls"
            aria-label="Keyboard and controls"
            onClick={() => setHelp(!help)}
          >
            <Keyboard size={15} />
          </button>
          <span className="quality-indicator">{config.quality}</span>
        </div>
      </footer>
      <input
        ref={fileRef}
        hidden
        type="file"
        accept=".json,application/json"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {!status.ready && (
        <div className="loading-card">
          <Mountain size={30} />
          <span>Finding your corner of the world…</span>
          <div className="loading-track" />
        </div>
      )}
      {status.error && (
        <div className="data-error" role="alert">
          {status.error}
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {help && (
        <div className="help-panel">
          <button
            className="help-close"
            aria-label="Close help"
            onClick={() => setHelp(false)}
          >
            <X size={16} />
          </button>
          <h3>Explore your world</h3>
          <p>
            <span>Move around</span>Drag
          </p>
          <p>
            <span>Orbit & tilt</span>Right-drag / Ctrl-drag
          </p>
          <p>
            <span>Zoom</span>Scroll / pinch
          </p>
          <p>
            <span>Automatic orbit</span>
            <kbd>O</kbd>
          </p>
          <p>
            <span>Focus mode</span>
            <kbd>H</kbd>
          </p>
          <p>
            <span>Capture image</span>
            <kbd>P</kbd>
          </p>
          <p>
            <span>Exit / stop orbit</span>
            <kbd>Esc</kbd>
          </p>
        </div>
      )}
    </main>
  );
}
function TreesIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
    >
      <path d="m8 1-5 9h10L8 1ZM8 10v5" />
    </svg>
  );
}
