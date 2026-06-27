import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api is proxied to server.js, which holds RIOT_API_KEY server-side and
// talks to riotgames.com — the browser never sees the key or calls Riot
// directly (same pattern as league/vite.config.ts -> league/server.js).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:51791",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
