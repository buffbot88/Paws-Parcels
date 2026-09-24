import { readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

/**
 * Static file server for the built Phaser client (`dist/`). Serving the client
 * from the same Node process as the API + WebSocket lets ONE host run the
 * whole game — the client's relative `/api/*` and `ws://same-origin/ws` URLs
 * then just work (design/architecture.md §1). Dev still uses the Vite server
 * on :5173; this only matters for production deploys.
 */

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Create a request handler for `clientDir`. Returns true when the request was
 * handled (file served), false when it isn't a client file (caller keeps
 * routing — e.g. falls through to the API 404).
 */
export function createStaticClientServer(
  clientDir: string,
  mounts: Record<string, string> = {},
) {
  // Absolute, normalized roots so traversal checks can't be sidestepped.
  const root = resolve(clientDir);
  const mountedRoots = new Map(
    Object.entries(mounts).map(([prefix, directory]) => [prefix.replace(/\/+$/, ""), resolve(directory)]),
  );

  return function serveClientFile(
    req: IncomingMessage,
    res: ServerResponse,
  ): boolean {
    // Only GET/HEAD; WebSocket handshakes are handled by the WS upgrade
    // listener, never here.
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (req.headers.upgrade !== undefined) return false;

    let pathname: string;
    try {
      // URL normalizes dot-segments and strips the query string.
      // Decoded so asset names with spaces resolve; traversal checks below still apply.
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      return false;
    }

    const mount = [...mountedRoots.entries()].find(([prefix]) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    const mountRoot = mount?.[1] ?? root;
    const mountPath = mount === undefined ? pathname : pathname.slice(mount[0].length);
    // "/" → index.html; otherwise drop the leading slash.
    const rel = mountPath === "/" || mountPath === "" ? "index.html" : mountPath.replace(/^\/+/, "");
    // Reject separators that URL-normalization won't defuse: a raw backslash
    // (Windows separator) or a null byte must never reach resolve().
    if (rel.includes("\\") || rel.includes("\0")) return false;
    const filePath = resolve(mountRoot, rel);
    if (filePath !== mountRoot && !filePath.startsWith(mountRoot + sep)) {
      // Path traversal — refuse and let the caller respond 404.
      return false;
    }

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return false; // not a client file
    }
    if (!stat.isFile()) return false;

    const type =
      MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    const isHtml = extname(filePath).toLowerCase() === ".html";
    const isVersionManifest = filePath === resolve(root, "client-version.txt");

    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(stat.size));
    // Vite hashes its /assets/* files — safe to cache forever. index.html is
    // the entry point and must stay fresh.
    res.setHeader(
      "Cache-Control",
      isHtml || isVersionManifest
        ? "no-store, no-cache, must-revalidate, max-age=0"
        : "public, max-age=31536000, immutable",
    );

    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return true;
    }

    // Synchronous read: the client is small, browsers cache /assets/* for a
    // year (immutable) so each file is read rarely, and sync keeps the
    // handler trivially testable. Matches the project's sync SQLite usage.
    let body: Buffer;
    try {
      body = readFileSync(filePath);
    } catch {
      return false; // file disappeared mid-request — caller handles 404
    }

    res.writeHead(200);
    res.end(body);
    return true;
  };
}
