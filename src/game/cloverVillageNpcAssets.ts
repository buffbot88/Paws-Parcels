import Phaser from "phaser";
import type { NPC as NPCDefinition } from "../types/NPCtypes.ts";

export type CloverNpcArt = "artist" | "astrologer" | "citizen";

type AssetGlob = Record<string, string>;

const npcFolders: Readonly<Record<CloverNpcArt, "Artist" | "Astrologer" | "Citizen">> = {
  artist: "Artist",
  astrologer: "Astrologer",
  citizen: "Citizen",
};

const idleFrames: Readonly<Record<CloverNpcArt, AssetGlob>> = {
  artist: import.meta.glob(
    "../data/maps/CloverVillage/NPC/Artist/PNG/Front/PNG Sequences/Idle/*.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  astrologer: import.meta.glob(
    "../data/maps/CloverVillage/NPC/Astrologer/PNG/Front/PNG Sequences/Idle/*.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
  citizen: import.meta.glob(
    "../data/maps/CloverVillage/NPC/Citizen/PNG/Front/PNG Sequences/Idle/*.png",
    { eager: true, query: "?url", import: "default" },
  ) as AssetGlob,
};

const ART_BY_NPC_ID: Readonly<Record<string, CloverNpcArt>> = {
  "npc-pip": "citizen",
  "npc-maple": "astrologer",
  "npc-biscuit": "artist",
  "npc-lumi": "astrologer",
  "npc-moss": "artist",
};

function numericOrder(path: string): number {
  const match = path.match(/_(\d+)\.png$/i);
  return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

function animationKey(art: CloverNpcArt): string {
  return `clover-npc-${art}-idle-front`;
}

function frameKey(art: CloverNpcArt, index: number): string {
  return `clover-npc-${art}-idle-front-${index}`;
}

/** Resolve every Clover Village NPC to supplied authored art where possible. */
export function npcArtForDefinition(definition: NPCDefinition): CloverNpcArt | null {
  return ART_BY_NPC_ID[definition.id] ?? null;
}

export function npcAnimationKey(art: CloverNpcArt): string {
  return animationKey(art);
}

/** Initial texture key for a supplied NPC animation before `play()` starts. */
export function npcFrameKey(art: CloverNpcArt, index = 0): string {
  return frameKey(art, index);
}

/** Queue the three curated front-facing idle sequences (90 PNGs total). */
export function queueCloverVillageNpcAssets(scene: Phaser.Scene): void {
  for (const art of Object.keys(npcFolders) as CloverNpcArt[]) {
    Object.entries(idleFrames[art])
      .sort(([a], [b]) => numericOrder(a) - numericOrder(b))
      .forEach(([, url], index) => scene.load.image(frameKey(art, index), url));
  }
}

/** Register looping front-facing idle animations after the images load. */
export function registerCloverVillageNpcAnimations(scene: Phaser.Scene): void {
  for (const art of Object.keys(npcFolders) as CloverNpcArt[]) {
    const urls = Object.entries(idleFrames[art]).sort(
      ([a], [b]) => numericOrder(a) - numericOrder(b),
    );
    const key = animationKey(art);
    if (urls.length === 0 || scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: urls.map((_, index) => ({ key: frameKey(art, index) })),
      frameRate: 10,
      repeat: -1,
    });
  }
}
