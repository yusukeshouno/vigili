import type { Copy } from "@/lib/copy";
import { Section } from "./Section";

export function HowSection({ copy }: { copy: Copy }) {
  return (
    <Section id="how" eyebrow={copy.howEyebrow} title={copy.howTitle}>
      <ol className="flex flex-col gap-8">
        {copy.howSteps.map((s) => (
          <li key={s.index} className="grid grid-cols-[auto_1fr] gap-5">
            <span className="font-mono text-[11px] tracking-[0.12em] text-(--color-accent)">
              {s.index}
            </span>
            <div>
              <h3 className="font-display text-[16px] tracking-tight">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-[1.65] text-(--color-fg-mid)">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
