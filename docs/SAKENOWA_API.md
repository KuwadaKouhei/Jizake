# さけのわ API 調査メモ

> 調査日: 2026-07-04（全エンドポイントに実アクセスしてレスポンス構造を確認済み）
> 用途: T03「さけのわデータインポート」の実装リファレンス。
> 公式: https://muro.sakenowa.com/sakenowa-data/

## 1. 概要

さけのわデータプロジェクトは、日本酒アプリ「さけのわ」が蓄積した銘柄・蔵元・フレーバー
データを公開する API。**認証不要・無料・商用利用可**で、条件は**帰属表示のみ**。

- ベース URL: `https://muro.sakenowa.com/sakenowa-data/api/`
- メソッド: すべて GET
- フォーマット: JSON (UTF-8)。全レスポンスに `copyright: "Sakenowa"` を含む
- 認証・API キー: 不要
- レート制限: 公表なし（常識的な頻度で。本プロジェクトはローカルバッチで低頻度アクセス）
- 問い合わせ: support@sakenowa.com

### 利用規約（要点）

| 項目 | 内容 |
|---|---|
| 利用料 | 無料（商用可） |
| データの加工 | 可 |
| 必須条件 | **帰属表示**: データ利用箇所に sakenowa.com へのリンクを目立つ形で表示 |
| 禁止 | 帰属表示なしの利用、さけのわの評判を損なう利用、運営が不適切と判断する利用 |

→ 本アプリでは DESIGN.md の方針どおり**フッターに帰属表示を常設**する。

## 2. エンドポイント一覧（実測）

| エンドポイント | 内容 | 件数（2026-07 時点） |
|---|---|---|
| `/areas` | 地域（都道府県）マスタ | 48（1〜47 + 0=その他） |
| `/brands` | 銘柄マスタ | 約 3,400 |
| `/breweries` | 蔵元マスタ | 約 1,950 |
| `/rankings` | 総合・地域別人気ランキング（月次） | 総合100位 + 地域別各1〜50位 |
| `/flavor-charts` | フレーバー6軸（銘柄別） | 約 1,000+（**全銘柄にはない**） |
| `/flavor-tags` | フレーバータグマスタ | 242 |
| `/brand-flavor-tags` | 銘柄→タグID群 | 約 900+（空配列の銘柄あり） |

## 3. レスポンス構造（実測）

### /areas
```json
{ "copyright": "Sakenowa",
  "areas": [ { "id": 1, "name": "北海道" }, { "id": 13, "name": "東京都" }, { "id": 0, "name": "その他" } ] }
```
- **id 1〜47 は JIS 都道府県コードと一致**（1=北海道, 13=東京都, 47=沖縄県）。
  → DATABASE.md の `breweries.prefecture_code`（JIS, CHECK 1..47）へそのまま写せる。
- **id 0「その他」が存在**する点だけ例外処理が必要（海外蔵など）。インポート時は
  prefecture_code を NULL にするかスキップするかを決める（推奨: NULL 許容にせず「その他」蔵はスキップし件数をログ出力）。

### /brands
```json
{ "brands": [ { "id": 1, "name": "新十津川", "breweryId": 1 } ] }
```
- `id` が DATABASE.md の `sakes.sakenowa_brand_id`（UNIQUE・冪等 upsert キー）。
- **読み仮名・説明文・種別（純米/吟醸等）・価格・画像は無い**。名前と蔵元 ID のみ。
  → 読み仮名列（ILIKE 検索用）は自動生成 or 手作業シードで補完が必要。

### /breweries
```json
{ "breweries": [ { "id": 1, "name": "金滴酒造", "areaId": 1 } ] }
```
- `id` → `breweries.sakenowa_brewery_id`、`areaId` → `prefecture_code`。

