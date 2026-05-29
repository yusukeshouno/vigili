import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import type { Metadata } from "next";
import { SparkleSymbol } from "@/components/Sparkle";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter-tight",
  display: "swap",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vigili — Five sessions. One list to approve.",
  description:
    "Run multiple Claude Code windows in parallel. Vigili pulls every approval request into one list — handled from your Mac menu bar, or your phone when you're away. Auto-rules grow as you use it.",
  metadataBase: new URL("https://vigili.io"),
  openGraph: {
    title: "Vigili — Five sessions. One list to approve.",
    description:
      "Every approval from every parallel Claude Code session in one list. Auto-rules handle the obvious; only the unclear reach your phone.",
    url: "https://vigili.io",
    siteName: "Vigili",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vigili — Five sessions. One list to approve.",
    description:
      "Every approval from every parallel Claude Code session in one list. Auto-rules handle the obvious; only the unclear reach your phone.",
  },
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetBrainsMono.variable}`}>
      <body>
        <SparkleSymbol />
        {children}
        {/* Vercel Analytics: cookieless、Vercel deploy 時のみ collect される。
           本番でない時 ($VERCEL_ENV !== "production") はクライアントが
           https://va.vercel-scripts.com/v1/script.js を取得して `mode=development`
           で local hits を捨てる。 */}
        <Analytics />
      </body>
    </html>
  );
}
