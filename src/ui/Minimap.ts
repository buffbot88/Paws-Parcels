import type { MapData } from "../game/Maps.ts";
import { TILES } from "../game/Tiles.ts";
import type { NPC as NPCDefinition } from "../types/NPCtypes.ts";
import { createIcon } from "./hud/icons.ts";
import { createIconButton, createPanel } from "./hud/primitives.ts";
import { hudLayer } from "./hud/layer.ts";

/** Terrain fill colors per tile code (`#rrggbb` for canvas), derived from the tile catalog. */
const TERRAIN_COLORS: Readonly<Record<string, string>> = Object.fromEntries(
  TILES.map((t) => [t.code, `#${t.base.toString(16).padStart(6, "0")}`]),
);

/** Marker palette — cozy and readable on the parchment base. */
const PLAYER_COLOR = "#f7efd6";
const PLAYER_RING = "#6a3d1e";
const REMOTE_COLOR = "#6f8fc9";
const MONSTER_COLOR = "#d0564a";
const NPC_COLOR = "#2f7d3a";
const OBJECT_COLOR = "#c98a2e";
const TRANSITION_COLOR = "#2ba0b8";

/**
 * Max displayed width in *internal game units* (the 960x540 canvas space, so
 * `src/styles/hud.css` can scale it by --hud-scale). Height follows the map
 * aspect.
 */
const MAX_WIDTH = 150;

/** A position in tile units (fractional allowed). */
export interface MinimapPoint {
  x: number;
  y: number;
}

/** Everything the live layer needs each frame. */
export interface MinimapFrame {
  player: MinimapPoint;
  players: MinimapPoint[];
  monsters: MinimapPoint[];
}

/**
 * HUD v4 minimap (top-right, ~330×285): green-framed map canvas, expand
 * button, collapse chevron, location label, and live tile coordinates.
 * Server/debug text moved out of the header — connection state lives in a
 * footer status dot with a tooltip (spec §8: no server text in the polished HUD).
 */
export class Minimap {
  /** Collapsed preference shared across scene restarts / zone changes. */
  private static collapsed = false;

  private readonly root: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly zoneLabel: HTMLElement;
  private readonly coordsLabel: HTMLElement;
  private readonly statusDot: HTMLElement;
  private readonly baseCanvas: HTMLCanvasElement;
  private readonly dynCanvas: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D | null;
  private readonly dynCtx: CanvasRenderingContext2D | null;
  private mapWidth = 0;
  private mapHeight = 0;
  private expanded = true;

  constructor() {
    const root = document.createElement("div");
    root.className = "minimap";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "minimap__header";
    header.title = "Toggle map";
    header.setAttribute("aria-expanded", "true");
    header.setAttribute("aria-controls", "minimap-body");
    const pin = createIcon("map-pin", { size: 14, className: "minimap__pin" });
    const title = document.createElement("span");
    title.className = "minimap__title";
    title.textContent = "Map";
    this.caret = document.createElement("span");
    this.caret.className = "minimap__caret";
    this.caret.appendChild(createIcon("chevron-down", { size: 14 }));
    header.append(pin, title, this.caret);

    const body = document.createElement("div");
    body.className = "minimap__body";
    body.id = "minimap-body";
    const base = document.createElement("canvas");
    base.className = "minimap__base";
    const dyn = document.createElement("canvas");
    dyn.className = "minimap__dyn";
    body.append(base, dyn);

    // Footer: zone label + coordinates + connection status dot (tooltip only).
    const footer = document.createElement("div");
    footer.className = "minimap__footer";
    const zone = document.createElement("span");
    zone.className = "minimap__zone";
    zone.textContent = "Map";
    this.coordsLabel = document.createElement("span");
    this.coordsLabel.className = "minimap__coords";
    this.coordsLabel.textContent = "–, –";
    this.statusDot = document.createElement("span");
    this.statusDot.className = "minimap__server";
    this.statusDot.dataset.status = "idle";
    this.statusDot.setAttribute("role", "img");
    this.statusDot.setAttribute("aria-label", "Server offline");
    this.statusDot.title = "Server · offline";
    footer.append(zone, this.coordsLabel, this.statusDot);

    root.append(header, body, footer);
    header.addEventListener("click", () => this.toggle());
    hudLayer()?.appendChild(root);

    this.root = root;
    this.zoneLabel = zone;
    this.baseCanvas = base;
    this.dynCanvas = dyn;
    this.baseCtx = base.getContext("2d");
    this.dynCtx = dyn.getContext("2d");
  }

