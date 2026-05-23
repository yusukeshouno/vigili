"use client";

import type {
  ApprovalRequest,
  PromoteRule,
  WsClientMessage,
  WsServerMessage,
} from "@vigili/shared";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { buildWsUrl, loadConfig } from "./config-store";
import { type ConnectionState, type WsClient, createWsClient } from "./ws-client";

interface QueueContextValue {
  pending: ApprovalRequest[];
  state: ConnectionState;
  stateDetail: string | undefined;
  /** 設定が未保存の場合 true。 page 側で /setup へ redirect する。 */
  needsSetup: boolean;
  decide: (id: string, decision: "allow" | "deny", promote?: PromoteRule | null) => void;
  /** id から保留中リクエストを取り出す。なければ null (resolved 済 / 不正 id)。 */
  byId: (id: string) => ApprovalRequest | null;
}

const Ctx = createContext<QueueContextValue | null>(null);

export function useQueue(): QueueContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useQueue must be used inside <QueueProvider>");
  return v;
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [stateDetail, setStateDetail] = useState<string | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState(false);
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await loadConfig();
      if (cancelled) return;
      if (!cfg) {
        setNeedsSetup(true);
        setState("closed");
        return;
      }
      setNeedsSetup(false);
      const url = buildWsUrl(cfg.daemonUrl, cfg.token);
      const client = createWsClient(url, {
        onMessage: (msg) => handleMessage(msg),
        onState: (s, detail) => {
          setState(s);
          setStateDetail(detail);
        },
      });
      clientRef.current = client;
    })();
    return () => {
      cancelled = true;
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  const handleMessage = useCallback((msg: WsServerMessage) => {
    if (msg.type === "snapshot") {
      setPending(msg.pending);
    } else if (msg.type === "pending") {
      setPending((p) => [...p.filter((r) => r.id !== msg.request.id), msg.request]);
    } else if (msg.type === "resolved") {
      setPending((p) => p.filter((r) => r.id !== msg.id));
    }
  }, []);

  const decide = useCallback<QueueContextValue["decide"]>((id, decision, promote = null) => {
    const msg: WsClientMessage = {
      type: "decide",
      id,
      decision,
      ...(promote !== null ? { promote } : {}),
    };
    clientRef.current?.send(msg);
    // 楽観的に消す: 失敗しても resolved/snapshot で再同期される
    setPending((p) => p.filter((r) => r.id !== id));
  }, []);

  const byId = useCallback<QueueContextValue["byId"]>(
    (id) => pending.find((r) => r.id === id) ?? null,
    [pending],
  );

  return (
    <Ctx.Provider value={{ pending, state, stateDetail, needsSetup, decide, byId }}>
      {children}
    </Ctx.Provider>
  );
}
