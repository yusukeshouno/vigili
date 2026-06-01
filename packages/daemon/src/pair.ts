/**
 * `vigili-cli pair` の実装。
 *
 * 1. relay (`https://relay.vigili.io` 等) に signin (なければ signup) して session token を得る
 * 2. POST /v1/pairings で agent_key + user_token を発行
 * 3. ~/.vigili/config.yaml に relay: セクションを追記 (既存があれば置換)
 * 4. `vigili://pair?p=<pid>&u=<user_token>&r=<relay_url>` を QR 表示 (iOS に取り込ませる)
 * 5. 反映には daemon 再起動 (or SIGHUP では足りない — relay client は起動時に貼るので
 *    本来は再起動が必要だが、ホットリロード未対応である旨を案内する)
 */

import { createInterface } from "node:readline/promises";
import { writeRelayConfig } from "./config.js";
import { paths } from "./paths.js";

interface PairingResponse {
  id: string;
  name: string | null;
  agent_key: string;
  user_token: string;
  created_at: number;
}

interface SessionResponse {
  account: { id: string; email: string };
  session: { token: string; expires_at: number };
}

export async function pair(args: string[]): Promise<number> {
  const relayUrl = takeOption(args, "--relay") ?? "https://relay.vigili.io";
  const name = takeOption(args, "--name");
  const explicitEmail = takeOption(args, "--email");
  const forceSignup = args.includes("--signup");
  const plain = args.includes("--plain");
  const skipConfig = args.includes("--no-config");

  // 1. 認証情報を集める
  const email = explicitEmail ?? (await prompt("Email: "));
  if (!email || !/.+@.+\..+/u.test(email)) {
    console.error(`[vigili-cli] 無効な email: ${email}`);
    return 1;
  }
  const password = await promptHidden("Password: ");
  if (password.length < 8) {
    console.error("[vigili-cli] password は 8 文字以上必要です");
    return 1;
  }

  // 2. signin / signup
  const baseUrl = relayUrl.replace(/\/$/, "");
  let session: SessionResponse;
  try {
    session = forceSignup
      ? await callRelay<SessionResponse>("POST", `${baseUrl}/v1/signup`, undefined, {
          email,
          password,
        })
      : await callRelay<SessionResponse>("POST", `${baseUrl}/v1/signin`, undefined, {
          email,
          password,
        });
  } catch (err) {
    const e = err as RelayError;
    if (!forceSignup && e.status === 401) {
      // 「アカウント無さそう?」を聞いて signup を試す
      const confirm = await prompt("アカウントが見つかりません。新規作成しますか? [y/N]: ");
      if (!/^y/iu.test(confirm)) return 1;
      try {
        session = await callRelay<SessionResponse>("POST", `${baseUrl}/v1/signup`, undefined, {
          email,
          password,
        });
      } catch (signupErr) {
        console.error(`[vigili-cli] signup 失敗: ${(signupErr as Error).message}`);
        return 1;
      }
    } else {
      console.error(`[vigili-cli] ${forceSignup ? "signup" : "signin"} 失敗: ${e.message}`);
      return 1;
    }
  }

  // 3. pairing を作る
  let pairing: PairingResponse;
  try {
    pairing = await callRelay<PairingResponse>(
      "POST",
      `${baseUrl}/v1/pairings`,
      session.session.token,
      name ? { name } : {},
    );
  } catch (err) {
    console.error(`[vigili-cli] pairing 作成失敗: ${(err as Error).message}`);
    return 1;
  }

  // 4. config.yaml を更新
  if (!skipConfig) {
    try {
      writeRelayConfig(paths().config, {
        url: baseUrl,
        pairing_id: pairing.id,
        agent_key: pairing.agent_key,
      });
    } catch (err) {
      console.error(`[vigili-cli] config.yaml の書き込みに失敗: ${(err as Error).message}`);
      console.error("(--no-config で続行できます)");
      return 1;
    }
    // user_token はサーバ側にはハッシュしか残らない一方、 後で `vigili-daemon qr`
    // から unified QR を出すために必要なので、ローカルにキャッシュしておく (0600)。
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(paths().relayUserToken, pairing.user_token, { mode: 0o600 });
    } catch (err) {
      // ベストエフォート: 失敗しても pairing 自体は成功扱い
      console.error(`[vigili-cli] user_token cache 失敗 (続行可): ${(err as Error).message}`);
    }
  }

  // 5. iOS 用 URL + QR — 可能なら LAN 情報も同梱して unified QR にする
  const lanInfo = await tryDetectLan().catch(() => null);
  let pairUrl: string;
  if (lanInfo) {
    pairUrl =
      `vigili://setup?u=${encodeURIComponent(lanInfo.url)}` +
      `&t=${encodeURIComponent(lanInfo.token)}` +
      `&r=${encodeURIComponent(baseUrl)}` +
      `&p=${encodeURIComponent(pairing.id)}` +
      `&k=${encodeURIComponent(pairing.user_token)}`;
  } else {
    // LAN 情報を拾えなかった場合は relay-only QR
    pairUrl =
      `vigili://pair?p=${encodeURIComponent(pairing.id)}` +
      `&u=${encodeURIComponent(pairing.user_token)}` +
      `&r=${encodeURIComponent(baseUrl)}`;
  }

  if (plain) {
    console.log(pairUrl);
    return 0;
  }

  console.log("");
  console.log("  Scan this QR with Vigili iOS app:");
  console.log("");
  const mod = await import("qrcode-terminal");
  const qr = (mod.default ?? mod) as {
    generate: (text: string, opts?: { small?: boolean }, cb?: (output: string) => void) => void;
  };
  qr.generate(pairUrl, { small: true }, (output) => {
    console.log(output);
  });
  console.log("");
  console.log(`  Pairing ID:    ${pairing.id}`);
  console.log(`  Relay URL:     ${baseUrl}`);
  console.log(`  Agent key:     ${pairing.agent_key.slice(0, 6)}…${pairing.agent_key.slice(-4)}`);
  console.log(`  User token:    ${pairing.user_token.slice(0, 6)}…${pairing.user_token.slice(-4)}`);
  if (!skipConfig) {
    console.log("");
    console.log(`  ✓ ${paths().config} に relay: セクションを書き込みました`);
    console.log("  次に: daemon を再起動して relay 接続を有効化");
    console.log("    launchctl kickstart -k gui/$(id -u)/io.vigili.daemon");
  }
  console.log("");
  return 0;
}

