/**
 * Real backend auth: bcrypt-hashed passwords, JWT bearer token.
 * The token is stored in localStorage. Every authenticated API call
 * pulls it via `auth.token()` and sets `Authorization: Bearer <token>`.
 */
import { API_BASE } from "./api-base";

const TOKEN_KEY = "aethena.auth.token";
const USER_KEY = "aethena.auth.user";

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  team_id: string;
  role?: string | null;
  research_type?: string | null;
  institution?: string | null;
  onboarded?: boolean;
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function readUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeSession(token: string | null, user: AuthUser | null) {
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
  if (!user) localStorage.removeItem(USER_KEY);
  else localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new CustomEvent("aethena-auth-change"));
}

async function jpost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data?.detail as string) || r.statusText || "Request failed";
    throw new Error(msg);
  }
  return data as T;
}

async function jput<T>(path: string, body: unknown, token: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data?.detail as string) || r.statusText || "Request failed";
    throw new Error(msg);
  }
  return data as T;
}

export const auth = {
  token(): string | null {
    return readToken();
  },
  current(): AuthUser | null {
    return readUser();
  },
  isAuthed(): boolean {
    return !!readToken();
  },
  async register(email: string, password: string, name?: string): Promise<AuthUser> {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/.+@.+\..+/.test(trimmed)) {
      throw new Error("Enter a valid email address.");
    }
    if ((password || "").length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    const data = await jpost<{ token: string; user: AuthUser }>("/auth/register", {
      email: trimmed,
      password,
      name: name || undefined,
    });
    writeSession(data.token, data.user);
    return data.user;
  },
  async signIn(email: string, password: string): Promise<AuthUser> {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !password) throw new Error("Enter your email and password.");
    const data = await jpost<{ token: string; user: AuthUser }>("/auth/login", {
      email: trimmed,
      password,
    });
    writeSession(data.token, data.user);
    return data.user;
  },
  async updateProfile(patch: {
    name?: string;
    role?: string;
    research_type?: string;
    institution?: string;
  }): Promise<AuthUser> {
    const token = readToken();
    if (!token) throw new Error("Not signed in.");
    const data = await jput<{ user: AuthUser }>("/auth/profile", patch, token);
    writeSession(token, data.user);
    return data.user;
  },
  signOut() {
    writeSession(null, null);
  },
  /** Subscribe to login/logout events. */
  onChange(cb: (u: AuthUser | null) => void): () => void {
    const handler = () => cb(readUser());
    window.addEventListener("aethena-auth-change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("aethena-auth-change", handler);
      window.removeEventListener("storage", handler);
    };
  },
};
