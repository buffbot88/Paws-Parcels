import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Router } from "../../server/src/routes/index.ts";

interface MockResponse extends ServerResponse {
  _status: number;
  _body: unknown;
  _ended: boolean;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    _status: 0,
    _body: null,
    _ended: false,
    writeHead(status: number) {
      res._status = status;
      return res;
    },
    setHeader() {
      return res;
    },
    end(chunk?: string | Buffer) {
      res._ended = true;
      if (typeof chunk === "string") {
        try {
          res._body = JSON.parse(chunk);
        } catch {
          res._body = chunk;
        }
      }
      return res;
    },
    on() {
      return res;
    },
  } as unknown as MockResponse;
  return res;
}

function makeReq(url: string, method = "GET"): IncomingMessage {
  return {
    method,
    url,
    headers: {},
  } as unknown as IncomingMessage;
}

describe("Router — path param decoding", () => {
  it("decodes percent-encoded path params", async () => {
    const router = new Router();
    let seen: string | undefined;
    router.get("/api/characters/:characterId/profile", (_req, res, params) => {
      seen = params?.characterId;
      res.writeHead(200);
      res.end();
    });
    const res = makeRes();
    await router.resolve(
      makeReq("/api/characters/%E2%9C%93/profile"),
      res as unknown as ServerResponse,
    );
    expect(seen).toBe("✓");
    expect(res._status).toBe(200);
  });

  it("returns 400 BAD_PATH_ENCODING for malformed percent-encoding (%ff) instead of crashing", async () => {
    const router = new Router();
    let called = false;
    router.get("/api/characters/:characterId/profile", (_req, res) => {
      called = true;
      res.writeHead(500);
      res.end();
    });
    const res = makeRes();
    // decodeURIComponent("%ff") throws URIError — the router must turn that
    // into a 400 response, not a thrown exception that crashes the server.
    const matched = await router.resolve(
      makeReq("/api/characters/%ff/profile"),
      res as unknown as ServerResponse,
    );
    expect(matched).toBe(true);
    expect(called).toBe(false);
    expect(res._status).toBe(400);
    expect(res._body).toMatchObject({ error: "BAD_PATH_ENCODING" });
  });

  it("returns false when no route matches", async () => {
    const router = new Router();
    const res = makeRes();
    const matched = await router.resolve(
      makeReq("/api/does-not-exist"),
      res as unknown as ServerResponse,
    );
    expect(matched).toBe(false);
    expect(res._ended).toBe(false);
  });
});
