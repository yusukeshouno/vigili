import type { Copy } from "@/lib/copy";
import { Section } from "./Section";

export function SecuritySection({ copy }: { copy: Copy }) {
  return (
    <Section id="security" eyebrow={copy.secEyebrow} title={copy.secTitle}>
      <ul className="grid grid-cols-1 gap-5">
        {copy.secBullets.map((b) => (
          <li
            key={b.title}
            className="rounded-2xl border border-(--color-border) bg-(--color-bg-rise) px-6 py-5"
          >
            <h3 className="font-display text-[15px] tracking-tight">{b.title}</h3>
            <p className="mt-2 text-[14px] leading-[1.65] text-(--color-fg-mid)">{b.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
