import type { ApprovalRequest, NotifyLevel } from "@vigili/shared";

/**
 * notify 経路の共通インタフェース。
 *
 * notify は fire-and-forget。失敗時のリトライは個別実装に任せる。
 * fan-out 用に複数 notifier を束ねる `multiNotifier()` も提供する。
 */

export interface NotifyInput {
  request: ApprovalRequest;
  level: NotifyLevel;
  /** どのルールが ask を出したか (例: "rule:.env / secrets への書き込み")。タイトルに使う。 */
  ruleSource: string;
}

export interface Notifier {
  notify(input: NotifyInput): Promise<void>;
}

/** ノーオペ Notifier。設定が無い / disabled なときに使う。 */
export const NULL_NOTIFIER: Notifier = {
  async notify() {
    /* no-op */
  },
};

/**
 * 複数 Notifier を並列に走らせる。
 * 個別の失敗は throw せず、全ての notify を Promise.allSettled で待つ。
 */
export function multiNotifier(notifiers: Notifier[]): Notifier {
  const active = notifiers.filter((n) => n !== NULL_NOTIFIER);
  if (active.length === 0) return NULL_NOTIFIER;
  if (active.length === 1) return active[0] as Notifier;
  return {
    async notify(input) {
      await Promise.allSettled(active.map((n) => n.notify(input)));
    },
  };
}
