import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built game works from any static host subpath.
  base: "./",
  // Build-time fallback defines — used only when client-config.txt is
  // absent (local dev). Production reads client-config.txt at boot.
  define: {
    __GAME_SERVER_URL__: JSON.stringify(""),
    __MAINTENANCE__: JSON.stringify("true"),
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
    // Assets land under /static/ (not /assets/): the ASHAT Hub server config
    // globally aliases /assets/ (and /css/, /js/, /images/) to the Hub's own
    // public dir on every vhost, which would hijack game asset requests and
    // SPA-fallback them to index.html. "static" is untouched by those aliases.
    assetsDir: "static",
    // Keep the 36x36 courier frames as cacheable files instead of inlining
    // hundreds of tiny images into the Phaser bundle.
    assetsInlineLimit: 0,
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
