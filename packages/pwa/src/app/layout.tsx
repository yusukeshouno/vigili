import { InstallHint } from "@/components/InstallHint";
import { ServiceWorker } from "@/components/ServiceWorker";
import { QueueProvider } from "@/lib/queue-context";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Sentinel — approval mesh",
  description: "Claude Code の承認プロンプトを手元のスマホで処理する",
  applicationName: "Sentinel",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sentinel",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#262624",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${bricolage.variable} ${jetbrains.variable}`}>
      <body>
        <QueueProvider>
          {children}
          <InstallHint />
        </QueueProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
