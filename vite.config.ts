import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_VECTOR_TILEJSON = "https://tiles.openfreemap.org/planet";

/**
 * MapLibre cannot request a single tile until the TileJSON resolves, so that
 * request sits on the critical path behind bundle parse and map construction.
 * Preloading it (and warming the connection it rides on) starts it while the
 * bundle is still downloading. Resolved from the same env override `style.ts`
 * reads, so pointing the app at a local fixture server does not leave a
 * preload pointing at the public host.
 */
function tilePreload(tilejson: string): Plugin {
  return {
    name: "tile-preload",
    transformIndexHtml: () => [
      {
        tag: "link",
        attrs: {
          rel: "preconnect",
          href: new URL(tilejson, "http://localhost").origin,
          crossorigin: "",
        },
        injectTo: "head-prepend" as const,
      },
      {
        tag: "link",
        attrs: { rel: "preload", as: "fetch", href: tilejson, crossorigin: "" },
        injectTo: "head-prepend" as const,
      },
    ],
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tilePreload(
      loadEnv(mode, ".", "VITE_").VITE_VECTOR_TILEJSON ||
        DEFAULT_VECTOR_TILEJSON,
    ),
  ],
    server: {
    host: true,
    allowedHosts: true,
    forwardConsole: {
      unhandledErrors: true,
      logLevels: ['verbose', 'info', 'warn', 'error'],
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('maplibre-gl') || id.includes('react-map-gl/maplibre')) return 'map-engine';
          if (id.includes('three') || id.includes('@react-three/fiber') || id.includes('react-three-map/maplibre')) return 'three-engine';
          return null;
        },
      },
    },
  },
}));
