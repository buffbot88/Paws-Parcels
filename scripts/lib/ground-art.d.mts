export interface GroundTexture {
  w: number;
  h: number;
  px: Buffer;
}

export interface GroundStats {
  lumMin: number;
  lumMax: number;
  lumMean: number;
  darkFraction: number;
  edgeLR: number;
  edgeTB: number;
  internal: number;
  avgRGB: { r: number; g: number; b: number };
  avgHsl: { h: number; s: number; l: number };
}

export const landSource: string;
export const roadSource: string;

export function generateMeadow(): GroundTexture;
export function generateValleyMeadow(): GroundTexture;
export function generateRoad(): GroundTexture;
export function generateValleyPath(): GroundTexture;
export function generatePlaza(): GroundTexture;
export function computeStats(w: number, h: number, px: Buffer): GroundStats;
export function summarize(label: string, w: number, h: number, px: Buffer): void;