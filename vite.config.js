import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // In dev, forward API calls to a locally running server.cjs (npm start).
    // If it isn't running, the health handshake fails and the app just uses
    // localStorage — same as before.
    proxy: {
      "/api": "http://localhost:8420",
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // recharts and papaparse are already deferred behind React.lazy()/dynamic
        // import() (see src/App.jsx), so Rollup already splits them out of the
        // main chunk on its own - this just gives each vendor library its own
        // named, independently cacheable chunk instead of an anonymous one.
        manualChunks: {
          recharts: ["recharts"],
          papaparse: ["papaparse"],
        },
      },
    },
  },
  // Relative paths so the built site works from any subfolder or reverse proxy path.
  base: "./",
});
