import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameSocket,
  decodeMessage,
  encodeMessage,
} from "../../src/net/GameSocket.ts";

/** Minimal WebSocket fake with the surface GameSocket uses. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  // Test helpers — not part of the real WebSocket surface.
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  sentOfType(type: string): Array<Record<string, unknown>> {
    return this.sent
      .map((s) => decodeMessage(s))
      .filter((m): m is Record<string, unknown> => m !== null && m.type === type);
  }
}

const WS_TOKEN = "ws-token-abc";
const JWT = "jwt-abc";

function makeFetch(opts: { status?: number; wsToken?: string } = {}): typeof fetch {
  return (async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const body = {
      wsToken: opts.wsToken ?? WS_TOKEN,
      expiresIn: 30,
      characterId: 5,
      zoneId: "zone-clover-village",
    };
    return new Response(JSON.stringify(body), {
      status: opts.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function makeSocket(opts: {
  fetchImpl?: typeof fetch;
  moveIntervalMs?: number;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  now?: () => number;
} = {}): GameSocket {
  return new GameSocket({
    wsUrl: "ws://localhost:3001/ws",
    getToken: () => JWT,
    getCharacterId: () => 5,
    fetchImpl: opts.fetchImpl ?? makeFetch(),
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    moveIntervalMs: opts.moveIntervalMs ?? 260,
    maxReconnectAttempts: opts.maxReconnectAttempts ?? 3,
    reconnectDelayMs: opts.reconnectDelayMs ?? 1000,
    now: opts.now ?? (() => Date.now()),
  });
}

/** Connect + authenticate + join the default zone, awaiting each step. */
async function connectedSocket(
  socket: GameSocket,
  zoneId = "zone-clover-village",
): Promise<FakeWebSocket> {
  await socket.connect();
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  ws.open();
  ws.receive({
    type: "authenticated",
    accountId: 7,
    characterId: 5,
    zoneId,
  });
  socket.joinZone(zoneId);
  ws.receive({ type: "zone_state", zoneId, players: [], monsters: [], npcs: [], objects: [] });
  return ws;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("encodeMessage / decodeMessage", () => {
  it("round-trips a payload", () => {
    const payload = { type: "move_intent", dx: 1, dy: 0 };
    expect(decodeMessage(encodeMessage(payload))).toEqual(payload);
  });

  it("returns null for non-JSON frames", () => {
    expect(decodeMessage("not json")).toBeNull();
    expect(decodeMessage(12345)).toBeNull();
  });
});

describe("GameSocket.connect", () => {
  it("fetches a ws-token with the Bearer JWT and opens the socket", async () => {
    const fetchImpl = vi.fn(makeFetch());
    const socket = makeSocket({ fetchImpl });
    await socket.connect();

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/ws-token?characterId=5",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${JWT}` },
        cache: "no-store",
      }),
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe("ws://localhost:3001/ws");
  });

  it("calls the injected fetch with the global receiver", async () => {
    let receiver: unknown;
    const fetchImpl = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      receiver = this;
      return makeFetch()(input, init);
    } as typeof fetch;
    const socket = makeSocket({ fetchImpl });
    await socket.connect();
    expect(receiver).toBe(globalThis);
  });

  it("authenticates once the socket opens", async () => {
    const socket = makeSocket();
    await socket.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(ws.sentOfType("authenticate")).toEqual([
      { type: "authenticate", token: WS_TOKEN },
    ]);
  });

  it("does not connect when no JWT is stored", async () => {
    const fetchImpl = vi.fn(makeFetch());
    const socket = new GameSocket({
      wsUrl: "ws://localhost:3001/ws",
      getToken: () => null,
      getCharacterId: () => 5,
      fetchImpl,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    await socket.connect();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(socket.statusValue).toBe("closed");
  });

  it("surfaces a server error instead of connecting when the token fetch fails", async () => {
    const onError = vi.fn();
    const socket = makeSocket({ fetchImpl: makeFetch({ status: 500 }) });
    socket.callbacks.onError = onError;
    await socket.connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith("WS_TOKEN_FAILED", expect.any(String));
    expect(socket.statusValue).toBe("closed");
  });

  it("settles to closed when the token fetch throws (network error)", async () => {
    const onError = vi.fn();
    const socket = makeSocket({
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    socket.callbacks.onError = onError;
    await socket.connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(socket.statusValue).toBe("closed");
    expect(onError).toHaveBeenCalledWith(
      "WS_TOKEN_NETWORK_FAILED",
      "Network error fetching ws-token: offline",
    );
  });

  it("is re-entrancy safe: a second connect while open does not stack sockets", async () => {
    const socket = makeSocket();
    const ws = await connectedSocket(socket);
    await socket.connect(); // already open — must be a no-op
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.sentOfType("authenticate")).toHaveLength(1);
  });
});

describe("GameSocket.joinZone", () => {
  it("sends join_zone once authenticated and connected", async () => {
    const socket = makeSocket();
    const ws = await connectedSocket(socket, "zone-clover-village");
    expect(ws.sentOfType("join_zone")).toEqual([
      { type: "join_zone", zoneId: "zone-clover-village" },
    ]);
  });

  it("queues a zone join requested before authentication completes", async () => {
    const socket = makeSocket();
    socket.joinZone("zone-clover-village"); // before connect
    await socket.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open(); // authenticate goes out
    ws.receive({
      type: "authenticated",
      accountId: 7,
      characterId: 5,
      zoneId: "zone-clover-village",
    });
    expect(ws.sentOfType("join_zone")).toEqual([
      { type: "join_zone", zoneId: "zone-clover-village" },
    ]);
  });
});

describe("GameSocket.moveIntent", () => {
  it("sends a move_intent when joined and the interval has elapsed", async () => {
    let now = 1000;
    const socket = makeSocket({ moveIntervalMs: 260, now: () => now });
    const ws = await connectedSocket(socket);

    socket.moveIntent(1, 0);
    expect(ws.sentOfType("move_intent")).toEqual([{ type: "move_intent", dx: 1, dy: 0 }]);

    // Too soon — throttled.
    socket.moveIntent(0, 1);
    expect(ws.sentOfType("move_intent")).toHaveLength(1);

    now += 260;
    socket.moveIntent(0, -1);
    expect(ws.sentOfType("move_intent")).toHaveLength(2);
  });

  it("ignores a zero vector", async () => {
    const socket = makeSocket();
    const ws = await connectedSocket(socket);
    socket.moveIntent(0, 0);
    expect(ws.sentOfType("move_intent")).toHaveLength(0);
  });

  it("setMoveIntervalMs tightens/loosens the throttle (gear speed sync)", async () => {
    let now = 1000;
    const socket = makeSocket({ moveIntervalMs: 320, now: () => now });
    const ws = await connectedSocket(socket);

    socket.moveIntent(1, 0);
    socket.moveIntent(0, 1);
    expect(ws.sentOfType("move_intent")).toHaveLength(1); // 320ms not elapsed

    // Server reports gear-adjusted speed 160 px/s → 48000/160 = 300ms.
    socket.setMoveIntervalMs(Math.round(48000 / 160));
    now += 300;
    socket.moveIntent(0, 1);
    expect(ws.sentOfType("move_intent")).toHaveLength(2); // 300ms elapsed since last send

    now += 299; // 299ms < 300ms — still throttled (not back to the 320ms base)
    socket.moveIntent(1, 0);
    expect(ws.sentOfType("move_intent")).toHaveLength(2);

    now += 1; // full 300ms elapsed → allowed
    socket.moveIntent(0, -1);
    expect(ws.sentOfType("move_intent")).toHaveLength(3);
  });

  it("does not send before joining a zone", async () => {
    const socket = makeSocket();
    await socket.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive({ type: "authenticated", accountId: 7, characterId: 5, zoneId: "zone-clover-village" });
    socket.moveIntent(1, 0); // never joined
    expect(ws.sentOfType("move_intent")).toHaveLength(0);
  });

  it("stops sending after leaveZone and does not rejoin the old zone on reconnect", async () => {
    let now = 1000;
    const socket = makeSocket({ now: () => now });
    const ws = await connectedSocket(socket);

    socket.moveIntent(1, 0);
    expect(ws.sentOfType("move_intent")).toHaveLength(1);

    socket.leaveZone();
    now += 1000;
    socket.moveIntent(0, 1);
    expect(ws.sentOfType("move_intent")).toHaveLength(1); // suppressed
    expect(ws.sentOfType("leave_zone")).toHaveLength(1);
  });
});

describe("GameSocket message dispatch", () => {
  it("fires onZoneState and onSnapshot callbacks", async () => {
    const socket = makeSocket();
    const onZoneState = vi.fn();
    const onSnapshot = vi.fn();
    socket.callbacks.onZoneState = onZoneState;
    socket.callbacks.onSnapshot = onSnapshot;

    const ws = await connectedSocket(socket);
    ws.receive({
      type: "player_snapshot",
      zoneId: "zone-clover-village",
      sequence: 12,
      serverTime: 1700000000123,
      players: [{ characterId: 9, pos: { x: 3, y: 4 }, name: "Birch", classKey: "fox-archer" }],
    });
    expect(onSnapshot).toHaveBeenCalledWith(
      [{ characterId: 9, pos: { x: 3, y: 4 }, name: "Birch", classKey: "fox-archer" }],
      "zone-clover-village",
      { sequence: 12, serverTime: 1700000000123, receivedAt: expect.any(Number) },
    );
    expect(onZoneState).toHaveBeenCalled();
  });

  it("fires onPlayerJoined / onPlayerLeft", async () => {
    const socket = makeSocket();
    const onJoined = vi.fn();
    const onLeft = vi.fn();
    socket.callbacks.onPlayerJoined = onJoined;
    socket.callbacks.onPlayerLeft = onLeft;

    const ws = await connectedSocket(socket);
    ws.receive({
      type: "player_joined",
      characterId: 9,
      name: "Birch",
      classKey: "fox-archer",
      pos: { x: 2, y: 2 },
    });
    expect(onJoined).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 9, name: "Birch", classKey: "fox-archer" }),
    );

    ws.receive({ type: "player_left", characterId: 9 });
    expect(onLeft).toHaveBeenCalledWith(9);
  });

  it("fires onError with the server code and message", async () => {
    const socket = makeSocket();
    const onError = vi.fn();
    socket.callbacks.onError = onError;

    const ws = await connectedSocket(socket);
    ws.receive({ type: "error", code: "MOVE_COLLISION", message: "nope", requestType: "move_intent" });
    expect(onError).toHaveBeenCalledWith("MOVE_COLLISION", "nope", "move_intent");
  });

  it("sends and dispatches same-zone chat messages", async () => {
    const socket = makeSocket();
    const onChat = vi.fn();
    socket.callbacks.onChatMessage = onChat;
    const ws = await connectedSocket(socket);

    socket.chat("Hello, village!");
    expect(ws.sentOfType("zone_chat")).toEqual([{ type: "zone_chat", text: "Hello, village!" }]);

    ws.receive({ type: "zone_chat", characterId: 9, name: "Birch", text: "Welcome!" });
    expect(onChat).toHaveBeenCalledWith({ characterId: 9, name: "Birch", text: "Welcome!" });
  });
});