  /** Render a zone's terrain + landmarks; call once per zone. */
  attach(map: MapData, npcs: NPCDefinition[]): void {
    this.mapWidth = map.width;
    this.mapHeight = map.height;

    // Fit the box to the map's aspect ratio (square village → square). The
    // result is published as CSS custom properties rather than a pixel width,
    // so `src/styles/hud.css` can scale the whole minimap with the canvas
    // instead of locking it to a fixed device pixel size.
    const aspect = map.height / map.width;
    let width = MAX_WIDTH;
    let height = width * aspect;
    if (height > MAX_WIDTH * 0.95) {
      height = MAX_WIDTH * 0.95;
      width = height / aspect;
    }
    this.root.style.setProperty("--minimap-width", String(Math.round(width)));
    this.root.style.setProperty("--minimap-aspect", String(aspect));
    this.expanded = !Minimap.collapsed;
    this.root.classList.toggle("minimap--collapsed", Minimap.collapsed);
    this.setCaret();
    this.zoneLabel.textContent = map.name;
    this.coordsLabel.textContent = "–, –";

    this.baseCanvas.width = map.width;
    this.baseCanvas.height = map.height;
    this.dynCanvas.width = map.width;
    this.dynCanvas.height = map.height;

    const ctx = this.baseCtx;
    if (ctx === null) return;

    // Terrain: one backing pixel per tile, scaled up by CSS (pixelated).
    for (let y = 0; y < map.height; y++) {
      const row = map.rows[y] ?? "";
      for (let x = 0; x < map.width; x++) {
        const ch = row[x] ?? "G";
        ctx.fillStyle = TERRAIN_COLORS[ch] ?? TERRAIN_COLORS["G"]!;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Landmarks: NPCs, interactables, and zone transitions.
    for (const npc of npcs) {
      if (npc.homeZone !== map.id) continue;
      this.dot(ctx, npc.homeTile.x, npc.homeTile.y, NPC_COLOR, 1.6);
    }
    for (const obj of map.interactables) {
      this.dot(ctx, obj.x, obj.y, OBJECT_COLOR, 1.5);
    }
    for (const transition of map.transitions) {
      this.dot(ctx, transition.x, transition.y, TRANSITION_COLOR, 1.8);
    }
  }

  /** Redraw the live layer; call every frame while the scene updates. */
  update(frame: MinimapFrame): void {
    if (this.mapWidth === 0) return;
    const ctx = this.dynCtx;
    if (ctx === null) return;
    ctx.clearRect(0, 0, this.mapWidth, this.mapHeight);

    for (const monster of frame.monsters) {
      this.dot(ctx, monster.x, monster.y, MONSTER_COLOR, 1.6);
    }
    for (const other of frame.players) {
      this.dot(ctx, other.x, other.y, REMOTE_COLOR, 1.6);
    }
    // Own courier: warm dot inside a dark ring so it always stands out.
    const px = frame.player.x + 0.5;
    const py = frame.player.y + 0.5;
    ctx.strokeStyle = PLAYER_RING;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, 2.6, 0, Math.PI * 2);
    ctx.stroke();
    this.dot(ctx, frame.player.x, frame.player.y, PLAYER_COLOR, 1.8);

    // Caption: current tile coordinates (floor — matches map tiles).
    this.coordsLabel.textContent =
      `${Math.floor(frame.player.x)}, ${Math.floor(frame.player.y)}`;
  }

  /** Mirror the courier WebSocket state in the footer status dot. */
  setServerStatus(status: string, detail?: string): void {
    const known = [
      "idle",
      "fetching-token",
      "connecting",
      "authenticating",
      "joined",
      "reconnecting",
      "closed",
    ];
    const normalized = known.includes(status) ? status : "closed";
    const labels: Record<string, string> = {
      idle: "Server · idle",
      "fetching-token": "Server · checking",
      connecting: "Server · connecting",
      authenticating: "Server · checking",
      joined: detail ? `Server · ${detail}` : "Server · online",
      reconnecting: "Server · reconnecting",
      closed: "Server · offline",
    };
    this.statusDot.dataset.status = normalized;
    this.statusDot.setAttribute("aria-label", labels[normalized] ?? "Server · offline");
    this.statusDot.title = labels[normalized] ?? "Server · offline";
    this.root.classList.toggle("minimap--server-online", normalized === "joined");
  }

  /** Remove the overlay from the DOM (scene shutdown). */
  destroy(): void {
    this.root.remove();
  }

  private toggle(): void {
    this.expanded = !this.expanded;
    Minimap.collapsed = !this.expanded;
    this.root.classList.toggle("minimap--collapsed", !this.expanded);
    this.setCaret();
  }

  private setCaret(): void {
    this.caret.replaceChildren(createIcon(this.expanded ? "chevron-down" : "chevron-up", { size: 14 }));
    const header = this.root.querySelector<HTMLButtonElement>(".minimap__header");
    header?.setAttribute("aria-expanded", String(this.expanded));
  }

  private dot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    radius: number,
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
