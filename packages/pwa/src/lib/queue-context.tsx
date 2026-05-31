"use client";

import type {
  ApprovalRequest,
  HostedSession,
  Message,
  PromoteRule,
  Question,
  TranscriptLine,
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

/** WS `question` で届いた回答待ち選択肢。request_id で回答を対応づける。 */
export interface PendingQuestion {
  session_id: string;
  request_id: string;
  questions: Question[];
}

/** WS `plan` で届いた承認待ち plan (ExitPlanMode)。 */
export interface PendingPlan {
  session_id: string;
  request_id: string;
  plan: string;
}

interface QueueContextValue {
  pending: ApprovalRequest[];
  /** 直近 + 未配送のメッセージ (created_at 降順)。composer の history 表示用。 */
  messages: Message[];
  state: ConnectionState;
  stateDetail: string | undefined;
  /** 設定が未保存の場合 true。 page 側で /setup へ redirect する。 */
  needsSetup: boolean;
  decide: (id: string, decision: "allow" | "deny", promote?: PromoteRule | null) => void;
  /** id から保留中リクエストを取り出す。なければ null (resolved 済 / 不正 id)。 */
  byId: (id: string) => ApprovalRequest | null;
  /**
   * 指定の Claude セッションにメッセージを送る。daemon が次の gate fire で
   * additionalContext に乗せて Claude に届ける。
   */
  sendMessage: (session_id: string, body: string) => void;

  // --- L4 ホスト型セッション (vigili run) ---
  /** 稼働中のホスト型セッション。 */
  sessions: HostedSession[];
  /** session_id → transcript 行。 */
  transcripts: Record<string, TranscriptLine[]>;
  /** 回答待ちの選択肢質問 (AskUserQuestion)。 */
  pendingQuestions: PendingQuestion[];
  /** 承認待ちの plan (ExitPlanMode)。 */
  pendingPlans: PendingPlan[];
  /** AskUserQuestion への回答。answers は {<question>: <選択 label(s)>}。 */
  answerQuestion: (request_id: string, answers: Record<string, string>) => void;
  /** plan の承認 / 却下。 */
  decidePlan: (request_id: string, decision: "approve" | "reject", reason?: string) => void;
  /** ホスト型セッションへの自由文返信 (次の user turn)。 */
  sendReply: (session_id: string, body: string) => void;
}

const Ctx = createContext<QueueContextValue | null>(null);

export function useQueue(): QueueContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useQueue must be used inside <QueueProvider>");
  return v;
}

export function QueueProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [stateDetail, setStateDetail] = useState<string | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState(false);
  // --- L4 ---
  const [sessions, setSessions] = useState<HostedSession[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptLine[]>>({});
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>([]);
  const [pendingPlans, setPendingPlans] = useState<PendingPlan[]>([]);
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
      if (msg.messages) setMessages(msg.messages);
      if (msg.sessions) setSessions(msg.sessions);
    } else if (msg.type === "pending") {
      setPending((p) => [...p.filter((r) => r.id !== msg.request.id), msg.request]);
    } else if (msg.type === "resolved") {
      setPending((p) => p.filter((r) => r.id !== msg.id));
    } else if (msg.type === "message-added") {
      setMessages((list) => {
        if (list.some((m) => m.id === msg.message.id)) return list;
        // FIFO 先頭が「最新」になるよう降順で保持
        return [msg.message, ...list].slice(0, 100);
      });
    } else if (msg.type === "message-delivered") {
      setMessages((list) =>
        list.map((m) =>
          m.id === msg.id && m.delivered_at === null ? { ...m, delivered_at: msg.delivered_at } : m,
        ),
      );
    } else if (msg.type === "session-started") {
      setSessions((s) => [
        ...s.filter((x) => x.session_id !== msg.session.session_id),
        msg.session,
      ]);
    } else if (msg.type === "session-ended") {
      setSessions((s) => s.filter((x) => x.session_id !== msg.session_id));
      setTranscripts((t) => {
        const next = { ...t };
        delete next[msg.session_id];
        return next;
      });
      setPendingQuestions((q) => q.filter((x) => x.session_id !== msg.session_id));
      setPendingPlans((p) => p.filter((x) => x.session_id !== msg.session_id));
    } else if (msg.type === "transcript-append") {
      setTranscripts((t) => {
        const prev = t[msg.session_id] ?? [];
        return { ...t, [msg.session_id]: [...prev, msg.line].slice(-500) };
      });
    } else if (msg.type === "question") {
      setPendingQuestions((q) =>
        q.some((x) => x.request_id === msg.request_id)
          ? q
          : [
              ...q,
              { session_id: msg.session_id, request_id: msg.request_id, questions: msg.questions },
            ],
      );
    } else if (msg.type === "plan") {
      setPendingPlans((p) =>
        p.some((x) => x.request_id === msg.request_id)
          ? p
          : [...p, { session_id: msg.session_id, request_id: msg.request_id, plan: msg.plan }],
      );
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

  const sendMessage = useCallback<QueueContextValue["sendMessage"]>((session_id, body) => {
    const trimmed = body.trim();
    if (!trimmed || !session_id) return;
    const msg: WsClientMessage = {
      type: "send-message",
      session_id,
      body: trimmed,
    };
    clientRef.current?.send(msg);
    // optimistic ack: server から message-added で正式に上書きされる
    setMessages((list) => [
      {
        // クライアント側 placeholder id (server が確定後に message-added で上書き)
        id: `tmp-${Date.now()}`,
        session_id,
        body: trimmed,
        created_at: Date.now(),
        delivered_at: null,
      },
      ...list,
    ]);
  }, []);

  const answerQuestion = useCallback<QueueContextValue["answerQuestion"]>((request_id, answers) => {
    const msg: WsClientMessage = { type: "answer-question", request_id, answers };
    clientRef.current?.send(msg);
    setPendingQuestions((q) => q.filter((x) => x.request_id !== request_id));
  }, []);

  const decidePlan = useCallback<QueueContextValue["decidePlan"]>(
    (request_id, decision, reason) => {
      const msg: WsClientMessage = {
        type: "decide-plan",
        request_id,
        decision,
        ...(reason && reason.trim() ? { reason } : {}),
      };
      clientRef.current?.send(msg);
      setPendingPlans((p) => p.filter((x) => x.request_id !== request_id));
    },
    [],
  );

  const sendReply = useCallback<QueueContextValue["sendReply"]>((session_id, body) => {
    const trimmed = body.trim();
    if (!trimmed || !session_id) return;
    const msg: WsClientMessage = { type: "session-reply", session_id, body: trimmed };
    clientRef.current?.send(msg);
    // optimistic: transcript に user 行として即時反映
    setTranscripts((t) => {
      const prev = t[session_id] ?? [];
      return { ...t, [session_id]: [...prev, { role: "user", text: trimmed, at: Date.now() }] };
    });
  }, []);

  const byId = useCallback<QueueContextValue["byId"]>(
    (id) => pending.find((r) => r.id === id) ?? null,
    [pending],
  );

  return (
    <Ctx.Provider
      value={{
        pending,
        messages,
        state,
        stateDetail,
        needsSetup,
        decide,
        byId,
        sendMessage,
        sessions,
        transcripts,
        pendingQuestions,
        pendingPlans,
        answerQuestion,
        decidePlan,
        sendReply,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
