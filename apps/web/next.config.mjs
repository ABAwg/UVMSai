/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.UVMS_E2E === '1' ? '.next-e2e' : process.env.UVMS_QA === '1' ? '.next-qa' : '.next',
  output: 'standalone',
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${process.env.UVMS_API_INTERNAL_URL || 'http://127.0.0.1:8000'}/api/v1/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
      ],
    }];
  },
};
export default nextConfig;
