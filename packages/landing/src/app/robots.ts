import type { MetadataRoute } from "next";

/**
 * /robots.txt — クロール全許可 (まだ秘匿コンテンツなし)。
 * 申し訳程度に AI クローラを deny したくなったらここで足す。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: "https://vigili.io/sitemap.xml",
    host: "https://vigili.io",
  };
}
