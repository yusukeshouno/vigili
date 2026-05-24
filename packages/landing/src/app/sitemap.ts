import type { MetadataRoute } from "next";

/**
 * /sitemap.xml — Google / Bing 向けのエントリポイント一覧。
 * EN / JA 両方を載せる (hreflang は付けない — シンプルに維持)。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://vigili.io";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/?lang=ja`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
