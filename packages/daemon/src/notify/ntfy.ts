import type { ApprovalRequest } from "@vigili/shared";
import type { Notifier } from "./types.js";
export type { Notifier, NotifyInput } from "./types.js";
export { NULL_NOTIFIER } from "./types.js";

export interface NtfyConfig {
  server: string;
  topic: string;
  priority: {
    normal: number;
    critical: number;
  };
  /** PWA の公開 URL。設定すると ntfy 通知タップで /r/[id] に飛ぶ。 */
  pwaBaseUrl?: string;
}

type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

/** ntfy.sh への HTTP POST クライアント。SPEC §3.6 準拠。 */
export function createNtfyNotifier(
  config: NtfyConfig,
  fetcher: Fetcher = (url, init) => globalThis.fetch(url, init),
  log: (msg: string) => void = (m) => console.error(m),
): Notifier {
  const base = config.server.replace(/\/$/u, "");
  const url = `${base}/${encodeURIComponent(config.topic)}`;

  return {
    async notify(input) {
      const priority =
        input.level === "critical" ? config.priority.critical : config.priority.normal;
      // ntfy: ヘッダ値は ASCII でなければならない (fetch の ByteString 制約)。
      // ルール名に非 ASCII (例: 日本語) が含まれるため UTF-8 を URL エンコードする。
      // ntfy は X-Title の percent-encoded UTF-8 をデコードして表示する (docs.ntfy.sh)。
      const headers: Record<string, string> = {
        "X-Title": encodeHeaderValue(`Vigili: ${input.ruleSource}`),
        "X-Priority": String(priority),
        "X-Tags": input.level === "critical" ? "warning,sentinel" : "sentinel",
        "Content-Type": "text/plain; charset=utf-8",
      };
      // タップで Detail に飛ぶ click URL。ntfy iOS app は X-Click ヘッダで開く。
      if (config.pwaBaseUrl) {
        const base = config.pwaBaseUrl.replace(/\/$/u, "");
        headers["X-Click"] = `${base}/r/${input.request.id}`;
      }
      const body = formatBody(input.request);
      try {
        const res = await fetcher(url, { method: "POST", headers, body });
        if (!res.ok) {
          log(`[vigili-ntfy] ntfy が ${res.status} を返しました`);
        }
      } catch (err) {
        log(`[vigili-ntfy] POST 失敗: ${(err as Error).message}`);
      }
    },
  };
}

/**
 * 非 ASCII を percent-encoded UTF-8 に変換する。
 * encodeURIComponent との違いは「ASCII 範囲は無変換で残す」点 (`,` `:` `/` 等)。
 */
export function encodeHeaderValue(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out += ch;
    } else {
      out += encodeURIComponent(ch);
    }
  }
  return out;
}

export function formatBody(req: ApprovalRequest): string {
  const tag = req.session_tag ?? "?";
  if (req.tool_name === "Bash") {
    const cmd = stringField(req.tool_input, "command");
    return `[${tag}] $ ${truncate(cmd ?? "(no command)", 200)}`;
  }
  if (req.tool_name === "Edit" || req.tool_name === "Write") {
    const p = stringField(req.tool_input, "file_path") ?? stringField(req.tool_input, "path");
    return `[${tag}] ${req.tool_name} ${truncate(p ?? "(no path)", 200)}`;
  }
  if (req.tool_name === "WebFetch") {
    const u = stringField(req.tool_input, "url");
    return `[${tag}] WebFetch ${truncate(u ?? "(no url)", 200)}`;
  }
  return `[${tag}] ${req.tool_name} ${truncate(JSON.stringify(req.tool_input), 200)}`;
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
