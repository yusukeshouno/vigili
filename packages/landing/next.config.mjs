/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ランディングは静的に近いので Vercel 既定で十分。
  // 必要なら experimental: { reactCompiler: true } 等を追加。
};

export default nextConfig;
