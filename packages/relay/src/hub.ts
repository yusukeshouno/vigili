/**
 * WS Hub — pairing 単位（legacy）と account 単位の二層 fan-out。
 *
 * - agent (Mac daemon) はペアリング毎に最大 1 接続。新しい接続が来たら古いものは切断する。
 *   接続時に account_id が判明するので、pairing と account 両方のインデックスに登録する。
 * - legacy client (`/v1/clients/:pid`, user_token 認証): ペアリング毎に複数接続を許容。
 * - account client (`/v1/account/stream`, session 認証): アカウント毎に複数接続を許容。
 * - agent → clients への fan-out は「その pairing の legacy clients」と「その account の
 *   account clients」の両方へ届ける（後方互換）。
 * - client → agent: legacy は同じ pairing の agent へ。account client は account 内の全 agent
 *   へブロードキャスト（request_id は一意なので所有 daemon のみ反応する）。
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
  /** legacy per-pairing clients (`/v1/clients/:pid`)。 */
  clients: Set<HubSocket>;
  /** agent 接続時に判明する所属アカウント。未接続なら null。 */
  accountId: string | null;
}

interface Account {
  /** pid → agent socket。アカウントに複数 Mac がぶら下がりうる。 */
  agents: Map<string, HubSocket>;
  /** account-stream clients (`/v1/account/stream`)。 */
  clients: Set<HubSocket>;
}

export interface PairingHub {
  attachAgent(pid: string, ws: HubSocket, accountId: string): { detach: () => void };
  attachClient(pid: string, ws: HubSocket): { detach: () => void };
  attachAccountClient(accountId: string, ws: HubSocket): { detach: () => void };
  forwardAgentToClients(pid: string, payload: string): void;
  forwardClientToAgent(pid: string, payload: string): void;
  forwardAccountClientToAgents(accountId: string, payload: string): void;
  isAgentOnline(pid: string): boolean;
  isAccountOnline(accountId: string): boolean;
  /** test 用: pairing 数 */
  size(): number;
}

function trySend(ws: HubSocket, data: string): void {
  try {
    ws.send(data);
  } catch {
    /* socket already gone */
  }
}

