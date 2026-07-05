/**
 * 画像未取得の銘柄に出す共通「No Image」プレースホルダ（FR-09・T18）。
 *
 * 商品写真と誤認されない意匠（線画の徳利と盃＋NO IMAGE 表記）をインライン SVG で描く。
 * 色はテーマトークン（muted / muted-foreground）に追従し、親要素いっぱいに広がる。
 * 装飾なので aria-hidden（カード・詳細の銘柄名が本文にあるため代替テキスト不要）。
 */
export function SakeImagePlaceholder({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`grid h-full w-full place-items-center bg-muted/60 ${className ?? ""}`}
    >
      <svg
        viewBox="0 0 120 120"
        className="h-2/3 max-h-28 w-auto text-muted-foreground/50"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* 徳利 */}
        <path d="M52 22 h16 M55 22 c0 8 -1 10 -6 16 c-5 6 -7 10 -7 18 v22 c0 5 4 8 9 8 h18 c5 0 9 -3 9 -8 v-22 c0 -8 -2 -12 -7 -18 c-5 -6 -6 -8 -6 -16" />
        {/* 徳利の帯 */}
        <path d="M44 62 h32" strokeOpacity="0.6" />
        {/* 盃 */}
        <path
          d="M88 74 c0 6 -5 10 -11 10 c-2.5 0 -4.5 -0.6 -6 -1.8"
          strokeOpacity="0.8"
        />
        <path d="M77 88 v6 M71 96 h12" strokeOpacity="0.8" />
        {/* NO IMAGE */}
        <text
          x="60"
          y="112"
          textAnchor="middle"
          stroke="none"
          fill="currentColor"
          fontSize="10"
          letterSpacing="2"
        >
          NO IMAGE
        </text>
      </svg>
    </div>
  );
}
