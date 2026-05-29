import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT_ENV = process.env.VIGILI_HOME ?? process.env.SENTINEL_HOME;

/**
 * ~/.vigili または $VIGILI_HOME (テストや一時環境向けのオーバーライド)。
 * リブランド過渡期: ~/.vigili が無く ~/.sentinel が在る場合は後者を返す
 * (旧設定で起動できるための fallback。初回起動時にコピー or 自分で mv 推奨)。
 */
export function sentinelHome(): string {
  if (ROOT_ENV) return ROOT_ENV;
  const newHome = join(homedir(), ".vigili");
  const oldHome = join(homedir(), ".sentinel");
  if (!existsSync(newHome) && existsSync(oldHome)) return oldHome;
  return newHome;
}

export interface SentinelPaths {
  home: string;
  socket: string;
  db: string;
  policy: string;
  /** PWA からの promote が追記される自動生成ポリシー。loader でマージされる。 */
  policyGenerated: string;
  config: string;
  token: string;
  pid: string;
  log: string;
  /** Web Push の VAPID 鍵 (起動時に生成・永続化)。 */
  vapid: string;
  /** Web Push subscription 永続化先 (atomic JSON write)。 */
  pushSubs: string;
  /**
   * Relay user_token のキャッシュ (`vigili-cli pair` 時に書き出される)。
   * `vigili-daemon qr` が unified QR を生成するために使う (0600)。
   */
  relayUserToken: string;
}

export function paths(home: string = sentinelHome()): SentinelPaths {
  return {
    home,
    socket: join(home, "daemon.sock"),
    db: join(home, "queue.db"),
    policy: join(home, "policy.yaml"),
    policyGenerated: join(home, "policy.generated.yaml"),
    config: join(home, "config.yaml"),
    token: join(home, "token"),
    pid: join(home, "daemon.pid"),
    log: join(home, "daemon.log"),
    vapid: join(home, "vapid.json"),
    pushSubs: join(home, "push-subs.json"),
    relayUserToken: join(home, "relay-user-token"),
  };
}
