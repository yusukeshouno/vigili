/**
 * 共通セクションコンテナ。eyebrow + タイトル + children のレイアウト。
 */
export function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="mx-auto w-full max-w-6xl border-t border-(--color-border) px-6 py-20 sm:px-10 sm:py-28"
    >
      <div className="grid grid-cols-1 gap-12 sm:grid-cols-12">
        <header className="sm:col-span-5">
          <span className="label block">{eyebrow}</span>
          <h2 className="mt-3 font-display text-[28px] leading-[1.1] tracking-tight sm:text-[40px]">
            {title}
          </h2>
        </header>
        <div className="sm:col-span-7">{children}</div>
      </div>
    </section>
  );
}
