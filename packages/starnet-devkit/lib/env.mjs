// Environment guard shared by every devkit script.
// The box's DATABASE_URL points at another (Starnet production-like) Postgres. The devkit only
// talks REST to a local Paperclip instance, but child processes must never inherit that URL.
export function guardEnv() {
  if (process.env.DATABASE_URL) delete process.env.DATABASE_URL;
  const base = (process.env.PAPERCLIP_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
  const host = new URL(base).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && process.env.STARNET_DEVKIT_ALLOW_REMOTE !== "1") {
    throw new Error(`devkit refuses non-local PAPERCLIP_URL (${host}); set STARNET_DEVKIT_ALLOW_REMOTE=1 if you really mean it`);
  }
  return { base };
}
