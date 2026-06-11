import { readFileSync, writeFileSync } from "node:fs";
import { type AskMode, AskModeSchema } from "@vigili/shared";

/**
 * ask ルーティングモード (SPEC §2.6) の永続化。
 *
 * daemon が単一の真実として持ち、再起動を跨いで維持する。
 * ファイルが無い・壊れている場合は安全側のデフォルト "integrated"
 * (= Vigili に出す現行動作) に倒す。
 */

export function loadAskMode(path: string): AskMode {
  try {
    const raw = readFileSync(path, "utf-8").trim();
    const parsed = AskModeSchema.safeParse(raw);
    return parsed.success ? parsed.data : "integrated";
  } catch {
    return "integrated";
  }
}

export function saveAskMode(path: string, mode: AskMode): void {
  writeFileSync(path, `${mode}\n`, { mode: 0o600 });
}
