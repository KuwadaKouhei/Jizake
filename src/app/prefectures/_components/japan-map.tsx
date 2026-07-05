"use client";

import { useState } from "react";

import { cn } from "@/components/ui/cn";
import { PREFECTURES } from "@/lib/constants/prefectures";

import {
  JAPAN_MAP_DIVIDER_LINES,
  JAPAN_MAP_PREFECTURES_TRANSFORM,
  JAPAN_MAP_ROOT_TRANSFORM,
  JAPAN_MAP_VIEWBOX,
  PREFECTURE_MAP_SHAPES,
} from "../_lib/japan-map-paths";

/**
 * タップ可能な日本地図＋県名セレクト（FR-07・T19/T20）。
 *
 * 47 都道府県を SVG の `<a>`（role=link）で描き、タップ/クリックで
 * /prefectures/[code] へ遷移する（リンク自体はハイドレーション前でも機能する）。
 *
 * T20 の改善:
 * - ホバー/フォーカス中の県名を地図上部に大きく表示する（小さい県の視認性補助）。
 * - 地図の下に県名セレクトを併設し、選択で同じ県別一覧へ移動できる（小さい県のタップ性補助）。
 *
 * ホバー状態と select 遷移にクライアント JS を使うためこの部品のみ Client Component。
 * 県の塗り分けは CSS の group-hover/focus で行い、ハイドレーション前でも成立させる。
 *
 * アクセシビリティ: 各県に aria-label（県名）＋ <title>。セレクトにも label を付ける。
 * E2E は「47 リンク・東京都 href」をこの SVG の `<a>` で満たす（select は anchor ではない）。
 */
export function JapanMap() {
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const nameByCode = new Map(PREFECTURES.map((p) => [p.code, p.name]));
  const hoveredName = hoveredCode ? nameByCode.get(hoveredCode) : null;

  return (
    <div>
      <div className="relative">
        {/* ホバー/フォーカス中の県名を大きく表示（装飾。実体は各 <a> の aria-label） */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-5 py-1.5 text-lg font-bold text-primary-foreground shadow-md transition-opacity duration-150 sm:text-xl",
            hoveredName ? "opacity-100" : "opacity-0",
          )}
        >
          {hoveredName ?? " "}
        </div>

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
                const isHovered = hoveredCode === shape.code;
                return (
                  <a
                    key={shape.code}
                    href={`/prefectures/${shape.code}`}
                    aria-label={name}
                    className="group/pref cursor-pointer outline-none"
                    onMouseEnter={() => setHoveredCode(shape.code)}
                    onMouseLeave={() =>
                      setHoveredCode((current) =>
                        current === shape.code ? null : current,
                      )
                    }
                    onFocus={() => setHoveredCode(shape.code)}
                    onBlur={() =>
                      setHoveredCode((current) =>
                        current === shape.code ? null : current,
                      )
                    }
                  >
                    <title>{name}</title>
                    <g
                      transform={`translate(${shape.tx}, ${shape.ty})`}
                      className={cn(
                        "stroke-background transition-colors group-hover/pref:fill-primary group-focus-visible/pref:fill-primary",
                        // 非ホバーは背景と紛れない明確なグレー、ホバー/フォーカスで藍。
                        // ハイドレーション後はホバー中の県を state でも塗る（隣県跨ぎのちらつき防止）
                        isHovered ? "fill-primary" : "fill-muted-foreground/40",
                      )}
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
      </div>

      {/* 県名セレクト（小さい県のタップ性補助。選択で同じ県別一覧へ移動） */}
      <div className="mx-auto mt-6 flex max-w-sm flex-col gap-1.5">
        <label htmlFor="prefecture-select" className="text-sm font-medium">
          都道府県を選んで移動
        </label>
        <select
          id="prefecture-select"
          defaultValue=""
          onChange={(event) => {
            const code = event.target.value;
            if (code !== "") {
              window.location.href = `/prefectures/${code}`;
            }
          }}
          className="h-10 rounded-lg border-[1.5px] border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="" disabled>
            都道府県を選ぶ…
          </option>
          {PREFECTURES.map((prefecture) => (
            <option key={prefecture.code} value={prefecture.code}>
              {prefecture.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
