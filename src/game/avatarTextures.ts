/**
 * Build a look's recoloured frames and animations from its body's class art.
 *
 * Every frame of every animation is recoloured once per look and registered
 * under the look's art id, with animations named the way `classAssets.ts`
 * names the class art, so a courier plays `animationKey(artId, …)` either way.
 */
import Phaser from "phaser";
import { BODY_ART_CLASS, lookArtId, type AvatarLook } from "./appearance.ts";
import { recolorPixels } from "./avatarPalette.ts";
import { animationKey, type SpriteAnimation, type SpriteDirection } from "./classAssets.ts";

const ANIMATIONS: readonly SpriteAnimation[] = ["idle", "walk", "attack", "death"];
const DIRECTIONS: readonly SpriteDirection[] = ["south", "west", "east", "north"];

function frameKey(artId: string, animation: SpriteAnimation, direction: SpriteDirection, frame: number): string {
  return `courier-${artId}-${animation}-${direction}-${frame}`;
}

/** The art id to animate for `look`, creating its textures on first use. */
export function ensureLookArt(scene: Phaser.Scene, look: AvatarLook): string {
  const artId = lookArtId(look);
  const base = BODY_ART_CLASS[look.body];
  if (artId === base || scene.anims.exists(animationKey(artId, "idle", "south"))) return artId;
  for (const animation of ANIMATIONS) {
    for (const direction of DIRECTIONS) {
      const baseAnim = scene.anims.get(animationKey(base, animation, direction));
      if (baseAnim === undefined) continue;
      const frames: { key: string }[] = [];
      for (let index = 0; scene.textures.exists(frameKey(base, animation, direction, index)); index++) {
        const key = frameKey(artId, animation, direction, index);
        if (!scene.textures.exists(key)) {
          const source = scene.textures.get(frameKey(base, animation, direction, index)).getSourceImage() as CanvasImageSource & {
            width: number;
            height: number;
          };
          const canvas = document.createElement("canvas");
          canvas.width = source.width;
          canvas.height = source.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (context === null) return base;
          context.drawImage(source, 0, 0);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          image.data.set(recolorPixels(image.data, canvas.width, canvas.height, look.body, look.colors));
          context.putImageData(image, 0, 0);
          scene.textures.addCanvas(key, canvas);
        }
        frames.push({ key });
      }
      scene.anims.create({
        key: animationKey(artId, animation, direction),
        frames,
        frameRate: baseAnim.frameRate,
        repeat: baseAnim.repeat,
      });
    }
  }
  return artId;
}
