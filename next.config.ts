import type { NextConfig } from "next";
// @ts-expect-error - next-pwa doesn't have types
import withPWA from "next-pwa";

const nextConfig: NextConfig = {
  // Phase 2-X monorepo 化（B-2 段階）。@kt/shared は TypeScript ソースを
  // 直接 import しているため Next の transpile 対象に含める。
  // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/transpilePackages.md
  transpilePackages: ["@kt/shared"],
  // Phase Perf-1: 大きな library を tree-shake / barrel optimization
  // lucide-react は 1400+ icon を全 bundle に含む可能性あり、これで使用 icon のみに
  // date-fns も locale を切り出して bundle 縮小
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
})(nextConfig);
