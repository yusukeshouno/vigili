/**
 * pairing-id ごとの WS Hub。
 *
 * - agent (Mac daemon) はペアリング毎に最大 1 接続。新しい接続が来たら古いものは切断する。
 * - client (iPhone app など) はペアリング毎に複数接続を許容。
 * - agent → clients への fan-out、clients → agent への転送、agent オン/オフライン通知。
 *
 * メッセージはバイト列のまま転送する (中身はリレーが解釈しない)。例外として
 * agent-status は relay が独自に挿入する。
 */

export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Pairing {
  agent: HubSocket | null;
  clients: Set<HubSocket>;
}

export interface PairingHub {
  attachAgent(pid: string, ws: HubSocket): { detach: () => void };
  attachClient(pid: string, ws: HubSocket): { detach: () => void };
  forwardAgentToClients(pid: string, payload: string): void;
  forwardClientToAgent(pid: string, payload: string): void;
  isAgentOnline(pid: string): boolean;
  /** test 用: pairing 数 */
  size(): number;
}

export function createPairingHub(log: (m: string) => void = () => {}): PairingHub {
  const pairings = new Map<string, Pairing>();

  function getOrCreate(pid: string): Pairing {
    let p = pairings.get(pid);
    if (!p) {
      p = { agent: null, clients: new Set() };
      pairings.set(pid, p);
    }
    return p;
  }

  function cleanupIfEmpty(pid: string): void {
    const p = pairings.get(pid);
    if (!p) return;
    if (!p.agent && p.clients.size === 0) {
      pairings.delete(pid);
    }
  }

  function broadcastStatus(pid: string, online: boolean): void {
    const p = pairings.get(pid);
    if (!p) return;
    const msg = JSON.stringify({ type: "agent-status", online });
    for (const c of p.clients) {
      try {
        c.send(msg);
      } catch {
        /* socket already gone */
      }
    }
  }

  return {
    attachAgent(pid, ws) {
      const p = getOrCreate(pid);
      // 既存 agent がいたら新しい接続で置き換える (Mac の再接続は想定内)
      if (p.agent && p.agent !== ws) {
        try {
          p.agent.close(4000, "replaced by newer connection");
        } catch {
          /* ignore */
        }
      }
      p.agent = ws;
      log(`[hub] agent attached pid=${pid}`);
      broadcastStatus(pid, true);
      return {
        detach: () => {
          const cur = pairings.get(pid);
          if (cur && cur.agent === ws) {
            cur.agent = null;
            log(`[hub] agent detached pid=${pid}`);
            broadcastStatus(pid, false);
            cleanupIfEmpty(pid);
          }
        },
      };
    },

    attachClient(pid, ws) {
      const p = getOrCreate(pid);
      p.clients.add(ws);
      log(`[hub] client attached pid=${pid} (count=${p.clients.size})`);
      // 接続直後にエージェント状態を 1 通だけ送る
      try {
        ws.send(JSON.stringify({ type: "agent-status", online: p.agent !== null }));
      } catch {
        /* ignore */
      }
      return {
        detach: () => {
          const cur = pairings.get(pid);
          if (!cur) return;
          cur.clients.delete(ws);
          log(`[hub] client detached pid=${pid} (count=${cur.clients.size})`);
          cleanupIfEmpty(pid);
        },
      };
    },

    forwardAgentToClients(pid, payload) {
      const p = pairings.get(pid);
      if (!p) return;
      for (const c of p.clients) {
        try {
          c.send(payload);
        } catch {
          /* ignore */
        }
      }
    },

    forwardClientToAgent(pid, payload) {
      const p = pairings.get(pid);
      if (!p?.agent) return;
      try {
        p.agent.send(payload);
      } catch {
        /* ignore */
      }
    },

    isAgentOnline(pid) {
      return pairings.get(pid)?.agent !== null && pairings.get(pid)?.agent !== undefined;
    },

    size() {
      return pairings.size;
    },
  };
}
