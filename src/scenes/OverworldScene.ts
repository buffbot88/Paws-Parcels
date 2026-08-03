import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { SceneKeys, TextureKeys, ZoneKeys } from "../game/GameConstants.ts";
import { MAPS, type MapData, type MapPoint } from "../game/Maps.ts";
import { COLLIDING_TILE_INDICES, TILE_INDEX } from "../game/Tiles.ts";
import { InputSystem } from "../systems/InputSystem.ts";
import { Player } from "../entities/Player.ts";

export interface OverworldSceneData {
  zoneId?: string;
  spawn?: MapPoint;
}

/**
 * The zone-capable world scene (Phase 2): builds a tilemap from the custom
 * JSON maps, collides the player with walls/water/trees, follows the player
 * with a camera clamped to the map, and restarts with new scene data when the
 * player steps on a transition tile.
 */
export class OverworldScene extends Phaser.Scene {
  private player!: Player;
  private shadow!: Phaser.GameObjects.Image;
  private inputSystem!: InputSystem;
  private mapData!: MapData;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
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

    const camera = this.cameras.main;
    camera.setBounds(0, 0, map.width * TILE_SIZE, map.height * TILE_SIZE);
    camera.startFollow(this.player, true, 0.12, 0.12);

    this.addUi(map);

    // Remember the arrival tile so spawning on a transition never re-triggers.
    this.lastTileX = spawn.x;
    this.lastTileY = spawn.y;

    this.inputSystem = new InputSystem(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.inputSystem.destroy());
  }

  update(): void {
    const vector = this.inputSystem.getMoveVector();
    this.player.move(vector);
    this.shadow.setPosition(this.player.x, this.player.y + 12);
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
      .text(12, this.scale.height - 32, "WASD / arrows / drag to move", {
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
