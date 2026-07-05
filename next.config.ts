import type { NextConfig } from "next";

// セキュリティレスポンスヘッダ（多層防御。REVIEW T05 SEC S-2）。
// XSS 経路は React エスケープ＋外部リンクの https 正規化で塞いでいるが、
// 万一の描画欠陥に対する最後の砦として CSP 等を全ルートに付与する。
const securityHeaders = [
  // フレーム埋め込み拒否（クリックジャッキング対策）
  { key: "X-Frame-Options", value: "DENY" },
  // MIME スニッフィング抑止
  { key: "X-Content-Type-Options", value: "nosniff" },
  // リファラは同一オリジン外へはオリジンのみ送る
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 不要なブラウザ機能を無効化
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // フレームワーク露出を避ける
  poweredByHeader: false,
  images: {
    // 銘柄画像は楽天市場 API 由来の楽天 CDN のみ許可する（FR-09。
    //  scripts/lib/rakuten/match.ts の RAKUTEN_IMAGE_HOST と同期）
    remotePatterns: [
      { protocol: "https", hostname: "thumbnail.image.rakuten.co.jp" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
