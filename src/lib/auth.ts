/**
 * Lightweight auth wrapper. Stores a logged-in user (email + team_id) in
 * localStorage. Designed to be drop-in upgradable to real Google OAuth:
 *   - Replace `mockGoogleLogin` with the credential exchange against your
 *     backend (POST /auth/google with the Google ID token).
 *   - The backend validates the Google ID token, looks up / creates a user,
 *     returns a session token + team_id. Store that here.
 */
const STORAGE_KEY = "aethena.auth.v1";

export interface AuthUser {
  email: string;
  name?: string;
  team_id: string;
  picture?: string;
  /** Optional opaque session token for future backend use. */
  token?: string;
}

function read(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function write(u: AuthUser | null) {
  if (!u) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  // Notify listeners in this tab
  window.dispatchEvent(new CustomEvent("aethena-auth-change"));
}

export const auth = {
  current(): AuthUser | null {
    return read();
  },
  isAuthed(): boolean {
    return read() !== null;
  },
  signInWithEmail(email: string, name?: string): AuthUser {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/.+@.+\..+/.test(trimmed)) {
      throw new Error("Enter a valid email address.");
    }
    // Deterministic team_id from email — keeps self-learning per team.
    const team_id = teamIdFromEmail(trimmed);
    const user: AuthUser = { email: trimmed, name, team_id };
    write(user);
    return user;
  },
  signOut() {
    write(null);
  },
  /** Subscribe to login/logout events. */
  onChange(cb: (u: AuthUser | null) => void): () => void {
    const handler = () => cb(read());
    window.addEventListener("aethena-auth-change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("aethena-auth-change", handler);
      window.removeEventListener("storage", handler);
    };
  },
  /** Mock Google sign-in. Replace with real OAuth wiring when client_id is configured. */
  async mockGoogleLogin(): Promise<AuthUser> {
    // Pretend to do an OAuth round-trip. In a real impl, this is replaced by
    // the @react-oauth/google credential -> backend exchange.
    const fakeEmail = `demo-${Math.random().toString(36).slice(2, 8)}@gmail.com`;
    const user: AuthUser = {
      email: fakeEmail,
      name: "Demo Scientist",
      team_id: teamIdFromEmail(fakeEmail),
    };
    write(user);
    return user;
  },
};

function teamIdFromEmail(email: string): string {
  // Stable hex digest -> uuid-shaped string. Matches the seeded "Husky Lab"
  // team id when email is empty so the demo team continues to work.
  if (!email) return "00000000-0000-0000-0000-000000000001";
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < email.length; i++) {
    h = BigInt.asUintN(64, (h ^ BigInt(email.charCodeAt(i))) * 0x100000001b3n);
  }
  const hex = h.toString(16).padStart(16, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-0000-000000000000`;
}
