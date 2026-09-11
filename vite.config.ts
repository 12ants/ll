import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
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
});
