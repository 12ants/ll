import { useState, type ReactNode } from "react";
import {
  Building2,
  Trees,
  Mountain,
  Sun,
  SlidersHorizontal,
  ChevronDown,
  Gauge,
  RotateCcw,
  Waves,
  Route,
  Box,
  Shuffle,
  Activity,
} from "lucide-react";
import { PALETTES, useWorld, type WorldConfig } from "../world/config";

function Section({
  icon,
  title,
  children,
  defaultOpen = true,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>
        <span className="section-icon">{icon}</span>
        {title}
        <ChevronDown size={14} />
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
function Toggle({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  format?: (n: number) => string;
}) {
  return (
    <label className="slider-row">
      <span>
        {label}
        <output>{format ? format(value) : value.toFixed(1) + "×"}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={
          {
            "--progress": `${((value - min) / (max - min)) * 100}%`,
          } as React.CSSProperties
        }
      />
    </label>
  );
}
const percent = (n: number) => Math.round(n * 100) + "%";
export function Inspector({
  profile,
  setProfile,
  onReset,
  onClose,
}: {
  profile: boolean;
  setProfile: (v: boolean) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const c = useWorld((s) => s.config),
    update = useWorld((s) => s.update);
  const [tab, setTab] = useState<"world" | "atmosphere" | "render">("world");
  function change<K extends keyof WorldConfig>(key: K, value: WorldConfig[K]) {
    update({ [key]: value });
  }
  return (
    <aside className="inspector" aria-label="World settings">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2>World settings</h2>
        </div>
        <button
          className="icon-button"
          title="Close settings"
          aria-label="Close settings"
          onClick={onClose}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="Settings categories">
        {(["world", "atmosphere", "render"] as const).map((t, i) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {[<Box size={14} />, <Sun size={14} />, <Gauge size={14} />][i]}
            {t === "world"
              ? "World"
              : t === "atmosphere"
                ? "Atmosphere"
                : "Render"}
          </button>
        ))}
      </div>
      <div className="inspector-scroll">
        {tab === "world" && (
          <>
            <Section icon={<Building2 size={17} />} title="Architecture">
              <Toggle
                label="3D buildings"
                checked={c.buildings}
                onChange={(v) => change("buildings", v)}
              />
              <Toggle
                label="Facade & rooftop details"
                checked={c.facades}
                onChange={(v) => change("facades", v)}
              />
              <Slider
                label="Building height"
                value={c.heightScale}
                min={0.2}
                max={2.5}
                onChange={(v) => change("heightScale", v)}
              />
              <Slider
                label="Natural variation"
                value={c.variation}
                min={0}
                max={1}
                onChange={(v) => change("variation", v)}
                format={percent}
              />
              <label className="field-label">Material palette</label>
              <div className="palette-options">
                {Object.entries(PALETTES).map(([key, p]) => (
                  <button
                    key={key}
                    title={p.name}
                    aria-label={p.name}
                    aria-pressed={c.palette === key}
                    className={`palette ${c.palette === key ? "selected" : ""}`}
                    onClick={() =>
                      change("palette", key as WorldConfig["palette"])
                    }
                  >
                    {p.colors.slice(0, 4).map((color) => (
                      <span key={color} style={{ background: color }} />
                    ))}
                  </button>
                ))}
              </div>
              <p className="value-caption">
                {PALETTES[c.palette].name}
                <span>●</span>
              </p>
            </Section>
            <Section icon={<Trees size={17} />} title="Nature & landscape">
              <Toggle
                label="Parks & green spaces"
                checked={c.parks}
                onChange={(v) => change("parks", v)}
              />
              <Toggle
                label="3D vegetation"
                checked={c.trees}
                onChange={(v) => change("trees", v)}
              />
              <Slider
                label="Tree density"
                value={c.treeDensity}
                min={0}
                max={1}
                onChange={(v) => change("treeDensity", v)}
                format={percent}
              />
              <label className="color-row">
                <span>
                  <Waves size={15} />
                  Water color
                </span>
                <input
                  aria-label="Water color"
                  type="color"
                  value={c.waterColor}
                  onChange={(e) => change("waterColor", e.target.value)}
                />
              </label>
            </Section>
            <Section icon={<Route size={17} />} title="Streets & details">
              <Toggle
                label="Surface roads & paths"
                checked={c.roads}
                onChange={(v) => change("roads", v)}
              />
              <Toggle
                label="Bridges"
                checked={c.bridges}
                onChange={(v) => change("bridges", v)}
              />
              <Toggle
                label="Park amenities"
                checked={c.amenities}
                onChange={(v) => change("amenities", v)}
                description="Benches & litter bins"
              />
              <button
                className="text-button"
                onClick={() => change("seed", (c.seed + 1) % 1000000)}
              >
                <Shuffle size={13} />
                Regenerate natural details<span>#{c.seed}</span>
              </button>
            </Section>
            <Section icon={<Mountain size={17} />} title="Terrain">
              <Toggle
                label="Real elevation"
                checked={c.terrain}
                onChange={(v) => change("terrain", v)}
              />
              {c.terrain && (
                <Slider
                  label="Elevation scale"
                  value={c.exaggeration}
                  min={0}
                  max={3}
                  onChange={(v) => change("exaggeration", v)}
                />
              )}
              <p className="help-text">
                Global elevation data brings mountains, hills, and valleys into
                your world.
              </p>
            </Section>
          </>
        )}
        {tab === "atmosphere" && (
          <>
            <div className="sun-card">
              <Sun size={40} strokeWidth={1} />
              <span>
                {c.hour < 10
                  ? "Morning light"
                  : c.hour < 16
                    ? "Daylight"
                    : c.hour < 19
                      ? "Golden afternoon"
                      : "Evening light"}
              </span>
              <strong>
                {Math.floor(c.hour).toString().padStart(2, "0")}:
                {Math.round((c.hour % 1) * 60)
                  .toString()
                  .padStart(2, "0")}
              </strong>
              <div className="sun-arc" />
            </div>
            <Section icon={<Sun size={17} />} title="Daylight">
              <Slider
                label="Time of day"
                value={c.hour}
                min={6}
                max={20}
                step={0.25}
                onChange={(v) => change("hour", v)}
                format={(n) =>
                  `${Math.floor(n)}:${Math.round((n % 1) * 60)
                    .toString()
                    .padStart(2, "0")}`
                }
              />
              <div className="quick-times">
                {[8, 12, 16, 18.5].map((h, i) => (
                  <button
                    key={h}
                    className={c.hour === h ? "selected" : ""}
                    onClick={() => change("hour", h)}
                  >
                    {["Morning", "Noon", "Afternoon", "Golden"][i]}
                  </button>
                ))}
              </div>
              <p className="help-text">
                Changes sun direction, intensity, and the warmth of building and
                vegetation materials.
              </p>
            </Section>
            <div className="inspector-note">
              <span className="note-dot" />A quieter kind of world
              <p>
                Natural materials. Real geography.
                <br />
                No labels to break the immersion.
              </p>
            </div>
          </>
        )}
        {tab === "render" && (
          <>
            <Section icon={<Gauge size={17} />} title="Performance">
              <label className="field-label">Quality preset</label>
              <div className="quality-options">
                {(["eco", "balanced", "high"] as const).map((q) => (
                  <button
                    className={c.quality === q ? "selected" : ""}
                    onClick={() => change("quality", q)}
                    key={q}
                  >
                    {q === "eco"
                      ? "Eco"
                      : q === "balanced"
                        ? "Balanced"
                        : "High"}
                  </button>
                ))}
              </div>
              <p className="help-text">
                {c.quality === "eco"
                  ? "1× resolution · up to 500 trees · 850 m detail radius"
                  : c.quality === "balanced"
                    ? "1.5× resolution · up to 1,800 trees · 1.25 km detail radius"
                    : "2× resolution · up to 3,600 trees · 1.8 km detail radius"}
              </p>
              <div className="render-feature">
                <span className="note-dot" />
                On-demand rendering<span>Active</span>
              </div>
              <div className="render-feature">
                <span className="note-dot" />
                Instanced vegetation<span>Active</span>
              </div>
              <div className="render-feature">
                <span className="note-dot" />
                Streamed vector tiles<span>Active</span>
              </div>
            </Section>
            <Section icon={<Activity size={17} />} title="Diagnostics">
              <Toggle
                label="Performance monitor"
                description="Live R3F frame & GPU statistics"
                checked={profile}
                onChange={setProfile}
              />
              <p className="help-text">
                The monitor enables continuous rendering while open. Its draw
                statistics cover the R3F details, not MapLibre’s full scene.
              </p>
            </Section>
          </>
        )}
      </div>
      <div className="inspector-footer">
        <span>
          <span className="live-dot" />
          Changes apply live
        </span>
        <button
          title="Reset world settings"
          aria-label="Reset world settings"
          onClick={onReset}
        >
          <RotateCcw size={14} />
          Reset
        </button>
      </div>
    </aside>
  );
}
