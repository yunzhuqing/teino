import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许客户端直接使用 https://<host>/v1 作为 Base URL
  async rewrites() {
    return [{ source: "/v1/:path*", destination: "/api/v1/:path*" }];
  },
};

export default nextConfig;
