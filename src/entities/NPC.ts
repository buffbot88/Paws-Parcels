import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { TextureKeys } from "../game/GameConstants.ts";
import type { NPC as NPCDefinition } from "../types/NPCtypes.ts";
import { DEPTH_OFFSET, worldDepth } from "../game/WorldDepth.ts";
import {
  npcAnimationKey,
  npcArtForDefinition,
  npcFrameKey,
  type CloverNpcArt,
} from "../game/cloverVillageNpcAssets.ts";
import {
  entityFeetOffsetPx,
  entityNameTagOffsetPx,
  entityScale,
  entityShadow,
  villagerSizing,
} from "../game/entitySizing.ts";

/**
 * A static NPC with supplied Clover Village artwork where mapped; unmapped
 * species retain the readable placeholder until matching art is available.
 */
export class NPC extends Phaser.Physics.Arcade.Sprite {
  readonly definition: NPCDefinition;
  /** Stable authored-art identifier for visual review metadata. */
  readonly npcArtKey: string;
  private readonly nameTag: Phaser.GameObjects.Text;
  private readonly npcArt: CloverNpcArt | null;
  /**
   * The NPC's cast shadow.
   *
   * A sibling object rather than a child of the sprite, so the idle bob tween
   * moves the villager and not the patch of ground they are standing on — the
   * same reason every prop's shadow is placed from its own base line.
   */
  private readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, definition: NPCDefinition) {
    const x = definition.homeTile.x * TILE_SIZE + TILE_SIZE / 2;
    const y = definition.homeTile.y * TILE_SIZE + TILE_SIZE / 2;
    const npcArt = npcArtForDefinition(definition);
    const frameKey = npcArt !== null ? npcFrameKey(npcArt) : null;
    const texture =
      npcArt !== null &&
      frameKey !== null &&
      scene.anims.exists(npcAnimationKey(npcArt)) &&
      scene.textures.exists(frameKey)
        ? frameKey
        : TextureKeys.NpcBlob;
    super(scene, x, y, texture);
    this.definition = definition;
    this.npcArt = npcArt;
    this.npcArtKey = npcArt ?? TextureKeys.NpcBlob;

    scene.add.existing(this);
    scene.physics.add.existing(this, true); // static body
    (this.body as Phaser.Physics.Arcade.StaticBody).setSize(30, 24);
    (this.body as Phaser.Physics.Arcade.StaticBody).setOffset(
      (TILE_SIZE - 30) / 2,
      TILE_SIZE - 24 - 4,
    );

    // Sized by the shared entity convention. Authored frames are 700px square
    // with the figure in 82-89% of that, so the canvas height is not the
    // villager's height — the figure is (see entitySizing.ts). The collision
    // body is unaffected either way.
    const sizing = villagerSizing(npcArt);
    this.setScale(entityScale(sizing));
    this.setDepth(worldDepth(y));
    if (this.npcArt !== null) this.play(npcAnimationKey(this.npcArt));

    // One lighting recipe for the whole world (Pass 6), sized from this
    // villager's own ground contact instead of a fixed ellipse.
    const recipe = entityShadow(sizing);
    this.shadow = scene.add
      .ellipse(
        x,
        y + entityFeetOffsetPx(sizing),
        recipe.widthPx,
        recipe.heightPx,
        recipe.color,
        recipe.alpha,
      )
      .setDepth(worldDepth(y, DEPTH_OFFSET.contactShadow));

    this.nameTag = scene.add
      .text(x, y + entityNameTagOffsetPx(sizing), definition.name, {
        fontFamily: "Georgia, serif",
        fontSize: npcArt === null ? "12px" : "11px",
        color: "#fff8e8",
        backgroundColor: "#30452fcc",
        padding: { x: 6, y: 3 },
        stroke: "#1d2c20",
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setAlpha(0.88)
      .setShadow(0, 2, "#172219", 3, true, true)
      .setDepth(worldDepth(y, DEPTH_OFFSET.overlay));

    scene.tweens.add({
      targets: [this, this.nameTag],
      y: "-=3",
      duration: 1400,
      ease: "sine.inout",
      yoyo: true,
      repeat: -1,
    });
  }

  /** Keep the static NPC's draw order aligned with its gentle vertical bob. */
  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    this.setDepth(worldDepth(this.y));
    this.nameTag.setDepth(worldDepth(this.y, DEPTH_OFFSET.overlay));
    this.shadow.setDepth(worldDepth(this.y, DEPTH_OFFSET.contactShadow));
  }
}
