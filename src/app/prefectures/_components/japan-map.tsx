import { PREFECTURES } from "@/lib/constants/prefectures";

import {
  JAPAN_MAP_DIVIDER_LINES,
  JAPAN_MAP_PREFECTURES_TRANSFORM,
  JAPAN_MAP_ROOT_TRANSFORM,
  JAPAN_MAP_VIEWBOX,
  PREFECTURE_MAP_SHAPES,
} from "../_lib/japan-map-paths";

/**
 * タップ可能な日本地図（FR-07・T19）。
 *
 * 47 都道府県を SVG の `<a>`（role=link）で描き、タップ/クリックで
 * /prefectures/[code] へ遷移する。クライアント JS 不要（RSC の静的 SVG）。
 *
 * - アクセシビリティ: 各県に aria-label（県名）＋ <title>（ホバーのツールチップ兼
 *   テキストフォールバック）。E2E は「47 リンク・東京都 href」をこの SVG で満たす。
 * - 配色は 2a テーマのトークンに追従: 地は secondary、ホバー/フォーカスで primary。
 */
export function JapanMap() {
  const nameByCode = new Map(PREFECTURES.map((p) => [p.code, p.name]));

  return (
    <svg
      viewBox={JAPAN_MAP_VIEWBOX}
      className="h-auto w-full"
      role="group"
      aria-label="日本地図。都道府県を選ぶとその県の地酒一覧へ移動します"
    >
      <g transform={JAPAN_MAP_ROOT_TRANSFORM}>
        {/* 沖縄と本土の区切り線（意匠） */}
        <g
          className="stroke-border"
          strokeWidth="2"
          strokeDasharray="6 4"
          fill="none"
        >
          {JAPAN_MAP_DIVIDER_LINES.map((line) => (
            <line
              key={`${line.x1}-${line.y1}`}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
            />
          ))}
        </g>
        <g transform={JAPAN_MAP_PREFECTURES_TRANSFORM}>
          {PREFECTURE_MAP_SHAPES.map((shape) => {
            const name = nameByCode.get(shape.code) ?? shape.code;
            return (
              <a
                key={shape.code}
                href={`/prefectures/${shape.code}`}
                aria-label={name}
                className="group/pref cursor-pointer outline-none"
              >
                <title>{name}</title>
                <g
                  transform={`translate(${shape.tx}, ${shape.ty})`}
                  className="fill-secondary stroke-background transition-colors group-hover/pref:fill-primary group-focus-visible/pref:fill-primary"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                >
                  {shape.paths.map((d, index) => (
                    <path key={index} d={d} />
                  ))}
                </g>
              </a>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
