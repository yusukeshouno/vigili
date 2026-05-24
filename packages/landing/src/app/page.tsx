import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { HowSection } from "@/components/HowSection";
import { SecuritySection } from "@/components/SecuritySection";
import { Showcase } from "@/components/Showcase";
import { TopBar } from "@/components/TopBar";
import { WhySection } from "@/components/WhySection";
import { type Lang, getCopy } from "@/lib/copy";

interface PageProps {
  // Next.js 15 では searchParams は Promise になる。
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params.lang;
  const lang: Lang = (Array.isArray(raw) ? raw[0] : raw) === "ja" ? "ja" : "en";
  const copy = getCopy(lang);

  return (
    <main className="min-h-dvh">
      <TopBar lang={lang} copy={copy} />
      <Hero lang={lang} copy={copy} />
      <Showcase copy={copy} />
      <WhySection copy={copy} />
      <HowSection copy={copy} />
      <SecuritySection copy={copy} />
      <Footer copy={copy} />
    </main>
  );
}
