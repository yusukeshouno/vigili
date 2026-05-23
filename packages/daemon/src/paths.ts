import { homedir } from "node:os";
import { join } from "node:path";

const ROOT_ENV = process.env.SENTINEL_HOME;

/** ~/.sentinel または $SENTINEL_HOME (テストや一時環境向けのオーバーライド)。 */
export function sentinelHome(): string {
  return ROOT_ENV ?? join(homedir(), ".sentinel");
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
  };
}
