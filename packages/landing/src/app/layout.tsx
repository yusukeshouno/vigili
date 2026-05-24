import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vigili — Approve Claude Code from your phone",
  description:
    "A local-first approval mesh for Claude Code. Auto-allow safe operations, deny dangerous ones, and only get a phone tap for the calls that actually need a human.",
  metadataBase: new URL("https://vigili.io"),
  openGraph: {
    title: "Vigili — Approve Claude Code from your phone",
    description:
      "Auto-classify Claude Code's tool requests, push only the ambiguous ones to your phone.",
    url: "https://vigili.io",
    siteName: "Vigili",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vigili — Approve Claude Code from your phone",
    description:
      "Auto-classify Claude Code's tool requests, push only the ambiguous ones to your phone.",
  },
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
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