describe("GameSocket reconnect", () => {
  it("reconnects after an unexpected close and re-authenticates", async () => {
    vi.useFakeTimers();
    const socket = makeSocket({ reconnectDelayMs: 1000 });
    await socket.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.receive({ type: "authenticated", accountId: 7, characterId: 5, zoneId: "zone-clover-village" });

    // Unexpected close → reconnect scheduled.
    ws1.close();
    expect(socket.statusValue).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();
    expect(ws2.sentOfType("authenticate")).toEqual([
      { type: "authenticate", token: WS_TOKEN },
    ]);
  });

  it("stays closed after an intentional close()", async () => {
    vi.useFakeTimers();
    const socket = makeSocket();
    const ws = await connectedSocket(socket);
    socket.close();
    expect(socket.statusValue).toBe("closed");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect
  });

  it("keeps retrying on a slow cadence after the fast attempts are exhausted", async () => {
    vi.useFakeTimers();
    const socket = makeSocket({ maxReconnectAttempts: 2, reconnectDelayMs: 100 });
    await socket.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.receive({ type: "authenticated", accountId: 7, characterId: 5, zoneId: "zone-clover-village" });

    // Attempts 1 and 2 use the fast backoff (100ms * attempt).
    ws1.close();
    expect(socket.statusValue).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(100);
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();
    ws2.receive({ type: "authenticated", accountId: 7, characterId: 5, zoneId: "zone-clover-village" });
    ws2.close();
    await vi.advanceTimersByTimeAsync(200);
    const ws3 = FakeWebSocket.instances[2];
    ws3.open();
    ws3.receive({ type: "authenticated", accountId: 7, characterId: 5, zoneId: "zone-clover-village" });
    ws3.close();

    // Attempt 3 exceeds maxReconnectAttempts → slow cadence, still retrying.
    expect(socket.statusValue).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(FakeWebSocket.instances).toHaveLength(4);
    const ws4 = FakeWebSocket.instances[3];
    ws4.open();
    ws4.receive({ type: "authenticated", accountId: 7, characterId: 5, zoneId: "zone-clover-village" });

    // A successful re-authentication resets the cycle.
    expect(ws4.sentOfType("authenticate")).toHaveLength(1);
  });

  it("keeps retrying when the ws-token fetch fails mid-reconnect", async () => {
    vi.useFakeTimers();
    let failFetch = false;
    const socket = makeSocket({
      reconnectDelayMs: 100,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (failFetch) throw new Error("offline");
        return makeFetch()(input, init);
      }) as typeof fetch,
    });
    await socket.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.receive({ type: "authenticated", accountId: 7, characterId: 5, zoneId: "zone-clover-village" });

    // Drop the network; the first reconnect's token fetch fails — the cycle
    // must schedule another attempt instead of stranding at "closed".
    failFetch = true;
    ws1.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.statusValue).toBe("reconnecting");
    expect(FakeWebSocket.instances).toHaveLength(1); // no new socket — fetch failed

    // Network recovers: the next scheduled attempt must connect again.
    failFetch = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();
    expect(ws2.sentOfType("authenticate")).toHaveLength(1);
  });
});
