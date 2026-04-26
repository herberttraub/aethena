// Single source for the FastAPI base URL. Read from Vite env at build time;
// fall back to localhost when running `npm run dev` without a .env override.
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8765";
