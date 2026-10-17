import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  distDir:
    process.env.MAINTENANCE_BROWSER_TEST === "1" ? ".next-test" : ".next",
  async redirects() {
    // Keep local auth storage and API requests on the configured pilot origin.
    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
    if (
      process.env.NODE_ENV !== "development" ||
      apiUrl !== "http://localhost:4000/api"
    )
      return [];
    return [
      {
        source: "/:path*",
        has: [{ type: "host" as const, value: "127\\.0\\.0\\.1" }],
        destination: "http://localhost:3000/:path*",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/auth/callback",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};
export default config;
