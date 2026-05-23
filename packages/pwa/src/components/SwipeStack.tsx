"use client";

import { CheckIcon, XIcon } from "@/components/Icon";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * 3D Swipe Stack — pointer 駆動の物理風カードスタック。
 *
 * - 一番上のカードを左右ドラッグで commit (>threshold or velocity)
 * - 背後にも N 枚見せ、奥に向かって scale/translateY/rotate で深度を演出
 * - ← / → キーでも commit (focus 必須)
 * - Allow/Deny 円形ボタンが下に常駐 (タップでも commit 可能)
 *
 * 親は items を ID で同期する。commit すると onDecide を呼び、内部キューから抜く。
 * 親側で `pending` 配列を更新すれば次回 useEffect で同期される。
 */

interface SwipeStackItem {
  id: string;
}

interface Props<T extends SwipeStackItem> {
  items: T[];
  onDecide: (item: T, verdict: "allow" | "deny") => void;
  onOpen?: (item: T) => void;
  renderCard: (item: T, ctx: { isTop: boolean; progress: number; dragX: number }) => ReactNode;
  /** swipe を commit する px しきい値。デフォルト 110。 */
  threshold?: number;
  /** 後ろに見せる枚数。デフォルト 3。 */
  stackDepth?: number;
  /** スタックの高さ (px)。 */
  height?: number;
}

export function SwipeStack<T extends SwipeStackItem>({
  items,
  onDecide,
  onOpen,
  renderCard,
  threshold = 110,
  stackDepth = 3,
  height = 460,
}: Props<T>) {
  const [queue, setQueue] = useState<T[]>(items);
  useEffect(() => {
    setQueue(items);
  }, [items]);

  const [drag, setDrag] = useState({ x: 0, y: 0, dragging: false });
  const [flyOut, setFlyOut] = useState<{ x: number; y: number; rot: number } | null>(null);
  const startRef = useRef({ x: 0, y: 0, t: 0 });
  const elRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);

  const top = queue[0];

  const reset = useCallback(() => setDrag({ x: 0, y: 0, dragging: false }), []);

  const commit = useCallback(
    (verdict: "allow" | "deny") => {
      if (!top) return;
      const targetX = verdict === "allow" ? 700 : -700;
      setFlyOut({ x: targetX, y: drag.y * 1.4, rot: targetX * 0.06 });
      setTimeout(() => {
        onDecide(top, verdict);
        setQueue((q) => q.slice(1));
        setFlyOut(null);
        reset();
      }, 320);
    },
    [top, drag.y, onDecide, reset],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!top || flyOut) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    movedRef.current = false;
    setDrag({ x: 0, y: 0, dragging: true });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drag.dragging) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true;
    setDrag({ x: dx, y: dy, dragging: true });
  };
  const onPointerUp = (): void => {
    if (!drag.dragging) return;
    const dt = Date.now() - startRef.current.t;
    const vx = drag.x / Math.max(dt, 1);
    const passed = Math.abs(drag.x) > threshold || Math.abs(vx) > 0.6;
    if (passed) {
      commit(drag.x > 0 ? "allow" : "deny");
    } else if (!movedRef.current && top && onOpen) {
      // タップ判定: ほぼ動いていなければ onOpen に流す
      reset();
      onOpen(top);
    } else {
      reset();
    }
  };

  // キーボード: ← deny / → allow
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!top || flyOut) return;
      if (e.key === "ArrowRight") commit("allow");
      if (e.key === "ArrowLeft") commit("deny");
    };
    const el = elRef.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [top, commit, flyOut]);

  const visible = queue.slice(0, stackDepth + 1);
  const progress = top ? Math.max(-1, Math.min(1, drag.x / threshold)) : 0;

  return (
    <div
      ref={elRef}
      className="relative w-full select-none outline-none"
      style={{ height, touchAction: "pan-y" }}
    >
      <HintOverlay
        side="left"
        active={drag.dragging && drag.x < -40}
        progress={Math.min(1, Math.max(0, -drag.x / threshold))}
      />
      <HintOverlay
        side="right"
        active={drag.dragging && drag.x > 40}
        progress={Math.min(1, Math.max(0, drag.x / threshold))}
      />

      {visible
        .slice()
        .reverse()
        .map((item) => {
          const idx = visible.indexOf(item); // 0 = top
          const isTop = idx === 0;
          const depth = idx;
          const baseScale = 1 - depth * 0.04;
          const baseY = depth * 14;
          const baseRot = depth * 0.6 * (depth % 2 ? -1 : 1);

          let tx = 0;
          let ty = 0;
          let rot = baseRot;
          let scale = baseScale;
          let opacity = depth < stackDepth ? 1 : 0;
          let transition = "transform .35s cubic-bezier(.2,.7,.3,1), opacity .25s";

          if (isTop) {
            if (flyOut) {
              tx = flyOut.x;
              ty = flyOut.y;
              rot = flyOut.rot;
              opacity = 0;
              transition = "transform .32s cubic-bezier(.4,.05,.5,1), opacity .32s";
            } else if (drag.dragging) {
              tx = drag.x;
              ty = Math.abs(drag.x) * 0.06 + drag.y * 0.2;
              rot = drag.x * 0.05;
              scale = 1;
              transition = "none";
            }
          }

          const tilt =
            isTop && drag.dragging
              ? ` rotateY(${drag.x * -0.04}deg) rotateX(${drag.y * -0.05}deg)`
              : "";

          return (
            <div
              key={item.id}
              onPointerDown={isTop ? onPointerDown : undefined}
              onPointerMove={isTop ? onPointerMove : undefined}
              onPointerUp={isTop ? onPointerUp : undefined}
              onPointerCancel={isTop ? onPointerUp : undefined}
              className="absolute inset-0"
              style={{
                transform: `translate3d(${tx}px, ${ty + baseY}px, 0) rotate(${rot}deg) scale(${scale})${tilt}`,
                transition,
                cursor: isTop ? (drag.dragging ? "grabbing" : "grab") : "default",
                zIndex: 100 - depth,
                opacity,
                willChange: "transform",
                transformStyle: "preserve-3d",
                perspective: 1200,
              }}
            >
              {renderCard(item, {
                isTop,
                dragX: isTop ? drag.x : 0,
                progress: isTop ? progress : 0,
              })}
            </div>
          );
        })}

      {queue.length === 0 ? <EmptyStackHint /> : null}

      {top ? (
        <DecisionPills
          onAllow={() => commit("allow")}
          onDeny={() => commit("deny")}
          dragX={drag.x}
        />
      ) : null}
    </div>
  );
}

