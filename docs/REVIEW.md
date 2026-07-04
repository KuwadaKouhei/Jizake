# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T07-search`（T07 検索機能）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T06: PR #6）

## 判定: ✅ マージ可

Blocker 1 件・Should 複数をすべて本ブランチ内で対応済み（対応コミット: `fix: T07 レビュー指摘対応`）。修正後、全検証グリーン（177 テスト・lint・typecheck・format・build）。

## 検証結果

- test 23 ファイル / 177 件全パス（T07 で +67）
- lint / typecheck / format:check / build すべてグリーン
- `/search` は `ƒ (Dynamic)`・ページ固有クライアント JS ゼロ（GET フォーム）
- 検索は count 1 + 一覧 1 + タグ 1 の 3 クエリで N+1 なし

## 指摘と対応

### Blocker（対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| B-1 | 性能 | `revalidate=3600` が DESIGN §6.1「検索結果は動的レンダリング」に矛盾（履歴投入 T09 の反映を最大1時間遅らせる意図矛盾のデッドコード） | `export const dynamic = "force-dynamic"` に変更し検索の動的性を明示 |

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | セキュリティ | `page` に上限がなく巨大 `?page=` で巨大 OFFSET の DoS 余地 | `parsePageParam` に `MAX_PAGE=10000` 上限を追加（県別一覧にも波及）＋テスト |
| S-2 | コード | 味タグの順序差で URL・キャッシュキー・生成 SQL が非決定的 | `normalizeStringList` を集合としてソート正規化。同義 URL を同一表現に寄せる＋決定性テスト |
| S-3 | コード/思想 | DESIGN §5.3 の `tagIds`・`_lib/search-sakes.ts` 配置が実装（`tagNames`・`db/queries` 集約）と乖離 | DESIGN §5.3・DIRECTORY_STRUCTURE §2 ツリー・TASKS 実施メモを実装に合わせて更新（DIR-6 の横断クエリ判定を明記） |
| C-1 | コード/セキュリティ | `normalizePage` が `parsePageParam` と重複、`page.tsx` に未使用 import | page 正規化を `parsePageParam` に一本化、未使用 import を削除 |

### Consider（引き継ぎ・記録）

- **性能 S-1（名前ソートのインデックス）／S-2（`ILIKE '%…%'` の seq scan）**: DESIGN §6.1 の「計測してから足す」方針どおり、実データで `EXPLAIN ANALYZE` して劣化を確認してから `(name,id)` btree / `pg_trgm` GIN を追加（関数シグネチャ不変の拡張パス）。実 Supabase 稼働後の課題として記録
- **`getSearchSakes` の JSON.stringify メモ化キー**: tagNames ソート正規化により順序非依存になり決定性が向上（S-2 で実質解消）
- **`SakeSearchQuery` と `SearchCriteria` の二重定義**: データアクセス層が UI 層の型を import しない依存方向（§5.2）を守るための意図的独立定義（コメントに理由記載済み）

## 受け入れ条件の充足

- FR-06（名前・都道府県・味の各条件と組み合わせで検索、結果一覧→詳細遷移、0 件は空状態）: URL クエリ駆動の複合検索＋ページャ＋空状態＋カードリンクをテストで担保 ✅
- FR-02（タグをキーに絞り込める）: 味タグ AND 絞り込み（EXISTS 相関サブクエリ）✅
- 制約: 実データ検索は Supabase 稼働後。ロジックは PGlite で検証済み

## 各観点の総評

- **セキュリティ**: SQL 完全パラメータ化、`escapeLikePattern` で LIKE ワイルドカード無害化、Zod 境界サニタイズ（q 長さ・prefecture 許可リスト・tags 件数・page 上限）、XSS なし（テキスト描画徹底）、オープンリダイレクトなし（宛先は固定 `/search`）
- **性能**: 全 RSC・GET フォームでクライアント JS ゼロ、3 クエリで N+1 なし。インデックス最適化は計測後の拡張パス
- **思想**: URL クエリ駆動・純関数分離（DESIGN §2.2）に忠実。pagination 昇格（DIR-10）は模範的。YAGNI 判断（タグ AND 単一・都道府県単一・空条件全件）は理由付きで記録
