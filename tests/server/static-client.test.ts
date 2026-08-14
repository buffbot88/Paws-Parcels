import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createStaticClientServer } from "../../server/src/static/client.ts";

let clientDir: string;

function makeReq(opts: {
  method?: string;
  url?: string;
  upgrade?: string;
}): IncomingMessage {
  const headers: Record<string, string> = {};
  if (opts.upgrade !== undefined) headers.upgrade = opts.upgrade;
  return {
    method: opts.method ?? "GET",
    url: opts.url ?? "/",
    headers: headers as IncomingMessage["headers"],
  } as unknown as IncomingMessage;
}

interface MockResponse extends ServerResponse {
  _status: number;
  _headers: Record<string, string>;
  _body: string;
  _ended: boolean;
}

function makeRes(): MockResponse {
  const chunks: Buffer[] = [];
  const res: MockResponse = {
    _status: 0,
    _headers: {},
    _body: "",
    _ended: false,
    setHeader(name: string, value: string | string[]) {
      res._headers[name] = Array.isArray(value) ? value.join(",") : value;
      return res;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) res._headers[k] = v;
      }
      return res;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined && chunk !== null) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      res._body = Buffer.concat(chunks).toString("utf-8");
      res._ended = true;
      return res;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    emit() {
      return true;
    },
  } as unknown as MockResponse;
  return res;
}

beforeEach(() => {
  clientDir = mkdtempSync(join(tmpdir(), "pnp-static-"));
  mkdirSync(join(clientDir, "assets"), { recursive: true });
  writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>Paws</title>");
  writeFileSync(join(clientDir, "client-version.txt"), "index-game123.js\n");
  writeFileSync(join(clientDir, "oidc-callback.html"), "<!doctype html><title>OIDC</title>");
  writeFileSync(join(clientDir, "assets", "game-abc123.js"), "console.log('hi');");
  writeFileSync(join(clientDir, "assets", "art.png"), "PNGDATA");
});

afterEach(() => {
  rmSync(clientDir, { recursive: true, force: true });
});

describe("createStaticClientServer", () => {
  it("serves index.html at the root", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    const handled = serve(makeReq({ url: "/" }), res);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toContain("<title>Paws</title>");
    expect(res._headers["Content-Type"]).toContain("text/html");
    expect(res._headers["Cache-Control"]).toBe(
      "no-store, no-cache, must-revalidate, max-age=0",
    );
  });

  it("serves hashed asset files with immutable caching", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    const handled = serve(makeReq({ url: "/assets/game-abc123.js" }), res);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toBe("console.log('hi');");
    expect(res._headers["Content-Type"]).toBe("text/javascript; charset=utf-8");
    expect(res._headers["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("serves the client version manifest without caching", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    const handled = serve(makeReq({ url: "/client-version.txt?ts=123" }), res);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toBe("index-game123.js\n");
    expect(res._headers["Content-Type"]).toContain("text/plain");
    expect(res._headers["Cache-Control"]).toBe(
      "no-store, no-cache, must-revalidate, max-age=0",
    );
  });

  it("serves the OIDC callback page (copied from public/)", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    const handled = serve(makeReq({ url: "/oidc-callback.html" }), res);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toContain("OIDC");
  });

  it("sets Content-Length and Content-Type for binary assets", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    const handled = serve(makeReq({ url: "/assets/art.png" }), res);
    expect(handled).toBe(true);
    expect(res._headers["Content-Type"]).toBe("image/png");
    expect(res._headers["Content-Length"]).toBe("7");
    expect(res._body).toBe("PNGDATA");
  });

  it("returns false for missing files (caller handles 404)", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    expect(serve(makeReq({ url: "/nope.png" }), res)).toBe(false);
    expect(res._ended).toBe(false);
  });

  it("refuses path traversal", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    expect(serve(makeReq({ url: "/../../package.json" }), res)).toBe(false);
    expect(serve(makeReq({ url: "/%2e%2e/%2e%2e/package.json" }), res)).toBe(false);
    expect(res._ended).toBe(false);
  });

  it("ignores non-GET/HEAD methods and WebSocket upgrades", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    expect(serve(makeReq({ method: "POST", url: "/" }), res)).toBe(false);
    expect(serve(makeReq({ method: "GET", url: "/", upgrade: "websocket" }), res)).toBe(
      false,
    );
    expect(res._ended).toBe(false);
  });

  it("handles HEAD requests without a body", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    const handled = serve(makeReq({ method: "HEAD", url: "/" }), res);
    expect(handled).toBe(true);
    expect(res._status).toBe(200);
    expect(res._body).toBe("");
    expect(res._headers["Content-Length"]).toBeDefined();
  });

  it("strips the query string", async () => {
    const serve = createStaticClientServer(clientDir);
    const res = makeRes();
    expect(serve(makeReq({ url: "/assets/game-abc123.js?v=1" }), res)).toBe(true);
    expect(res._body).toBe("console.log('hi');");
  });
});
