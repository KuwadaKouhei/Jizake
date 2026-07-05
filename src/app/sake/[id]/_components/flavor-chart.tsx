import type { FlavorChart } from "@/lib/db/queries/sakes";

/**
 * フレーバー 6 軸の味わいレーダー（Claude Design 3a「淡 — 白×藍」）。
 *
 * 軸ラベルは DATABASE.md / DESIGN §2.7 の 6 軸（華やか・芳醇・重厚・穏やか・
 * ドライ・軽快）に対応する。値は 0..1（DB CHECK 済み）。
 * 六角形のレーダーに藍のポリゴンを重ね、最も際立つ軸のラベルを強調する。
 * SVG は RSC で静的に描画（クライアント JS 不要）。スクリーンリーダー向けには
 * sr-only の定義リストで数値を提供する。
 */

const AXES: readonly { key: keyof FlavorChart; label: string }[] = [
  { key: "floral", label: "華やか" },
  { key: "mellow", label: "芳醇" },
  { key: "heavy", label: "重厚" },
  { key: "mild", label: "穏やか" },
  { key: "dry", label: "ドライ" },
  { key: "light", label: "軽快" },
] as const;

// レーダーの中心・半径（viewBox 200x190。デザイン 3a の座標系）
const CENTER_X = 100;
const CENTER_Y = 96;
const RADIUS = 66;

// 軸ラベルの配置（六角形の頂点の外側。デザイン 3a の実測値）
const LABEL_POSITIONS: readonly {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
}[] = [
  { x: 100, y: 18, anchor: "middle" },
  { x: 162, y: 61, anchor: "start" },
  { x: 162, y: 137, anchor: "start" },
  { x: 100, y: 180, anchor: "middle" },
  { x: 38, y: 137, anchor: "end" },
  { x: 38, y: 61, anchor: "end" },
] as const;

// 表示上の値域クランプ（DB CHECK で 0..1 を保証しているが防御的に）
function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 軸 index（0=上、時計回り 60° 刻み）と比率 0..1 から頂点座標を返す。 */
function axisPoint(index: number, ratio: number): { x: number; y: number } {
  const angle = (Math.PI / 180) * (index * 60 - 90);
  return {
    x: CENTER_X + RADIUS * ratio * Math.cos(angle),
    y: CENTER_Y + RADIUS * ratio * Math.sin(angle),
  };
}

/** 全 6 軸を比率 scale で結んだ polygon points 文字列（グリッドの六角形用）。 */
function ringPoints(scale: number): string {
  return AXES.map((_, index) => {
    const { x, y } = axisPoint(index, scale);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function FlavorChartView({ flavor }: { flavor: FlavorChart }) {
  const ratios = AXES.map((axis) => clamp01(flavor[axis.key]));
  const valuePoints = ratios.map((ratio, index) => axisPoint(index, ratio));

  // 際立つ軸（最大値との差 0.1 以内、最大 2 つ）をラベル強調とキャプションに使う。
  const max = Math.max(...ratios);
  const dominantIndexes =
    max > 0
      ? ratios
          .map((ratio, index) => ({ ratio, index }))
          .filter(({ ratio }) => ratio >= max - 0.1)
          .sort((a, b) => b.ratio - a.ratio)
          .slice(0, 2)
          .map(({ index }) => index)
      : [];
  const dominantSet = new Set(dominantIndexes);
  const caption =
    dominantIndexes.length > 0
      ? `${dominantIndexes.map((index) => AXES[index].label).join("・")}が際立つ味わい`
      : null;

  return (
    <section
      aria-labelledby="sake-flavor-heading"
      className="rounded-2xl border border-border bg-muted/50 p-5"
    >
      <h2 id="sake-flavor-heading" className="text-center text-sm font-bold">
        味わいの傾向
      </h2>

      <svg viewBox="0 0 200 190" className="mt-1 w-full" aria-hidden>
        {/* グリッド（外周＋内側 2 段） */}
        <polygon
          points={ringPoints(1)}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1"
        />
        <polygon
          points={ringPoints(2 / 3)}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1"
          strokeOpacity="0.7"
        />
        <polygon
          points={ringPoints(1 / 3)}
          fill="none"
          stroke="var(--border)"
          strokeWidth="1"
          strokeOpacity="0.7"
        />
        {/* 軸のスポーク */}
        <g stroke="var(--border)" strokeWidth="1" strokeOpacity="0.7">
          {AXES.map((axis, index) => {
            const { x, y } = axisPoint(index, 1);
            return (
              <line
                key={axis.key}
                x1={CENTER_X}
                y1={CENTER_Y}
                x2={x.toFixed(1)}
                y2={y.toFixed(1)}
              />
            );
          })}
        </g>
        {/* 値のポリゴン（藍・半透明） */}
        <polygon
          points={valuePoints
            .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
            .join(" ")}
          fill="var(--primary)"
          fillOpacity="0.16"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <g fill="var(--primary)">
          {valuePoints.map(({ x, y }, index) => (
            <circle
              key={AXES[index].key}
              cx={x.toFixed(1)}
              cy={y.toFixed(1)}
              r="2.5"
            />
          ))}
        </g>
        {/* 軸ラベル（際立つ軸は藍・太字で強調） */}
        <g fontSize="11">
          {AXES.map((axis, index) => {
            const position = LABEL_POSITIONS[index];
            const dominant = dominantSet.has(index);
            return (
              <text
                key={axis.key}
                x={position.x}
                y={position.y}
                textAnchor={position.anchor}
                fill={dominant ? "var(--primary)" : "var(--muted-foreground)"}
                fontWeight={dominant ? 700 : 400}
              >
                {axis.label}
              </text>
            );
          })}
        </g>
      </svg>

      {caption ? (
        <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
          {caption}
        </p>
      ) : null}

      {/* スクリーンリーダー向けの数値表現（SVG は aria-hidden） */}
      <dl className="sr-only">
        {AXES.map((axis, index) => (
          <div key={axis.key}>
            <dt>{axis.label}</dt>
            <dd>{Math.round(ratios[index] * 100)}%</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
