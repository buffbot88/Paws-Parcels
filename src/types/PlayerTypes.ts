export type AnimalId = "cat" | "bunny" | "fox" | "bear" | "mouse";

export interface Position {
  zoneId: string;
  x: number;
  y: number;
}

export interface PlayerState {
  name: string;
  animal: AnimalId;
  bodyColor: string;
  eyeColor: string;
  speedLevel: number;
  bagLevel: number;
  stamps: number;
  position: Position;
}
