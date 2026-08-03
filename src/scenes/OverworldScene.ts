import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { SceneKeys, TextureKeys, ZoneKeys } from "../game/GameConstants.ts";
import { MAPS, type MapData, type MapInteractable, type MapPoint } from "../game/Maps.ts";
import { COLLIDING_TILE_INDICES, TILE_INDEX } from "../game/Tiles.ts";
import { InputSystem } from "../systems/InputSystem.ts";
import { Player } from "../entities/Player.ts";
import { NPC } from "../entities/NPC.ts";
import { InteractionSystem, type InteractionTarget } from "../systems/InteractionSystem.ts";
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
const dialoguePanel = new DialoguePanel();

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

  constructor() {
    super(SceneKeys.Overworld);
  }

  create(data?: OverworldSceneData): void {
    this.isTransitioning = false;

    const zoneId = data?.zoneId ?? ZoneKeys.PostOffice;
    const map = MAPS[zoneId];
    if (!map) {
      console.error(`OverworldScene: unknown zone "${zoneId}"`);
      return;
    }
    this.mapData = map;

    this.buildTilemap(map);

    // Physics world matches the whole map so the camera + colliders behave.
    this.physics.world.setBounds(0, 0, map.width * TILE_SIZE, map.height * TILE_SIZE);

    const spawn = data?.spawn ?? map.spawn;
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

    this.buildNpcs(map);
    this.buildObjectMarkers(map);
    this.buildInteractionSystem(map);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, map.width * TILE_SIZE, map.height * TILE_SIZE);
    camera.startFollow(this.player, true, 0.12, 0.12);

    this.addUi(map);
    this.buildPrompt();

    // Remember the arrival tile so spawning on a transition never re-triggers.
    this.lastTileX = spawn.x;
    this.lastTileY = spawn.y;

    this.inputSystem = new InputSystem(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.inputSystem.destroy());
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
    this.scene.restart({
      zoneId: transition.toZone,
      spawn: transition.spawn,
    } satisfies OverworldSceneData);
  }
}
