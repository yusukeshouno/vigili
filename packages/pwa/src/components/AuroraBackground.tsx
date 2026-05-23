/**
 * Claude flat background. ほぼ単色 (#262624) + 上部に淡い coral グロー 1 つだけ。
 * 旧 Aurora の blob/grid/noise は撤去 (Claude スタイルに合わない)。
 */
export function AuroraBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ background: "var(--color-bg)" }}
    >
      <div
        className="absolute"
        style={{
          top: -200,
          left: "50%",
          transform: "translateX(-50%)",
          width: 900,
          height: 500,
          background: "radial-gradient(ellipse, rgba(201,100,66,0.10), transparent 70%)",
          filter: "blur(40px)",
        }}
      />
    </div>
  );
}
