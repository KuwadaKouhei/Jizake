# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T10-recommend`（T10 履歴ベース推薦エンジン＋ホーム表示）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T09: PR #9）

## 判定: ✅ マージ可

Blocker 0 件。Should をすべて本ブランチ内で対応済み（対応コミット: `8fcf732`, `709bd35`）。修正後、全検証グリーン（290 テスト・lint・typecheck・format・build）。

## 検証結果

- test 37 ファイル / 290 件全パス（T10 で +36）
- lint / typecheck / format:check / build すべてグリーン
- 思想準拠は「差し替え可能な知能は文句なく合格」、性能は「全 RSC・N+1 回避・インデックス活用が良好」、セキュリティは「ユーザーデータ分離は堅牢」と評価

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | 性能/セキュリティ | 候補クエリに上限がなく、汎用タグを持つヘビーユーザーで母集団が数百〜千件に膨らむ（自己 DoS・レイテンシ逆進性） | `candidatePoolSize=200` で人気順（`popularity_rank NULLS LAST`→id）に切ってスコアリング。`truncateProfileTags` で IN 句に渡すタグを重み上位 `maxProfileTags=30` に絞る |
| S-2 | コード | 閲覧済み除外が直近 100 件の履歴に限定され、ヘビーユーザーで既視銘柄が推薦に混入 | 除外用に全期間の `selectViewedSakeIds`（distinct・`excludeIdCap=5000`）を分離。集計用の直近履歴と役割分担 |
| S-3 | コード | `limit > popularPoolSize` で件数不足になる不変条件が未保証 | 母集団取得を `limit(max(poolSize, limit))` に。ホームを常に埋める |
| S-4 | 思想 | DESIGN §2.5/§4.2 の「単一の集計 SQL」記述と実装（複数クエリ）の乖離が未記録 | DESIGN を「複数クエリ＋スコア計算の純関数」に更新、TASKS 実施メモに分割理由を追記 |
| S-5 | 思想 | ホーム見出しが「ログイン有無」で、履歴しきい値未満でも「あなたへのおすすめ」と出る | 「履歴ベースの推薦が 1 件でもあるか」で判定し、全 popular なら「人気の日本酒」に倒す（透明性） |

### Consider（対応済み・任意分も反映）

- SEC C-1: `recommend()` の `limit` を `min(max(0,limit),50)` にクランプ（将来の呼び出しミス耐性）— 対応済み
- CODE C-1: コールドスタート（履歴しきい値未満のログインユーザー）にも閲覧済み ID を渡し既視除外 — 対応済み
- 記録のみ: `filters` jsonb の防御的読み取りは書き込み側 Zod 制限（MAX_TAGS/MAX_TAG_LENGTH）と二重

## 受け入れ条件の充足

- FR-05 後半（ホームに履歴に基づくおすすめ、履歴が無い場合は人気等のフォールバック）: `recommend({userId, limit})` の固定 IF＋ルールベース実装＋コールドスタート（人気ランキング）をテストで担保 ✅
- 制約: 実データでの推薦品質は Supabase 稼働＋履歴蓄積後。ロジックは PGlite で検証済み

## 設計思想の達成（差し替え可能な知能）

- 公開 IF（`recommend`）を `src/lib/recommend/types.ts` で固定、実装選択は `index.ts` の 1 箇所の委譲のみ、呼び出し側（`page.tsx`）は `recommend` と型のみに依存
- スコアリング（純関数 `scoring.ts`）と DB アクセス（`rule-based.ts`）を分離し、重み・減衰・しきい値・上限をすべて定数化
- 将来 協調フィルタリング等へ差し替えても `index.ts` の委譲先変更のみでホーム画面は無変更（DIRECTORY_STRUCTURE 例2 が物理的に成立）

## 性能・セキュリティの特記

- ホームは全 RSC・`force-dynamic`、クライアント JS 増分ゼロ。履歴・候補・人気クエリは N+1 回避（`selectTagsBySakeIds` 一括）でインデックス活用
- `userId` は `getCurrentUser()` 由来のみ（クライアント指定不可）、SQL は全経路パラメータ化、推薦理由は本人の嗜好カテゴリのみで他人・内部情報を出さない