### /rankings
```json
{ "yearMonth": "202606",
  "overall": [ { "rank": 1, "score": 4.41, "brandId": 109 } ],
  "areas":   [ { "areaId": 1, "ranking": [ { "rank": 1, "score": ..., "brandId": ... } ] } ] }
```
- 月次スナップショット（`yearMonth`）。総合は 100 位まで、地域別は 1〜50 件で地域差あり。
- → `sakes.popularity_rank`（推薦のコールドスタート・フォールバック用）の供給源。

### /flavor-charts
```json
{ "flavorCharts": [ { "brandId": 2, "f1": 0.25, "f2": 0.54, "f3": 0.32, "f4": 0.40, "f5": 0.42, "f6": 0.43 } ] }
```
- 6軸: f1=華やか, f2=芳醇, f3=重厚, f4=穏やか, f5=ドライ, f6=軽快。実測値域はおよそ 0.05〜0.78（正規化済み float）。
- **全銘柄の 1/3 程度にしかデータがない** → `sakes` のフレーバー列は「6軸全部あり or 全部 NULL」の CHECK（DATABASE.md DB-4）と整合。
- 味タグへの変換（例: f5 が高い→「辛口・ドライ」タグ付与）のしきい値は DESIGN.md §9 の未決事項どおり実装時にチューニング。

### /flavor-tags
```json
{ "tags": [ { "id": 3, "tag": "辛口" }, { "id": 6, "tag": "フルーティ" } ] }
```
- 242 種。「酸味」「辛口」「旨味」「フルーティ」「スッキリ」「甘味」「コク」など、
  ユーザー向けの味検索タグとしてそのまま使える語彙。

### /brand-flavor-tags
```json
{ "flavorTags": [ { "brandId": 2, "tagIds": [3, 5, 12, ...] } ] }
```
- 銘柄あたり 0〜20+ 個。**空配列の銘柄がある**（タグなし扱い）。
- → `tags`（source=sakenowa）+ `sake_tags` へのインポート供給源。

## 4. 設計への影響（確認済み事項）

| 設計上の前提 | 実測結果 |
|---|---|
| areaId = JIS 都道府県コード | ✅ 一致（ただし id 0「その他」の例外処理が必要） |
| brandId で冪等 upsert | ✅ 安定した整数 ID。UNIQUE(sakenowa_brand_id) でそのまま機能 |
| フレーバー6軸を real×6 で保持 | ✅ 正規化済み float。ただし約 2/3 の銘柄は欠損（全 NULL） |
| 味タグの供給 | ✅ flavor-tags 242 種 + brand-flavor-tags。空配列あり |
| 説明文・種別・価格・読み仮名 | ❌ 提供なし → FEASIBILITY どおり手作業シード必須 |
| ランキング | ✅ 月次。popularity_rank とコールドスタート対策に利用可 |

## 5. インポート実装メモ（T03 向け）

1. 取得順: areas → breweries → brands → flavor-charts → flavor-tags → brand-flavor-tags → rankings
   （FK の親から順に upsert）
2. 全エンドポイントは一括取得型（ページネーションなし）。7 リクエストで全データが揃うため、
   実行間に軽い sleep を入れる程度で十分。
3. レスポンスはフィクスチャとして `scripts/` のテストに保存し、API 仕様変更検知に使う
   （TEST_PHILOSOPHY のフィクスチャ方針どおり）。
4. `source` 列（sakenowa/manual）により、再インポートで手作業データ（説明文・タグ・リンク）を上書きしない。

## 出典

- [さけのわデータプロジェクト（公式）](https://muro.sakenowa.com/sakenowa-data/)
- 実 API レスポンス（2026-07-04 取得）: `/areas` `/brands` `/breweries` `/rankings` `/flavor-charts` `/flavor-tags` `/brand-flavor-tags`
- 参考記事: [Qiita: さけのわデータプロジェクトのAPI使ってみた（リンク切れ・404）](https://qiita.com/ironball/items/a22981dfe907b01cd153) / [Zenn: StreamlitとさけのわAPIで簡単ウェブアプリ作成](https://zenn.dev/lapisuru/articles/7a5ddca4037d6bbef697)
