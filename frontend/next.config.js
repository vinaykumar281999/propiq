/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.4.40"],
  experimental: {
    turbopack: { root: __dirname },
  },
};
module.exports = nextConfig;
