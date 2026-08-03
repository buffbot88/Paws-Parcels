import type { IncomingMessage, ServerResponse } from "node:http";
import { requireAccount } from "../middleware/auth.ts";
import { errorResponse, jsonResponse } from "../middleware/index.ts";
import { getCharacterById } from "../models/Character.ts";
import {
  WS_TOKEN_TTL_SECONDS,
  issueWsToken,
} from "../ws/tokenStore.ts";

/**
 * GET /api/ws-token?characterId=5
 * Issues a short-lived, single-use WebSocket handshake token for a character
 * the authenticated account owns (design/architecture.md §5).
 */
export async function wsTokenHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const account = await requireAccount(req, res);
  if (account === null) return;

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const raw = url.searchParams.get("characterId") ?? "";
  const characterId = Number(raw);
  if (!Number.isInteger(characterId) || characterId < 1) {
    errorResponse(res, 400, "INVALID_CHARACTER_ID", "characterId query param must be a positive integer");
    return;
  }

  const character = await getCharacterById(characterId);
  // Ownership check: never reveal whether a character exists for another account.
  if (character === null || character.account_id !== account.id) {
    errorResponse(res, 404, "CHARACTER_NOT_FOUND", "No such character for this account");
    return;
  }

  const wsToken = issueWsToken(account.id, characterId);
  jsonResponse(res, 200, {
    wsToken,
    expiresIn: WS_TOKEN_TTL_SECONDS,
    characterId,
    zoneId: character.zone_id,
  });
}
