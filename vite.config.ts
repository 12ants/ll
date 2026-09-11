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
        manualChunks: {
          "map-engine": ["maplibre-gl", "react-map-gl/maplibre"],
          "three-engine": [
            "three",
            "@react-three/fiber",
            "react-three-map/maplibre",
          ],
        },
      },
    },
  },
});
