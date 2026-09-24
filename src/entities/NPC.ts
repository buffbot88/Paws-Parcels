import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { TextureKeys } from "../game/GameConstants.ts";
import type { NPC as NPCDefinition } from "../types/NPCtypes.ts";
import { DEPTH_OFFSET, worldDepth } from "../game/WorldDepth.ts";
import { animationKey } from "../game/classAssets.ts";
import { ensureLookArt } from "../game/avatarTextures.ts";
import {
  entityShadowOffsetPx,
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
 * A static villager, drawn from a courier body in its own colours (`look` in
 * npcs.json); one without a look keeps the readable placeholder blob.
 */
export class NPC extends Phaser.Physics.Arcade.Sprite {
  readonly definition: NPCDefinition;
  /** Stable art identifier for visual review metadata: the look's art id. */
  readonly npcArtKey: string;
  private readonly nameTag: Phaser.GameObjects.Text;
  /** Quest marker above the name tag; hidden when there is none. Read by the 3D view too. */
  private readonly questMarker: Phaser.GameObjects.Text;
  private markerKind: NpcQuestMarker | null = null;
  /** Extra marker bob in pixels (positive up); zero under reduced motion. */
  markerBobY = 0;
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
    const look = definition.look ?? null;
    const artId = look === null ? null : ensureLookArt(scene, look);
    const idleKey = artId === null ? null : animationKey(artId, "idle", "south");
    const texture = idleKey !== null && scene.textures.exists(idleKey) ? idleKey : TextureKeys.NpcBlob;
    super(scene, x, y, texture);
    this.definition = definition;
    this.npcArtKey = artId ?? TextureKeys.NpcBlob;

    scene.add.existing(this);
    // Sized by the shared entity convention: the figure, not the canvas (see entitySizing.ts).
    const sizing = villagerSizing(look?.body ?? null);
    this.setScale(entityScale(sizing));
    this.setDepth(worldDepth(y));
    if (idleKey !== null && scene.anims.exists(idleKey)) this.play(idleKey);
    // A 30x24 static body around the feet, whatever size the art renders at.
    scene.physics.add.existing(this, true);
    (this.body as Phaser.Physics.Arcade.StaticBody).setSize(30, 24);
    (this.body as Phaser.Physics.Arcade.StaticBody).setOffset(
      this.displayWidth / 2 - 15,
      this.displayHeight / 2 + entityShadowOffsetPx(sizing) - 24,
    );

    // One lighting recipe for the whole world (Pass 6), sized from this
    // villager's own ground contact instead of a fixed ellipse.
    const recipe = entityShadow(sizing);
    this.shadow = scene.add
      .ellipse(
        x,
        y + entityShadowOffsetPx(sizing),
        recipe.widthPx,
        recipe.heightPx,
        recipe.color,
        recipe.alpha,
      )
      .setDepth(worldDepth(y, DEPTH_OFFSET.contactShadow));

    this.nameTag = scene.add
      .text(x, y + entityNameTagOffsetPx(sizing), definition.name, {
        fontFamily: "Georgia, serif",
        fontSize: "12px",
        color: "#fff8e8",
        padding: { x: 3, y: 2 },
        stroke: "#1d2c20",
        strokeThickness: 4,
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
  /** Show or hide the name tag (the scene shows names near the courier or under the pointer). */
  showName(visible: boolean): void {
    this.nameTag.setVisible(visible);
  }

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