export function createPairingHub(log: (m: string) => void = () => {}): PairingHub {
  const pairings = new Map<string, Pairing>();
  const accounts = new Map<string, Account>();

  function getOrCreatePairing(pid: string): Pairing {
    let p = pairings.get(pid);
    if (!p) {
      p = { agent: null, clients: new Set(), accountId: null };
      pairings.set(pid, p);
    }
    return p;
  }

  function getOrCreateAccount(accountId: string): Account {
    let a = accounts.get(accountId);
    if (!a) {
      a = { agents: new Map(), clients: new Set() };
      accounts.set(accountId, a);
    }
    return a;
  }

  function cleanupPairing(pid: string): void {
    const p = pairings.get(pid);
    if (p && !p.agent && p.clients.size === 0) pairings.delete(pid);
  }

  function cleanupAccount(accountId: string): void {
    const a = accounts.get(accountId);
    if (a && a.agents.size === 0 && a.clients.size === 0) accounts.delete(accountId);
  }

  function broadcastPairingStatus(pid: string, online: boolean): void {
    const p = pairings.get(pid);
    if (!p) return;
    const msg = JSON.stringify({ type: "agent-status", online });
    for (const c of p.clients) trySend(c, msg);
  }

  function broadcastAccountStatus(accountId: string): void {
    const a = accounts.get(accountId);
    if (!a) return;
    const msg = JSON.stringify({ type: "agent-status", online: a.agents.size > 0 });
    for (const c of a.clients) trySend(c, msg);
  }

  return {
    attachAgent(pid, ws, accountId) {
      const p = getOrCreatePairing(pid);
      // 既存 agent がいたら新しい接続で置き換える (Mac の再接続は想定内)
      if (p.agent && p.agent !== ws) {
        try {
          p.agent.close(4000, "replaced by newer connection");
        } catch {
          /* ignore */
        }
      }
      p.agent = ws;
      p.accountId = accountId;
      const acct = getOrCreateAccount(accountId);
      acct.agents.set(pid, ws);
      log(`[hub] agent attached pid=${pid} account=${accountId}`);
      broadcastPairingStatus(pid, true);
      broadcastAccountStatus(accountId);
      return {
        detach: () => {
          const cur = pairings.get(pid);
          if (cur && cur.agent === ws) {
            cur.agent = null;
            log(`[hub] agent detached pid=${pid}`);
            broadcastPairingStatus(pid, false);
          }
          const a = accounts.get(accountId);
          if (a && a.agents.get(pid) === ws) {
            a.agents.delete(pid);
            broadcastAccountStatus(accountId);
            cleanupAccount(accountId);
          }
          cleanupPairing(pid);
        },
      };
    },

    attachClient(pid, ws) {
      const p = getOrCreatePairing(pid);
      p.clients.add(ws);
      log(`[hub] client attached pid=${pid} (count=${p.clients.size})`);
      // 接続直後にエージェント状態を 1 通だけ送る
      trySend(ws, JSON.stringify({ type: "agent-status", online: p.agent !== null }));
      // 新クライアントが接続 (= 再接続含む) したとき、agent に snapshot 再送を要求する。
      // これにより、再接続中に missed した resolved 等がクリアされる
      // (account client と同じ方針: attachAccountClient の refreshMsg と対称)。
      if (p.agent) {
        trySend(p.agent, JSON.stringify({ type: "refresh-snapshot" }));
      }
      return {
        detach: () => {
          const cur = pairings.get(pid);
          if (!cur) return;
          cur.clients.delete(ws);
          log(`[hub] client detached pid=${pid} (count=${cur.clients.size})`);
          cleanupPairing(pid);
        },
      };
    },

    attachAccountClient(accountId, ws) {
      const a = getOrCreateAccount(accountId);
      a.clients.add(ws);
      log(`[hub] account client attached account=${accountId} (count=${a.clients.size})`);
      trySend(ws, JSON.stringify({ type: "agent-status", online: a.agents.size > 0 }));
      // 新クライアントが来たとき、account に属する全 agent に snapshot 再送を要求する。
      // daemon が "refresh-snapshot" を受け取ったら snapshot + stats を再ブロードキャストする。
      const refreshMsg = JSON.stringify({ type: "refresh-snapshot" });
      for (const agentWs of a.agents.values()) trySend(agentWs, refreshMsg);
      return {
        detach: () => {
          const cur = accounts.get(accountId);
          if (!cur) return;
          cur.clients.delete(ws);
          log(`[hub] account client detached account=${accountId} (count=${cur.clients.size})`);
          cleanupAccount(accountId);
        },
      };
    },

    forwardAgentToClients(pid, payload) {
      const p = pairings.get(pid);
      if (!p) return;
      // legacy per-pairing clients
      for (const c of p.clients) trySend(c, payload);
      // account-stream clients (同一アカウントの全クライアント)
      if (p.accountId) {
        const a = accounts.get(p.accountId);
        if (a) for (const c of a.clients) trySend(c, payload);
      }
    },

    forwardClientToAgent(pid, payload) {
      const p = pairings.get(pid);
      if (!p?.agent) return;
      trySend(p.agent, payload);
    },

    forwardAccountClientToAgents(accountId, payload) {
      const a = accounts.get(accountId);
      if (!a) return;
      for (const agent of a.agents.values()) trySend(agent, payload);
    },

    isAgentOnline(pid) {
      const p = pairings.get(pid);
      return p?.agent != null;
    },

    isAccountOnline(accountId) {
      const a = accounts.get(accountId);
      return a != null && a.agents.size > 0;
    },

    size() {
      return pairings.size;
    },
  };
}
