import Phaser from "phaser";
import type { ClassKey } from "./classStats.ts";

export type { ClassKey } from "./classStats.ts";
export { classKeyFromId, classSpeed, classSpeedFromId } from "./classStats.ts";
export type SpriteDirection = "north" | "south" | "east" | "west";
export type SpriteAnimation = "idle" | "walk" | "attack" | "death";

type AssetUrl = string;
type AssetGlob = Record<string, AssetUrl>;

const directions: SpriteDirection[] = ["south", "west", "east", "north"];
const classFolders: Readonly<Record<ClassKey, "Warrior" | "Mage" | "Archer">> = {
  "bear-warrior": "Warrior",
  "cat-mage": "Mage",
  "fox-archer": "Archer",
};

const idleFrames: AssetGlob = import.meta.glob(
  "../../reference/assets/Classes/*/Idle/animations/**/*.png",
  { eager: true, query: "?url", import: "default" },
) as AssetGlob;
const idleRotations: AssetGlob = import.meta.glob(
  "../../reference/assets/Classes/*/Idle/rotations/**/*.png",
  { eager: true, query: "?url", import: "default" },
) as AssetGlob;

// One deliberately small, class-themed effect family per class. The source
// pack contains many presentation variants; these are enough for the first
// combat pass without shipping the entire 180 MB source directory.
const effectFrames: AssetGlob = {
  ...import.meta.glob(
    "../../reference/assets/Classes/Archer/AttackEffects/Fire Arrow/PNG/*.png",
    { eager: true, query: "?url", import: "default" },
  ),
  ...import.meta.glob(
    "../../reference/assets/Classes/Mage/AttackEffects/Fire Ball/PNG/*.png",
    { eager: true, query: "?url", import: "default" },
  ),
  ...import.meta.glob(
    "../../reference/assets/Classes/Warrior/AttackEffects/PNG/1/*.png",
    { eager: true, query: "?url", import: "default" },
  ),
} as AssetGlob;

function numericFrameOrder(path: string): number {
  const match = path.match(/(?:frame_|\/)(\d+)(?:\.png)?$/i);
  return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

function classAssetKey(
  classKey: ClassKey,
  animation: SpriteAnimation,
  direction: SpriteDirection,
  frame: number,
): string {
  return `courier-${classKey}-${animation}-${direction}-${frame}`;
}

function effectAssetKey(classKey: ClassKey, frame: number): string {
  return `courier-effect-${classKey}-${frame}`;
}

function pathParts(path: string): string[] {
  return path.split("/");
}

function classAnimationName(animation: SpriteAnimation): "Walk" | "Lead_Jab" | "Falling_Back_Death" {
  if (animation === "walk") return "Walk";
  if (animation === "attack") return "Lead_Jab";
  return "Falling_Back_Death";
}

function findAnimationUrls(
  classKey: ClassKey,
  animation: SpriteAnimation,
  direction: SpriteDirection,
): AssetUrl[] {
  if (animation === "idle") {
    const folder = classFolders[classKey];
    const entries = Object.entries(idleRotations).filter(([path]) => {
      const parts = pathParts(path);
      return parts.includes(folder) && parts.at(-1) === `${direction}.png`;
    });
    return entries.map(([, url]) => url);
  }
  const folder = classAnimationName(animation);
  return Object.entries(idleFrames)
    .filter(([path]) => {
      const parts = pathParts(path);
      return parts.includes(classFolders[classKey]) &&
        parts.includes(folder) &&
        parts.includes(direction);
    })
    .sort(([a], [b]) => numericFrameOrder(a) - numericFrameOrder(b))
    .map(([, url]) => url);
}

function findEffectUrls(classKey: ClassKey): AssetUrl[] {
  const folder = classFolders[classKey];
  return Object.entries(effectFrames)
    .filter(([path]) => pathParts(path).includes(folder))
    .sort(([a], [b]) => numericFrameOrder(a) - numericFrameOrder(b))
    .map(([, url]) => url);
}

/** Queue all playable class PNGs before the preloader scene creates textures. */
export function queueClassAssets(scene: Phaser.Scene): void {
  const loaded = new Set<string>();
  for (const classKey of Object.keys(classFolders) as ClassKey[]) {
    for (const animation of ["idle", "walk", "attack", "death"] as SpriteAnimation[]) {
      for (const direction of directions) {
        findAnimationUrls(classKey, animation, direction).forEach((url, index) => {
          const key = classAssetKey(classKey, animation, direction, index);
          if (!loaded.has(key)) {
            scene.load.image(key, url);
            loaded.add(key);
          }
        });
      }
    }
    findEffectUrls(classKey).forEach((url, index) => {
      const key = effectAssetKey(classKey, index);
      if (!loaded.has(key)) {
        scene.load.image(key, url);
        loaded.add(key);
      }
    });
  }
}

/** Create animation definitions after the queued image files have loaded. */
export function registerClassAnimations(scene: Phaser.Scene): void {
  for (const classKey of Object.keys(classFolders) as ClassKey[]) {
    for (const animation of ["idle", "walk", "attack", "death"] as SpriteAnimation[]) {
      for (const direction of directions) {
        const urls = findAnimationUrls(classKey, animation, direction);
        const key = classAssetKey(classKey, animation, direction, 0);
        if (urls.length === 0 || scene.anims.exists(key)) continue;
        scene.anims.create({
          key,
          frames: urls.map((_, index) => ({ key: classAssetKey(classKey, animation, direction, index) })),
          frameRate: animation === "walk" ? 10 : animation === "attack" ? 16 : animation === "death" ? 12 : 1,
          repeat: animation === "walk" || animation === "idle" ? -1 : 0,
        });
      }
    }

    const effects = findEffectUrls(classKey);
    const effectKey = effectAssetKey(classKey, 0);
    if (effects.length > 0 && !scene.anims.exists(effectKey)) {
      scene.anims.create({
        key: effectKey,
        frames: effects.map((_, index) => ({ key: effectAssetKey(classKey, index) })),
        frameRate: 18,
        repeat: 0,
      });
    }
  }
}

export function animationKey(
  classKey: ClassKey,
  animation: SpriteAnimation,
  direction: SpriteDirection,
): string {
  return classAssetKey(classKey, animation, direction, 0);
}

/** Play the selected class's compact attack effect at a world position. */
export function playAttackEffect(
  scene: Phaser.Scene,
  classKey: ClassKey,
  x: number,
  y: number,
): void {
  const key = effectAssetKey(classKey, 0);
  if (!scene.anims.exists(key) || !scene.textures.exists(key)) return;
  const effect = scene.add
    .sprite(x, y, key)
    .setScale(classKey === "cat-mage" ? 0.15 : classKey === "fox-archer" ? 0.18 : 0.18)
    .setDepth(4);
  effect.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => effect.destroy());
  effect.play(key);
}

