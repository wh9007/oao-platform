/** @type {import('next').NextConfig} */
const frameAncestors = [
  "'self'",
  "http://127.0.0.1:8777",
  "http://localhost:8777",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
].join(" ");

const nextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestors};`,
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