function HintOverlay({
  side,
  active,
  progress,
}: { side: "left" | "right"; active: boolean; progress: number }) {
  const isAllow = side === "right";
  // Claude warm semantic colors (much more muted than the previous Aurora)
  const color = isAllow ? "123,174,137" : "214,118,108";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 z-20"
      style={{
        [side]: 0,
        width: "40%",
        background: `linear-gradient(${side === "right" ? "270deg" : "90deg"}, rgba(${color}, ${0.18 * progress}), rgba(${color}, 0))`,
        borderRadius: 16,
        transition: "opacity .15s",
        opacity: active ? 1 : 0,
      }}
    >
      <div
        className="font-mono absolute flex items-center gap-2"
        style={{
          top: "50%",
          [side]: 24,
          transform: `translateY(-50%) scale(${0.7 + progress * 0.4})`,
          transition: "transform .12s",
          color: isAllow ? "var(--color-green-soft)" : "var(--color-red-soft)",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
        }}
      >
        {isAllow ? (
          <CheckIcon size={20} strokeWidth={1.8} />
        ) : (
          <XIcon size={20} strokeWidth={1.8} />
        )}
        {isAllow ? "Allow" : "Deny"}
      </div>
    </div>
  );
}

/**
 * Claude-style flat pill pair under the stack.
 * Deny: ghost outline (border-strong). Allow: filled coral.
 */
function DecisionPills({
  onAllow,
  onDeny,
  dragX,
}: {
  onAllow: () => void;
  onDeny: () => void;
  dragX: number;
}) {
  const allowEmph = dragX > 30;
  const denyEmph = dragX < -30;
  return (
    <div
      className="absolute left-0 right-0 z-30 flex items-center justify-center gap-2.5"
      style={{ bottom: -78 }}
    >
      <button
        type="button"
        onClick={onDeny}
        aria-label="Deny"
        className="press"
        style={{
          flex: "1 1 0",
          maxWidth: 220,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "12px 22px",
          borderRadius: 9999,
          background: denyEmph ? "rgba(214,118,108,0.16)" : "transparent",
          color: denyEmph ? "var(--color-red)" : "var(--color-fg)",
          border: `1px solid ${denyEmph ? "var(--color-red)" : "var(--color-border-strong)"}`,
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          fontSize: 14,
          fontWeight: 500,
          transition: "background .15s, color .15s, border-color .15s",
        }}
      >
        <XIcon size={14} strokeWidth={1.8} />
        Deny
      </button>

      <button
        type="button"
        onClick={onAllow}
        aria-label="Allow"
        className="press"
        style={{
          flex: "1 1 0",
          maxWidth: 220,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "12px 22px",
          borderRadius: 9999,
          background: "var(--color-accent)",
          color: "#fff",
          border: `1px solid ${allowEmph ? "var(--color-accent-soft)" : "var(--color-accent)"}`,
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          fontSize: 14,
          fontWeight: 500,
          transition: "background .15s, transform .12s",
          transform: allowEmph ? "scale(1.02)" : "scale(1)",
        }}
      >
        <CheckIcon size={14} strokeWidth={1.8} />
        Allow
      </button>
    </div>
  );
}

function EmptyStackHint() {
  return (
    <div
      className="label absolute inset-0 flex items-center justify-center"
      style={{ fontSize: 13 }}
    >
      Queue cleared
    </div>
  );
}
