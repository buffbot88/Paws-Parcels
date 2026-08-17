import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

// healthHandler imports pingDb from the connection module — stub it so the
// test never opens a real SQLite file.
vi.mock("../../server/src/db/connection.ts", () => ({
  pingDb: vi.fn(),
}));

import { pingDb } from "../../server/src/db/connection.ts";
import { healthHandler } from "../../server/src/routes/health.ts";

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("reports ok with the DB reachable", async () => {
    vi.mocked(pingDb).mockResolvedValue(true);
    const res = makeRes();
    await healthHandler({} as IncomingMessage, res as unknown as ServerResponse);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({
      status: "ok",
      timestamp: expect.any(String),
      db: "connected",
    });
  });

  it("reports degraded with the DB unreachable", async () => {
    vi.mocked(pingDb).mockResolvedValue(false);
    const res = makeRes();
    await healthHandler({} as IncomingMessage, res as unknown as ServerResponse);

    expect(res._status).toBe(503);
    expect(res._body).toMatchObject({ status: "degraded", db: "unreachable" });
  });
});
