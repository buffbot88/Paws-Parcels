import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { SceneKeys, TextureKeys, ZoneKeys } from "../game/GameConstants.ts";
import { MAPS, type MapData, type MapInteractable, type MapPoint } from "../game/Maps.ts";
import { COLLIDING_TILE_INDICES, TILE_INDEX } from "../game/Tiles.ts";
import { InputSystem } from "../systems/InputSystem.ts";
import { NetworkSystem } from "../systems/NetworkSystem.ts";
import {
  readBootCharacters,
  resolveBootTarget,
} from "../net/bootTarget.ts";
import { Player } from "../entities/Player.ts";
import { NPC } from "../entities/NPC.ts";
import { InteractionSystem, type InteractionTarget } from "../systems/InteractionSystem.ts";
import { sanitizeSpawn } from "../systems/MapValidator.ts";
import { selectDialogueSet } from "../systems/DialogueService.ts";
import { DialoguePanel } from "../ui/DialoguePanel.ts";
import npcsJson from "../data/npcs.json" with { type: "json" };
import dialogueJson from "../data/dialogue.json" with { type: "json" };
import type { NPC as NPCDefinition } from "../types/NPCtypes.ts";
import type { DialogueSet } from "../types/DialogueTypes.ts";

export interface OverworldSceneData {
  zoneId?: string;
  spawn?: MapPoint;
}

const NPCS = npcsJson.npcs as NPCDefinition[];
const DIALOGUE = dialogueJson.dialogue as DialogueSet[];
/** One DOM panel for the whole app — scenes come and go, the overlay persists. */
export const dialoguePanel = new DialoguePanel();
/** Client-side attack-pickup radius (tiles); the server enforces the real range. */
const ATTACK_TARGET_RANGE = 6;

/**
 * The zone-capable world scene (Phase 2-3): builds a tilemap from the custom
 * JSON maps, collides the player, follows with a clamped camera, restarts on
 * transition tiles, and exposes NPCs + objects with tap/E-Space interaction
 * and a DOM dialogue overlay.
 */
export class OverworldScene extends Phaser.Scene {
  private player!: Player;
  private shadow!: Phaser.GameObjects.Image;
  private inputSystem!: InputSystem;
  private interactionSystem!: InteractionSystem;
  private mapData!: MapData;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  private prompt!: Phaser.GameObjects.Container;
  private lastTileX = -1;
  private lastTileY = -1;
  private isTransitioning = false;
  private network = NetworkSystem.get();

  constructor() {
    super(SceneKeys.Overworld);
  }

  create(data?: OverworldSceneData): void {
    this.isTransitioning = false;

    // Boot where the courier actually is (their server-saved zone + position)
    // unless a scene restart already decided the zone. Unknown saved zones
    // fall back to the hub — never leave the scene half-built.
    const boot = resolveBootTarget(readBootCharacters());
    const requestedZone = data?.zoneId ?? boot.zoneId;
    const map = MAPS[requestedZone];
    if (!map) {
      console.warn(
        `OverworldScene: unknown zone "${requestedZone}" — booting at the hub`,
      );
    }
    const zoneId = map ? requestedZone : ZoneKeys.CloverVillage;
    const resolved = map ?? MAPS[ZoneKeys.CloverVillage];
    this.mapData = resolved;

    this.buildTilemap(resolved);

    // Physics world matches the whole map so the camera + colliders behave.
    this.physics.world.setBounds(
      0,
      0,
      resolved.width * TILE_SIZE,
      resolved.height * TILE_SIZE,
    );

    // Explicit transition spawn wins. For a true fresh boot (no scene data)
    // use the courier's saved position; for a restart that omitted a spawn,
    // use the map's default spawn — never the courier's old position from
    // another zone. sanitizeSpawn then guards against stale/corrupt data
    // landing the courier out of bounds or inside a wall.
    const spawn = sanitizeSpawn(
      resolved,
      data?.spawn ?? (data ? resolved.spawn : boot.pos),
    );
    this.player = new Player(
      this,
      spawn.x * TILE_SIZE + TILE_SIZE / 2,
      spawn.y * TILE_SIZE + TILE_SIZE / 2,
    );
    this.shadow = this.add
      .image(this.player.x, this.player.y + 12, TextureKeys.PlayerShadow)
      .setDepth(0.5);
    this.player.setDepth(1);

    // Collide with the ground layer only now that the player exists (and guard
    // in case buildTilemap bailed, so we never pass undefined to the collider).
    if (this.groundLayer) {
      this.physics.add.collider(this.player, this.groundLayer);
    }

    this.buildNpcs(resolved);
    this.buildObjectMarkers(resolved);
    this.buildInteractionSystem(resolved);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, resolved.width * TILE_SIZE, resolved.height * TILE_SIZE);
    camera.startFollow(this.player, true, 0.12, 0.12);

