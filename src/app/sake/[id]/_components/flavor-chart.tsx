import type { FlavorChart } from "@/lib/db/queries/sakes";

/**
 * フレーバー 6 軸の簡易表示（バー）。
 *
 * 軸ラベルは DATABASE.md / DESIGN §2.7 の 6 軸（華やか・芳醇・重厚・穏やか・
 * ドライ・軽快）に対応する。値は 0..1（DB CHECK 済み）。
 * レーダーチャート等の凝った描画はせず、まずは横バーで簡潔に見せる（シンプルさ優先）。
 */

const AXES: readonly { key: keyof FlavorChart; label: string }[] = [
  { key: "floral", label: "華やか" },
  { key: "mellow", label: "芳醇" },
  { key: "heavy", label: "重厚" },
  { key: "mild", label: "穏やか" },
  { key: "dry", label: "ドライ" },
  { key: "light", label: "軽快" },
] as const;

// 表示上の値域クランプ（DB CHECK で 0..1 を保証しているが防御的に）
function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function FlavorChartView({ flavor }: { flavor: FlavorChart }) {
  return (
    <section aria-labelledby="sake-flavor-heading">
      <h2 id="sake-flavor-heading" className="mb-2 text-sm font-semibold">
        味わいの傾向
      </h2>
      <dl className="grid gap-2">
        {AXES.map((axis) => {
          const ratio = clamp01(flavor[axis.key]);
          return (
            <div key={axis.key} className="flex items-center gap-3">
              <dt className="w-16 shrink-0 text-xs text-muted-foreground">
                {axis.label}
              </dt>
              <dd className="flex-1">
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="meter"
                  aria-label={axis.label}
                  aria-valuemin={0}
                  aria-valuemax={1}
                  aria-valuenow={ratio}
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
