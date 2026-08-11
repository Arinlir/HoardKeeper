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
  },
  // Relative paths so the built site works from any subfolder or reverse proxy path.
  base: "./",
});
