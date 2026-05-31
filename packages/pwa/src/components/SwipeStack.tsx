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
  /** 0=idle, non-zero=shake offset applied to top card before deny flyout */
  const [shakeX, setShakeX] = useState(0);
  const startRef = useRef({ x: 0, y: 0, t: 0 });
  const elRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);

  const top = queue[0];

  const reset = useCallback(() => setDrag({ x: 0, y: 0, dragging: false }), []);

  const commit = useCallback(
    (verdict: "allow" | "deny") => {
      if (!top) return;
      const isButtonPress = !drag.dragging; // button click vs. drag-release

      if (verdict === "deny") {
        if (isButtonPress) {
          // Button press: shake at center first, then fly left
          setShakeX(-16);
          setTimeout(() => setShakeX(13), 75);
          setTimeout(() => setShakeX(-9), 150);
          setTimeout(() => {
            setShakeX(0);
            setFlyOut({ x: -980, y: 60, rot: -70 });
            setTimeout(() => {
              onDecide(top, verdict);
              setQueue((q) => q.slice(1));
              setFlyOut(null);
              reset();
            }, 380);
          }, 240);
        } else {
          // Drag release: already at a negative offset — fly directly, no shake
          setFlyOut({ x: -980, y: drag.y * 1.4 + 40, rot: -70 });
          setTimeout(() => {
            onDecide(top, verdict);
            setQueue((q) => q.slice(1));
            setFlyOut(null);
            reset();
          }, 380);
        }
      } else {
        // Allow: arc upward and spin off to the right
        const arcY = drag.dragging ? drag.y * 1.4 - 30 : -55;
        setFlyOut({ x: 980, y: arcY, rot: 62 });
        setTimeout(() => {
          onDecide(top, verdict);
          setQueue((q) => q.slice(1));
          setFlyOut(null);
          reset();
        }, 370);
      }
    },
    [top, drag.dragging, drag.y, onDecide, reset],
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
              scale = 0.82; // shrink as it flies away
              opacity = 0;
              transition =
                "transform .40s cubic-bezier(.3,.05,.4,1), opacity .28s ease-in, scale .40s";
            } else if (drag.dragging) {
              tx = drag.x;
              ty = Math.abs(drag.x) * 0.06 + drag.y * 0.2;
              rot = drag.x * 0.055;
              scale = 1;
              transition = "none";
            } else if (shakeX !== 0) {
              // Pre-deny shake: no drag state, but offset applied
              tx = shakeX;
              rot = shakeX * 0.045;
              transition = "transform 68ms ease-out";
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
  const color = isAllow ? "123,174,137" : "214,118,108";
  const committed = progress > 0.85;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 z-20"
      style={{
        [side]: 0,
        width: "50%",
        background: `linear-gradient(${side === "right" ? "270deg" : "90deg"}, rgba(${color}, ${0.28 * progress}), rgba(${color}, 0))`,
        borderRadius: 16,
        transition: "opacity .12s",
        opacity: active ? 1 : 0,
      }}
    >
      <div
        className="font-mono absolute flex items-center gap-2"
        style={{
          top: "50%",
          [side]: 22,
          transform: `translateY(-50%) scale(${0.6 + progress * 0.55}) ${committed ? "rotate(-5deg)" : ""}`,
          transition: "transform .1s",
          color: isAllow ? "var(--color-green-soft)" : "var(--color-red-soft)",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          textShadow: `0 0 18px rgba(${color}, ${0.6 * progress})`,
        }}
      >
        {isAllow ? <CheckIcon size={22} strokeWidth={2} /> : <XIcon size={22} strokeWidth={2} />}
        {isAllow ? "Allow" : "Deny"}
      </div>
    </div>
  );
}

/**
 * Claude-style flat pill pair under the stack.
 * Deny: ghost outline (border-strong). Allow: filled coral.
 * Both have a springy press + drag-responsive emphasis.
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
  const allowPull = Math.max(0, Math.min(1, dragX / 120));
  const denyPull = Math.max(0, Math.min(1, -dragX / 120));

  return (
    <div
      className="absolute left-0 right-0 z-30 flex items-center justify-center gap-2.5"
      style={{ bottom: -84 }}
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
          padding: "13px 22px",
          borderRadius: 9999,
          background: denyEmph ? `rgba(214,118,108,${0.08 + denyPull * 0.2})` : "transparent",
          color: denyEmph ? "var(--color-red-soft)" : "var(--color-fg-mid)",
          border: `1.5px solid ${denyEmph ? "var(--color-red)" : "var(--color-border-strong)"}`,
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          fontSize: 14,
          fontWeight: 500,
          transform: `scale(${1 + denyPull * 0.04})`,
          boxShadow: denyEmph ? `0 0 22px -4px rgba(214,118,108,${0.3 * denyPull})` : "none",
          transition:
            "background .12s, color .12s, border-color .12s, box-shadow .12s, transform 380ms cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <XIcon size={15} strokeWidth={2} />
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
          padding: "13px 22px",
          borderRadius: 9999,
          background: allowEmph ? "var(--color-accent-soft)" : "var(--color-accent)",
          color: "#fff",
          border: "1.5px solid transparent",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          fontSize: 14,
          fontWeight: 500,
          transform: `scale(${1 + allowPull * 0.06})`,
          boxShadow: allowEmph
            ? `0 4px 28px -4px rgba(193,97,65,${0.4 + allowPull * 0.3})`
            : "0 2px 12px -4px rgba(193,97,65,0.3)",
          transition:
            "background .12s, box-shadow .12s, transform 380ms cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <CheckIcon size={15} strokeWidth={2} />
        Allow
      </button>
    </div>
  );
}

function EmptyStackHint() {
  return (
    <div
      className="label absolute inset-0 flex flex-col items-center justify-center gap-3"
      style={{
        fontSize: 13,
        animation: "float-up 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: 32,
          display: "block",
          color: "var(--color-green)",
          animation: "jelly 600ms cubic-bezier(0.34, 1.56, 0.64, 1) both 80ms",
        }}
      >
        ✓
      </span>
      Queue cleared
    </div>
  );
}
