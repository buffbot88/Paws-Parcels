/**
 * Prompt builders + shared shapes for the AI game engine. Prompts are small
 * and ask for strict JSON so the 450M model's output is cheap to parse; any
 * parse failure falls back to the deterministic game logic.
 */

export type BrainMonsterAction = "patrol" | "seek" | "attack" | "flee";

/** One monster's next-move decision from the world-brain. */
export interface BrainMonsterDecision {
  action: BrainMonsterAction;
  /** Player to attack (attack action); null otherwise. */
  targetPlayerId: number | null;
  /** Tile to patrol toward / investigate / flee from. */
  targetTile: { x: number; y: number } | null;
  reason?: string;
}

export interface SceneMonster {
  id: string;
  name: string;
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
  aggro: boolean;
}

export interface ScenePlayer {
  id: number;
  name: string;
  pos: { x: number; y: number };
  hp: number;
  maxHp: number;
}

export interface ZoneScene {
  zoneId: string;
  width: number;
  height: number;
  monsters: SceneMonster[];
  players: ScenePlayer[];
  isWalkable: (x: number, y: number) => boolean;
}

export function monsterDecisionSystemPrompt(): string {
  return (
    "You are the world-brain of Paws & Parcels, a cozy animal MMORPG. " +
    "You pick ONE monster's next action each turn. The monster's scene is " +
    "described in text plus a small ASCII map (P=player, M=monster, H=home, " +
    "#=blocked, .=walkable). Choose the action that makes the scene feel " +
    "alive and fair: patrol (amble toward targetTile), seek (investigate " +
    "targetTile), attack (move to and strike targetPlayerId), or flee (run " +
    "away from the threat at targetTile). A monster low on HP may flee; a " +
    "monster with players nearby usually attacks. Respond with JSON ONLY in " +
    'this exact shape: {"action":"patrol|seek|attack|flee","targetPlayerId":' +
    'number|null,"targetTile":{"x":number,"y":number}|null,"reason":"short"}'
  );
}

export function buildMonsterSceneText(
  scene: ZoneScene,
  monster: SceneMonster,
): string {
  const players = scene.players.map(
    (p) => `${p.name}(${p.id}) hp ${p.hp}/${p.maxHp} @ ${p.pos.x},${p.pos.y}`,
  );
  const others = scene.monsters
    .filter((m) => m.id !== monster.id)
    .map((m) => `${m.name} hp ${m.hp}/${m.maxHp} @ ${m.pos.x},${m.pos.y}`);
  return [
    `Zone: ${scene.zoneId}`,
    `You are ${monster.name} (${monster.aggro ? "aggressive" : "passive"}) at ${monster.pos.x},${monster.pos.y} with hp ${monster.hp}/${monster.maxHp}.`,
    `Players: ${players.join("; ") || "none"}`,
    `Other monsters: ${others.join("; ") || "none"}`,
    "Map:",
    renderAsciiMap(scene, monster),
  ].join("\n");
}

/** 11×11 ASCII window centred on the monster (cheap "vision" for monsters). */
export function renderAsciiMap(scene: ZoneScene, monster: SceneMonster): string {
  const R = 5;
  const rows: string[] = [];
  for (let dy = -R; dy <= R; dy++) {
    let row = "";
    for (let dx = -R; dx <= R; dx++) {
      const x = monster.pos.x + dx;
      const y = monster.pos.y + dy;
      if (x < 0 || y < 0 || x >= scene.width || y >= scene.height) {
        row += "#";
        continue;
      }
      if (x === monster.pos.x && y === monster.pos.y) {
        row += "M";
        continue;
      }
      const player = scene.players.find((p) => p.pos.x === x && p.pos.y === y);
      if (player !== undefined) {
        row += "P";
        continue;
      }
      row += scene.isWalkable(x, y) ? "." : "#";
    }
    rows.push(row);
  }
  return rows.join("\n");
}

export interface NpcDialogueContext {
  npcId: string;
  name: string;
  species: string;
  personality: string;
  role: string;
  playerName: string;
  /** Optional player-chosen topic (interaction label). */
  topic?: string;
}

export function npcDialogueSystemPrompt(ctx: NpcDialogueContext): string {
  return (
    `You are ${ctx.name}, a ${ctx.species} in Clover Village who works as a ` +
    `${ctx.role}. Personality: ${ctx.personality}. You are greeting the ` +
    `courier ${ctx.playerName} as they walk up to you.` +
    ` Clover Village is one shared, steady story: the post office runs the ` +
    `village's welcome-letter circuit (Pip, Biscuit, Maple, Lumi, Moss), and ` +
    `you are part of it — greet the courier, stay warm and cozy, small town ` +
    `animal. One or two sentences of introduction, the same village story ` +
    `every player steps into. Never invent new villagers, shops, or quests, ` +
    `and never contradict the letter circuit. Never mention being an AI or a ` +
    `model. If a scene snapshot is attached, react naturally to what you see. ` +
    `Respond with JSON ONLY in this exact shape: {"line":"<your line>"}`
  );
}

export function npcDialogueUserText(ctx: NpcDialogueContext): string {
  if (ctx.topic) {
    return `The courier says: "${ctx.topic}" (a scene snapshot may be attached — react to it if so).`;
  }
  return (
    `Give your opening line to ${ctx.playerName} — the steady village ` +
    `introduction you give every courier who walks up. (A scene snapshot may ` +
    `be attached — react to it if so.)`
  );
}
