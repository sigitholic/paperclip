/**
 * Operator check for the RouterOS API login, independent of Paperclip secrets.
 * The password is read from a hidden prompt (or ROUTEROS_PASSWORD) and never printed.
 *
 *   pnpm --filter @starnet/plugin-pack-isp routeros:check --host 192.168.36.1 --user noc-ro [--port 8728] [--tls]
 */
import { stdin, stdout } from "node:process";
import { routerOsQuery } from "../src/routeros-api.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hiddenPrompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(question);
    let value = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

const host = arg("host");
const username = arg("user");
if (!host || !username) {
  console.error("usage: --host <ip> --user <name> [--port 8728] [--tls]");
  process.exit(2);
}
const tls = process.argv.includes("--tls");
const port = Number(arg("port") ?? (tls ? 8729 : 8728));
const password = process.env.ROUTEROS_PASSWORD ?? (await hiddenPrompt(`RouterOS password for ${username}: `));
console.log(`password: ${password.length} chars, ${/^[\x20-\x7e]*$/.test(password) ? "printable ASCII only" : "contains non-ASCII or control characters"}`);

try {
  const [res] = await routerOsQuery({ host, port, tls, tlsVerify: false, username, password, timeoutMs: 8000 }, ["/system/resource/print"]);
  const r = res?.[0] ?? {};
  console.log(`login OK: ${r["board-name"] ?? "?"} RouterOS ${r.version ?? "?"}, cpu ${r["cpu-load"] ?? "?"}%`);
} catch (err) {
  console.error(`login FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
}
