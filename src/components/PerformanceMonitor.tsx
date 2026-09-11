import { usePerf } from "r3f-perf";

export { PerfHeadless as PerformanceSampler } from "r3f-perf";

// Keep diagnostics in the editor's DOM tree. The package's graphical UI
// creates another WebGL canvas whose asynchronous setup can outlive a toggle.
export default function PerformanceMonitor() {
  const log = usePerf((state) => state.log);
  const gl = usePerf((state) => state.gl);
  const metric = (value: unknown, digits = 1) =>
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(digits)
      : "—";

  return (
    <aside className="performance-monitor chrome" aria-label="Performance statistics">
      <strong>R3F details</strong>
      <dl>
        <div><dt>FPS</dt><dd>{metric(log?.fps, 0)}</dd></div>
        <div><dt>CPU</dt><dd>{metric(log?.cpu)} ms</dd></div>
        <div><dt>GPU</dt><dd>{metric(log?.gpu)} ms</dd></div>
        <div><dt>Draw calls</dt><dd>{metric(gl?.info.render.calls, 0)}</dd></div>
      </dl>
    </aside>
  );
}
