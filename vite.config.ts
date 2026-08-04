import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built game works from any static host subpath.
  base: "./",
  // Inject the game server URL at build time. Set VITE_GAME_SERVER_URL in
  // .env or the shell to make the client talk to a remote server (e.g.
  // Omega). An empty string means same-origin (single-process hosting).
  define: {
    __GAME_SERVER_URL__: JSON.stringify(process.env.VITE_GAME_SERVER_URL ?? ""),
    __MAINTENANCE__: JSON.stringify(process.env.VITE_MAINTENANCE ?? "true"),
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Dev: forward /api/* to the Node game server so the client can use
      // relative URLs everywhere. Production hosts the API on the same origin
      // — no proxy needed.
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Phase 2 — WebSocket game server (ws://host/ws → game server).
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
  build: {
    target: "es2022",
    // Phaser is a single large bundle; raise the warning threshold deliberately.
    chunkSizeWarningLimit: 2500,
    // The server (Node-only) is intentionally excluded from the client bundle.
    rollupOptions: {
      input: "index.html",
      external: [
        /^node:.*/,
        "bcryptjs",
        "jose",
        "uuid",
        // Server entry points — never bundled into the browser build.
        /^\/server\/.*/,
        /^\.\.?\/server\/.*/,
      ],
    },
  },
});
