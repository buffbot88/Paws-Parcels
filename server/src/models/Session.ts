/** Refresh token / session model. */
export interface RefreshToken {
  id: number;
  account_id: number;
  refresh_token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  last_used_at: Date | null;
  user_agent: string | null;
  ip: string | null;
}

/** Token pair returned to the client. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}