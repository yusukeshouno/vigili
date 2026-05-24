import type { Copy } from "@/lib/copy";
import { Section } from "./Section";

export function WhySection({ copy }: { copy: Copy }) {
  return (
    <Section id="why" eyebrow={copy.whyEyebrow} title={copy.whyTitle}>
      <ul className="flex flex-col divide-y divide-(--color-border)">
        {copy.whyBullets.map((b) => (
          <li key={b.title} className="py-6 first:pt-0 last:pb-0">
            <h3 className="font-display text-[16px] tracking-tight">{b.title}</h3>
            <p className="mt-2 text-[14px] leading-[1.65] text-(--color-fg-mid)">{b.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