    this.addUi(resolved);
    this.buildPrompt();

    // Remember the arrival tile so spawning on a transition never re-triggers.
    this.lastTileX = spawn.x;
    this.lastTileY = spawn.y;

    this.inputSystem = new InputSystem(this);

    // Phase 2-3 — multiplayer: bind the network layer and join this zone.
    this.network.attach(this);
    // Defeat = respawn at the safe hub (server says where).
    this.network.onDefeat = (info) => {
      if (info.zoneId === this.mapData.id) {
        // Same zone respawn — just move the courier + restore HP.
        this.player.setPosition(
          info.pos.x * TILE_SIZE + TILE_SIZE / 2,
          info.pos.y * TILE_SIZE + TILE_SIZE / 2,
        );
      } else {
        this.network.joinZone(info.zoneId);
        this.scene.restart({
          zoneId: info.zoneId,
          spawn: info.pos,
        } satisfies OverworldSceneData);
      }
    };
    this.network.start(zoneId);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputSystem.destroy();
      this.network.detach();
    });
  }

  update(): void {
    // Dialogue open: freeze the world, feed E/Space into the panel only.
    if (dialoguePanel.isOpen()) {
      this.player.move({ x: 0, y: 0 });
      if (this.inputSystem.consumeInteract()) dialoguePanel.advance();
      this.prompt.setVisible(false);
      return;
    }

    const vector = this.inputSystem.getMoveVector();
    this.player.move(vector);
    this.shadow.setPosition(this.player.x, this.player.y + 12);

    // Phase 2 — send a throttled move intent (dominant axis only; the server
    // rejects diagonals) and interpolate other couriers' snapshots.
    if (Math.abs(vector.x) >= Math.abs(vector.y)) {
      this.network.moveIntent(Math.sign(vector.x), 0);
    } else {
      this.network.moveIntent(0, Math.sign(vector.y));
    }

    // Phase 3 — attack: J targets the nearest monster in class range (the
    // server re-validates range + cooldown and rejects anything untrustworthy).
    if (this.inputSystem.consumeAttack()) {
      this.network.attackNearest(
        {
          x: Math.floor(this.player.x / TILE_SIZE),
          y: Math.floor(this.player.y / TILE_SIZE),
        },
        ATTACK_TARGET_RANGE,
      );
    }
    this.network.update();

    const focused = this.interactionSystem.getFocused(
      this.player.x,
      this.player.y,
      TILE_SIZE,
    );
    this.updatePrompt(focused);
    this.prompt.setVisible(focused !== null);

    const tap = this.inputSystem.consumeTap();
    const interacted =
      (tap && this.tapHits(tap.worldX, tap.worldY, focused)) ||
      this.inputSystem.consumeInteract();

    if (interacted && focused) {
      this.startInteraction(focused);
    }

    this.checkTransition();
  }

  private buildTilemap(map: MapData): void {
    const grid = map.rows.map((row) =>
      row.split("").map((ch) => TILE_INDEX[ch] ?? -1),
    );
    const tilemap = this.make.tilemap({
      data: grid,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: map.width,
      height: map.height,
    });
    const tileset = tilemap.addTilesetImage(
      "main",
      TextureKeys.TilesetMain,
      TILE_SIZE,
      TILE_SIZE,
    );
    if (!tileset) {
      console.error("OverworldScene: tileset-main texture missing");
      return;
    }
    // `gpu` defaults to false in createLayer, so this is the regular
    // TilemapLayer (the one Arcade physics colliders accept).
    const layer = tilemap.createLayer(0, tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer;
    layer.setCollision([...COLLIDING_TILE_INDICES]);
    this.groundLayer = layer;
  }

  /** Spawns the NPCs whose homeZone is the current zone (npcs.json). */
  private buildNpcs(map: MapData): void {
    const zoneNpcs = NPCS.filter((n) => n.homeZone === map.id);
    for (const def of zoneNpcs) {
      this.physics.add.collider(this.player, new NPC(this, def));
    }
  }

  /** Renders a small marker on each map object the player can interact with. */
  private buildObjectMarkers(map: MapData): void {
    for (const obj of map.interactables) {
      this.add
        .image(
          obj.x * TILE_SIZE + TILE_SIZE / 2,
          obj.y * TILE_SIZE + TILE_SIZE / 2,
          TextureKeys.ObjectMarker,
        )
        .setDepth(2)
        .setTint(0xd8b28a);
    }
  }

  private buildInteractionSystem(map: MapData): void {
    const npcTargets: InteractionTarget[] = NPCS.filter(
      (n) => n.homeZone === map.id,
    ).map((n) => ({
      id: n.id,
      kind: "npc" as const,
      label: n.name,
      x: n.homeTile.x * TILE_SIZE + TILE_SIZE / 2,
      y: n.homeTile.y * TILE_SIZE + TILE_SIZE / 2,
      npcId: n.id,
    }));
    const objectTargets: InteractionTarget[] = map.interactables.map(
      (o: MapInteractable) => ({
        id: o.id,
        kind: o.kind,
        label: o.label,
        x: o.x * TILE_SIZE + TILE_SIZE / 2,
        y: o.y * TILE_SIZE + TILE_SIZE / 2,
        lines: o.lines,
      }),
    );
    this.interactionSystem = new InteractionSystem([...npcTargets, ...objectTargets]);
  }

  /** Cozy hint bar shown above the player when something is in range. */
  private buildPrompt(): void {
    const bg = this.add.rectangle(0, 0, 210, 28, 0xffffff, 0.85);
    const text = this.add.text(0, 0, "", {
      fontFamily: "Georgia, serif",
      fontSize: "14px",
      color: "#3a5a3a",
    });
    text.setOrigin(0.5);
    this.prompt = this.add.container(0, 0, [bg, text]).setDepth(100);
    this.prompt.setVisible(false);
  }

  private updatePrompt(focused: InteractionTarget | null): void {
    const text = this.prompt.list[1] as Phaser.GameObjects.Text;
    if (!focused) {
      this.prompt.setVisible(false);
      return;
    }
    const touch = this.sys.game.device.input.touch;
    const verb = touch ? "Tap" : "Press E";
    text.setText(`${verb} to talk to ${focused.label}`);
    this.prompt.setPosition(this.player.x, this.player.y - 36);
  }

  private tapHits(worldX: number, worldY: number, focused: InteractionTarget | null): boolean {
    if (!focused) return false;
    return Math.hypot(worldX - focused.x, worldY - focused.y) < TILE_SIZE * 1.6;
  }

  private startInteraction(target: InteractionTarget): void {
    if (target.kind === "npc") {
      const set = selectDialogueSet(DIALOGUE, target.npcId ?? "", 0);
      if (!set) {
        console.error(`OverworldScene: no dialogue for npc "${target.npcId}"`);
        return;
      }
      dialoguePanel.open({ speaker: target.label, lines: set.lines }, () => undefined);
    } else {
      dialoguePanel.open({ speaker: target.label, lines: target.lines ?? [] }, () => undefined);
    }
  }

  private addUi(map: MapData): void {
    this.add
      .text(12, 10, map.name, {
        fontFamily: "Georgia, serif",
        fontSize: "20px",
        color: "#3a5a3a",
        backgroundColor: "#ffffffcc",
        padding: { x: 10, y: 5 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.add
      .text(12, this.scale.height - 32, "WASD / arrows / drag to move · E or tap to talk", {
        fontFamily: "Georgia, serif",
        fontSize: "15px",
        color: "#3a5a3a",
        backgroundColor: "#ffffff99",
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(100);
  }

  private checkTransition(): void {
    const tileX = Math.floor(this.player.x / TILE_SIZE);
    const tileY = Math.floor(this.player.y / TILE_SIZE);
    if (tileX === this.lastTileX && tileY === this.lastTileY) return;
    this.lastTileX = tileX;
    this.lastTileY = tileY;
    if (this.isTransitioning) return;

    const transition = this.mapData.transitions.find(
      (t) => t.x === tileX && t.y === tileY,
    );
    if (!transition) return;

    this.isTransitioning = true;
    this.network.joinZone(transition.toZone);
    this.scene.restart({
      zoneId: transition.toZone,
      spawn: transition.spawn,
    } satisfies OverworldSceneData);
  }
}
