/**
 * Minimal RouterOS API client (binary protocol, TCP 8728 / TLS 8729) for read-only commands.
 * Many ISPs disable the www/www-ssl services that the REST API needs and keep only the API.
 * Login uses the RouterOS >= 6.43 form (`/login =name= =password=`); the legacy MD5 challenge
 * is rejected with a clear error.
 */
import net from "node:net";
import tls from "node:tls";

export interface RouterOsApiOptions {
  host: string;
  port: number;
  tls: boolean;
  /** Verify the router's TLS certificate (only with `tls`). */
  tlsVerify?: boolean;
  username: string;
  password: string;
  timeoutMs?: number;
}

export type RouterOsRow = Record<string, string>;

export function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) return Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  if (len < 0x200000) return Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x10000000) return Buffer.from([(len >>> 24) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.from([0xf0, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

export function encodeSentence(words: string[]): Buffer {
  const parts = words.flatMap((w) => {
    const bytes = Buffer.from(w, "utf8");
    return [encodeLength(bytes.length), bytes];
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

/** Incremental decoder: feed bytes, get complete sentences (arrays of words). */
export class SentenceDecoder {
  private buf = Buffer.alloc(0);
  private words: string[] = [];

  push(chunk: Buffer): string[][] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const sentences: string[][] = [];
    for (;;) {
      const header = this.readLength();
      if (!header) break;
      const { len, size } = header;
      if (this.buf.length < size + len) break;
      const word = this.buf.subarray(size, size + len).toString("utf8");
      this.buf = this.buf.subarray(size + len);
      if (len === 0) {
        sentences.push(this.words);
        this.words = [];
      } else {
        this.words.push(word);
      }
    }
    return sentences;
  }

  private readLength(): { len: number; size: number } | null {
    const b = this.buf;
    if (b.length < 1) return null;
    const c = b[0]!;
    if ((c & 0x80) === 0x00) return { len: c, size: 1 };
    if ((c & 0xc0) === 0x80) return b.length < 2 ? null : { len: ((c & 0x3f) << 8) | b[1]!, size: 2 };
    if ((c & 0xe0) === 0xc0) return b.length < 3 ? null : { len: ((c & 0x1f) << 16) | (b[1]! << 8) | b[2]!, size: 3 };
    if ((c & 0xf0) === 0xe0) return b.length < 4 ? null : { len: (((c & 0x0f) << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0, size: 4 };
    return b.length < 5 ? null : { len: ((b[1]! << 24) | (b[2]! << 16) | (b[3]! << 8) | b[4]!) >>> 0, size: 5 };
  }
}

function attrs(words: string[]): RouterOsRow {
  const row: RouterOsRow = {};
  for (const w of words) {
    if (!w.startsWith("=")) continue;
    const i = w.indexOf("=", 1);
    if (i > 0) row[w.slice(1, i)] = w.slice(i + 1);
  }
  return row;
}

/** Log in, run each command in order, and return the `!re` rows of each. Read-only use only. */
export async function routerOsQuery(opts: RouterOsApiOptions, commands: string[]): Promise<RouterOsRow[][]> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const socket = opts.tls
    ? tls.connect({ host: opts.host, port: opts.port, servername: net.isIP(opts.host) ? undefined : opts.host, rejectUnauthorized: opts.tlsVerify ?? true })
    : net.connect({ host: opts.host, port: opts.port });
  const decoder = new SentenceDecoder();
  const queue: string[][] = [];
  let waiter: ((s: string[]) => void) | null = null;
  let failure: Error | null = null;
  let failWaiter: ((e: Error) => void) | null = null;

  const fail = (err: Error) => {
    failure ??= err;
    failWaiter?.(failure);
  };
  socket.setTimeout(timeoutMs, () => fail(new Error(`RouterOS API ${opts.host}:${opts.port} timed out after ${timeoutMs} ms`)));
  socket.on("error", (err) => fail(new Error(`RouterOS API ${opts.host}:${opts.port}: ${err.message}`)));
  socket.on("close", () => fail(new Error(`RouterOS API ${opts.host}:${opts.port} closed the connection`)));
  socket.on("data", (chunk: Buffer) => {
    for (const s of decoder.push(chunk)) {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(s);
      } else queue.push(s);
    }
  });

  const next = () =>
    new Promise<string[]>((resolve, reject) => {
      if (failure) return reject(failure);
      const queued = queue.shift();
      if (queued) return resolve(queued);
      waiter = resolve;
      failWaiter = reject;
    });

  async function run(words: string[]): Promise<{ rows: RouterOsRow[]; done: RouterOsRow }> {
    socket.write(encodeSentence(words));
    const rows: RouterOsRow[] = [];
    for (;;) {
      const sentence = await next();
      const [reply, ...rest] = sentence;
      if (reply === "!re") rows.push(attrs(rest));
      else if (reply === "!done") return { rows, done: attrs(rest) };
      else if (reply === "!trap" || reply === "!fatal") {
        const message = attrs(rest).message ?? rest.join(" ");
        // A trap is followed by !done; drain it so the next command starts clean.
        if (reply === "!trap") await next().catch(() => undefined);
        throw new Error(`RouterOS ${words[0]}: ${message}`);
      }
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      if (failure) return reject(failure);
      failWaiter = reject;
      socket.once(opts.tls ? "secureConnect" : "connect", () => resolve());
    });
    const login = await run(["/login", `=name=${opts.username}`, `=password=${opts.password}`]).catch((err: Error) => {
      const router = err.message.replace(/^RouterOS \/login: /, "");
      const hints = [`user "${opts.username}"`];
      if (opts.password !== opts.password.trim()) hints.push("password has leading/trailing whitespace");
      if (!opts.password) hints.push("password is empty");
      if (/^\*+(REDACTED)?\*+$/.test(opts.password)) hints.push("password is a masked placeholder, re-enter the secret value");
      throw new Error(
        /invalid user name or password|cannot log in/i.test(router)
          ? `RouterOS API login failed: check username/password and that the user group has the "api" policy (router said: ${router}; ${hints.join(", ")})`
          : `RouterOS API login failed: ${router}`,
      );
    });
    if (login.done.ret) throw new Error("RouterOS API uses the pre-6.43 challenge login; upgrade RouterOS to 6.43 or newer");
    const results: RouterOsRow[][] = [];
    for (const cmd of commands) results.push((await run([cmd])).rows);
    return results;
  } finally {
    socket.destroy();
  }
}
