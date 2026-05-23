import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // モノレポ内の型推論を有効にする
  transpilePackages: ["@vigili/shared"],
};

export default config;
