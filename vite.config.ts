import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built game works from any static host subpath.
  base: "./",
  server: {
    host: true,
    port: 5173,
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
        "mysql2",
        "mysql2/promise",
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
