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
import { getSettings } from "../ui/settings.ts";
import type { NpcQuestMarker } from "../ui/hud/questMarkers.ts";

/** Glyph and colours per quest marker; "stop" is deliberately quieter. */
const MARKER_STYLE: Record<NpcQuestMarker, { text: string; color: string; stroke: string; fontSize: string; alpha: number }> = {
  available: { text: "!", color: "#ffd34d", stroke: "#5a3b00", fontSize: "22px", alpha: 1 },
  ready: { text: "✓", color: "#9be27f", stroke: "#1f4a17", fontSize: "20px", alpha: 1 },
  stop: { text: "•", color: "#fff1c4", stroke: "#4a3a1a", fontSize: "18px", alpha: 0.75 },
};
/** Gap between the name tag's top edge and the marker, in pixels. */
const MARKER_GAP_PX = 2;

/**
 * A static NPC with supplied Clover Village artwork where mapped; unmapped
 * species retain the readable placeholder until matching art is available.
 */
export class NPC extends Phaser.Physics.Arcade.Sprite {
  readonly definition: NPCDefinition;
  /** Stable authored-art identifier for visual review metadata. */
  readonly npcArtKey: string;
  private readonly nameTag: Phaser.GameObjects.Text;
  /** Quest marker above the name tag; hidden when there is none. Read by the 3D view too. */
  private readonly questMarker: Phaser.GameObjects.Text;
  private markerKind: NpcQuestMarker | null = null;
  /** Extra marker bob in pixels (positive up); zero under reduced motion. */
  markerBobY = 0;
  private readonly npcArt: CloverNpcArt | null;
  /**
   * The NPC's cast shadow.
   *
   * A sibling object rather than a child of the sprite, so the idle bob tween
   * moves the villager and not the patch of ground they are standing on — the
   * same reason every prop's shadow is placed from its own base line.
   */
  private readonly shadow: Phaser.GameObjects.Ellipse;
  /**
   * Where the villager stands; `y` bobs above it in 2D. The 3D renderer reads
   * this for depth and `bobY` for height, so a hop is not a slide.
   */
  readonly groundY: number;
  private readonly nameTagY: number;
  /** Tweened 0-3px idle bob. */
  private bob = 0;

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

    this.questMarker = scene.add
      .text(x, this.nameTag.y, "!", { fontFamily: "Georgia, serif", fontStyle: "bold", padding: { x: 2, y: 2 } })
      .setOrigin(0.5)
      .setVisible(false);

    this.groundY = y;
    this.nameTagY = this.nameTag.y;
    scene.tweens.add({
      targets: this,
      bob: 3,
      duration: 1400,
      ease: "sine.inout",
      yoyo: true,
      repeat: -1,
    });
  }

  /** The idle bob's current height in pixels; zero under reduced motion. */
  get bobY(): number {
    return getSettings().reducedMotion ? 0 : this.bob;
  }

  /** Show or clear the quest marker; a no-op when unchanged, so it is safe per frame. */
  setQuestMarker(kind: NpcQuestMarker | null): void {
    if (kind === this.markerKind) return;
    this.markerKind = kind;
    if (kind === null) {
      this.questMarker.setVisible(false);
      return;
    }
    const style = MARKER_STYLE[kind];
    this.questMarker
      .setText(style.text)
      .setFontSize(style.fontSize)
      .setColor(style.color)
      .setStroke(style.stroke, 4)
      .setAlpha(style.alpha)
      .setVisible(true);
  }

  /** Apply the idle bob and keep the draw order aligned with it. */
  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    const lift = this.bobY;
    this.y = this.groundY - lift;
    this.nameTag.y = this.nameTagY - lift;
    this.setDepth(worldDepth(this.y));
    this.nameTag.setDepth(worldDepth(this.y, DEPTH_OFFSET.overlay));
    this.shadow.setDepth(worldDepth(this.y, DEPTH_OFFSET.contactShadow));
    if (this.markerKind !== null) {
      this.markerBobY = getSettings().reducedMotion ? 0 : 2 * Math.sin(time / 320);
      this.questMarker.y = this.nameTag.y - (this.nameTag.height + this.questMarker.height) / 2 - MARKER_GAP_PX - this.markerBobY;
      this.questMarker.setDepth(worldDepth(this.y, DEPTH_OFFSET.overlay));
    }
  }
}
