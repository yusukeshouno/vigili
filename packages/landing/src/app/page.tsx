import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { HowSection } from "@/components/HowSection";
import { SecuritySection } from "@/components/SecuritySection";
import { SetupSection } from "@/components/SetupSection";
import { Showcase } from "@/components/Showcase";
import { Surfaces } from "@/components/Surfaces";
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
      <Surfaces copy={copy} />
      <Showcase copy={copy} />
      <WhySection copy={copy} />
      <HowSection copy={copy} />
      <SetupSection copy={copy} />
      <SecuritySection copy={copy} />
      <Footer copy={copy} />
    </main>
  );
}
