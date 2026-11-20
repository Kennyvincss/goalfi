import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@goalfi/core", "@goalfi/chain", "@pm-amm/sdk"],
  serverExternalPackages: ["@goalfi/db", "@prisma/client", "@prisma/adapter-pg", "pg"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
