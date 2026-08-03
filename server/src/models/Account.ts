/** Account model — represents a human player's identity. */
export interface Account {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  status: "active" | "banned";
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

/** Account creation request (sanitized, no hash). */
export interface AccountCreateRequest {
  email: string;
  username: string;
  password: string;
}

/** Public account representation (no password_hash). */
export interface AccountPublic {
  id: number;
  email: string;
  username: string;
  status: string;
  created_at: string;
}

export function toPublicAccount(account: Account): AccountPublic {
  return {
    id: account.id,
    email: account.email,
    username: account.username,
    status: account.status,
    created_at: account.created_at.toISOString(),
  };
}