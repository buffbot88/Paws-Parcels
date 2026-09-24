import type { IncomingMessage, ServerResponse } from "node:http";
import { requireAccount } from "../middleware/auth.ts";
import { errorResponse, jsonResponse } from "../middleware/index.ts";
import {
  createCharacter,
  getCharactersByAccountId,
  getCharacterById,
  getCharacterProfile,
  toPublicCharacter,
  unlockSkill,
} from "../models/Character.ts";
import {
  getCharacterClassById,
  getCharacterClasses,
  toPublicClass,
} from "../models/CharacterClass.ts";
import { logger } from "../middleware/logger.ts";
import { normalizeAppearance } from "../../../src/game/appearance.ts";
import { toClassKey } from "../../../src/game/classStats.ts";

/** Name rules for new characters (cozy, kebab-safe, ≤ 50 chars like the DB). */
const NAME_RE = /^[a-zA-Z0-9 _'.-]+$/;
const NAME_MAX = 50;

/**
 * GET /api/characters
 * List the authenticated account's characters (empty array for a fresh
 * account — the client then shows the creation screen).
 */
export async function listCharactersHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const account = await requireAccount(req, res);
  if (account === null) return;

  const characters = await getCharactersByAccountId(account.id);
  jsonResponse(res, 200, {
    characters: characters.map(toPublicCharacter),
  });
}

/**
 * GET /api/characters/:characterId/profile
 * Return the authoritative profile, inventory, and class skill tree.
 */
export async function characterProfileHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const account = await requireAccount(req, res);
  if (account === null) return;
  const characterId = Number(params?.characterId ?? "");
  if (!Number.isInteger(characterId) || characterId < 1) {
    errorResponse(res, 400, "INVALID_CHARACTER_ID", "characterId must be a positive integer");
    return;
  }
  const character = await getCharacterById(characterId);
  if (character === null || character.account_id !== account.id) {
    errorResponse(res, 404, "CHARACTER_NOT_FOUND", "No such character for this account");
    return;
  }
  const profile = await getCharacterProfile(characterId);
  if (profile === null) {
    errorResponse(res, 404, "CHARACTER_NOT_FOUND", "No such character for this account");
    return;
  }
  jsonResponse(res, 200, { profile });
}

/**
 * POST /api/characters/:characterId/skills/:skillKey/unlock
 * Unlock a server-validated skill and return the fresh profile.
 */
export async function unlockSkillHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
): Promise<void> {
  const account = await requireAccount(req, res);
  if (account === null) return;
  const characterId = Number(params?.characterId ?? "");
  const skillKey = params?.skillKey ?? "";
  const character = Number.isInteger(characterId) ? await getCharacterById(characterId) : null;
  if (character === null || character.account_id !== account.id) {
    errorResponse(res, 404, "CHARACTER_NOT_FOUND", "No such character for this account");
    return;
  }
  const result = await unlockSkill(characterId, skillKey);
  if (!result.ok) {
    const status = result.reason === "SKILL_NOT_FOUND" || result.reason === "WRONG_CLASS" ? 404 : 409;
    errorResponse(res, status, result.reason, "That skill cannot be unlocked yet");
    return;
  }
  jsonResponse(res, 200, { profile: result.profile });
}

/**
 * GET /api/classes
 * The playable class catalog for the creation screen (id, key, display name,
 * base stats, resource family).
 */
export async function classesHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const account = await requireAccount(req, res);
  if (account === null) return;

  const classes = await getCharacterClasses();
  jsonResponse(res, 200, { classes: classes.map(toPublicClass) });
}

/**
 * POST /api/characters
 * Body: { name: string, class_id: number, appearance?: object }
 * Creates a character (+ derived character_stats + starter inventory) for the
 * authenticated account. Validates name shape, class existence, and the
 * per-account name unique index.
 */
export async function createCharacterHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const account = await requireAccount(req, res);
  if (account === null) return;

  const body = (req as unknown as { body?: Record<string, unknown> }).body;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const classId = body?.class_id;
  const appearanceRaw = body?.appearance;

  if (name.length < 2 || name.length > NAME_MAX || !NAME_RE.test(name)) {
    errorResponse(
      res,
      400,
      "INVALID_NAME",
      `name must be 2-${NAME_MAX} characters using letters, numbers, spaces, ' - . _`,
    );
    return;
  }
  if (typeof classId !== "number" || !Number.isInteger(classId) || classId < 1) {
    errorResponse(res, 400, "INVALID_CLASS_ID", "class_id must be a positive integer");
    return;
  }

  const cls = await getCharacterClassById(classId);
  if (cls === null) {
    errorResponse(res, 400, "CLASS_NOT_FOUND", "No class exists with that id");
    return;
  }

  const appearance = normalizeAppearance(appearanceRaw, toClassKey(cls.key));
  const result = await createCharacter({
    accountId: account.id,
    name,
    classId,
    appearance,
    cls,
  });

  if (!result.ok) {
    errorResponse(
      res,
      409,
      "NAME_TAKEN",
      "You already have a courier with that name — try another",
    );
    return;
  }

  logger.info("Character created", {
    accountId: account.id,
    characterId: result.character.id,
    name: result.character.name,
    classId,
  });
  jsonResponse(res, 201, { character: toPublicCharacter(result.character) });
}
