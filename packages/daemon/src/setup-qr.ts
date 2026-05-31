import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { paths } from "./paths.js";

/**
 * `vigili-daemon qr` / `vigili-cli setup-qr` の共通実装。
 * LAN IP か Tailscale FQDN を検出して `vigili://setup?u=...&t=...[&r=...&p=...&k=...]` を出力する。
 *
 * Relay 設定 (config.yaml + 保存済み user_token) が揃っているときは relay 情報も同梱して
 * 1 つの QR で LAN + 外出先の両方に対応させる。
 */
export async function runSetupQr(args: string[]): Promise<number> {
  const urlIdx = args.indexOf("--url");
  const explicitUrl = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  const plain = args.includes("--plain");
  const useJson = args.includes("--json");

  const p = paths();

  let token: string;
  try {
    token = readFileSync(p.token, "utf-8").trim();
  } catch (err) {
    console.error(`[vigili] token を読めません: ${(err as Error).message}`);
    console.error(`(daemon を一度起動すると ${p.token} が生成されます)`);
    return 1;
  }

  let url: string;
  if (explicitUrl) {
    url = explicitUrl;
  } else {
    const detected = await detectPublicHost();
    if (!detected) {
      console.error(
        "[vigili] LAN IP / Tailscale FQDN を自動検出できません。--url で明示してください。",
      );
      return 1;
    }
    url = detected;
  }

  // relay 設定 (config.yaml に relay: 節 + キャッシュされた user_token) があれば
  // unified QR を組み立てる。
  const relay = readRelayInfo();

  let payload: string;
  if (useJson) {
    const obj: Record<string, string> = { u: url, t: token };
    if (relay) {
      obj.r = relay.url;
      obj.p = relay.pairingId;
      obj.k = relay.userToken;
    }
    payload = JSON.stringify(obj);
  } else {
    let qs = `u=${encodeURIComponent(url)}&t=${encodeURIComponent(token)}`;
    if (relay) {
      qs +=
        `&r=${encodeURIComponent(relay.url)}` +
        `&p=${encodeURIComponent(relay.pairingId)}` +
        `&k=${encodeURIComponent(relay.userToken)}`;
    }
    payload = `vigili://setup?${qs}`;
  }

  if (plain) {
    console.log(payload);
    return 0;
  }

  console.log("");
  console.log("  Scan this QR with iPhone Camera or Vigili app:");
  console.log("");
  const mod = await import("qrcode-terminal");
  const qr = (mod.default ?? mod) as {
    generate: (text: string, opts?: { small?: boolean }, cb?: (output: string) => void) => void;
  };
  qr.generate(payload, { small: true }, (output) => {
    console.log(output);
  });
  console.log("");
  console.log(`  URL:    ${url}`);
  console.log(`  Token:  ${token.slice(0, 8)}…${token.slice(-4)} (${token.length} chars)`);
  if (relay) {
    console.log(`  Relay:  ${relay.url}  (pid ${relay.pairingId.slice(0, 8)}…)`);
    console.log("  → 外出先でも繋がるよう unified QR (LAN + relay) を生成しました");
  } else {
    console.log("  Relay:  未設定 (`vigili-cli pair` で外出先用も追加できます)");
  }
  console.log("");
  return 0;
}

interface RelayInfo {
  url: string;
  pairingId: string;
  userToken: string;
}

function readRelayInfo(): RelayInfo | null {
  const p = paths();
  if (!existsSync(p.config) || !existsSync(p.relayUserToken)) return null;
  try {
    const raw = readFileSync(p.config, "utf-8");
    const parsed = parseYaml(raw) as { relay?: { url?: string; pairing_id?: string } } | null;
    const r = parsed?.relay;
    if (!r?.url || !r?.pairing_id) return null;
    const userToken = readFileSync(p.relayUserToken, "utf-8").trim();
    if (!userToken) return null;
    return { url: r.url, pairingId: r.pairing_id, userToken };
  } catch {
    return null;
  }
}

export async function detectPublicHost(): Promise<string | null> {
  const lan = detectLanIp();
  if (lan) return `${lan}:7878`;
  return detectTailscaleHost();
}

function detectLanIp(): string | null {
  const ifaces = networkInterfaces();
  const order = ["en0", "en1", "en2", "en3"];
  const keys = Object.keys(ifaces).sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai < 0 && bi < 0) return a.localeCompare(b);
    if (ai < 0) return 1;
    if (bi < 0) return -1;
    return ai - bi;
  });
  for (const name of keys) {
    const addrs = ifaces[name];
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      return a.address;
    }
  }
  return null;
}

function detectTailscaleHost(): Promise<string | null> {
  return new Promise((resolve) => {
    const candidates = [
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      "/usr/local/bin/tailscale",
      "/opt/homebrew/bin/tailscale",
      "tailscale",
    ];
    let idx = 0;
    const tryNext = (): void => {
      if (idx >= candidates.length) {
        resolve(null);
        return;
      }
      const bin = candidates[idx++] as string;
      const child = spawn(bin, ["status", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString("utf-8");
      });
      child.on("error", () => tryNext());
      child.on("exit", (code) => {
        if (code !== 0) {
          tryNext();
          return;
        }
        try {
          const parsed = JSON.parse(out) as { Self?: { DNSName?: string } };
          const dns = (parsed.Self?.DNSName ?? "").replace(/\.$/u, "");
          resolve(dns.length > 0 ? dns : null);
        } catch {
          resolve(null);
        }
      });
    };
    tryNext();
  });
}