// ---------- LAN detection (for unified QR) ----------

interface LanInfo {
  url: string; // 例: "192.168.1.10:7878"
  token: string;
}

async function tryDetectLan(): Promise<LanInfo | null> {
  const p = paths();
  // token がなければ daemon が一度も起動していない → LAN 情報なし
  let token: string;
  try {
    const { readFileSync } = await import("node:fs");
    token = readFileSync(p.token, "utf-8").trim();
  } catch {
    return null;
  }
  if (!token) return null;
  const { detectPublicHost } = await import("./setup-qr.js");
  const host = await detectPublicHost();
  if (!host) return null;
  return { url: host, token };
}

// ---------- HTTP helpers ----------

interface RelayError extends Error {
  status: number;
  body: unknown;
}

async function callRelay<T>(
  method: "GET" | "POST",
  url: string,
  bearer: string | undefined,
  body: unknown,
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep parsed = null */
    }
  }
  if (!res.ok) {
    const detail = (parsed as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    const err: RelayError = Object.assign(new Error(detail), {
      status: res.status,
      body: parsed,
    });
    throw err;
  }
  return parsed as T;
}

// ---------- prompt helpers ----------

function takeOption(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

async function prompt(label: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(label);
    return answer.trim();
  } finally {
    rl.close();
  }
}

/**
 * stdin が TTY なら echo を切って読み、そうでなければ普通に一行読む。
 */
async function promptHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) {
    return prompt(label);
  }
  return new Promise<string>((resolve, reject) => {
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");
    let buf = "";
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 0x03) {
          // Ctrl-C
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          reject(new Error("aborted"));
          return;
        }
        if (code === 0x0d || code === 0x0a) {
          // Enter
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(buf);
          return;
        }
        if (code === 0x7f || code === 0x08) {
          // Backspace
          if (buf.length > 0) buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}
