# RAG 精度 PoC 記録（T13 / FEASIBILITY R3・R4）

> 作成日: 2026-07-04
> 対象タスク: `feature/T13-rag-poc`
> 入力: DESIGN §2.6（retriever/generator 分離）・§6.3/§6.4・§9（未決事項）／
> FEASIBILITY R3・R4（日本語埋め込み精度は要 PoC・ハイブリッド検索）／
> DATABASE §2.10・§3 index 10（sake_embeddings・HNSW cosine）／REVIEW T12（B-1 移管）
>
> **重要な前提**: 本 PoC 実施時点で実 API キー（AI Gateway）・実 Supabase は未設定。
> 実埋め込みでの精度実測はできないため、本記録は「PoC の枠組み（評価ハーネス）と B-1 の実装」を
> 成果物とし、**精度の絶対値の確定は実キー投入後の残作業**として明記する（§6）。

---

## 1. 目的とスコープ

| 項目 | 内容 | 本 PoC での扱い |
|---|---|---|
| ① 評価セット | 質問 10 パターン × 期待銘柄 | 作成（seed-data の実在銘柄で表現）。§2 |
| ② retriever 精度計測 | 意図した銘柄が上位に来るか（recall@k / MRR） | 評価ハーネスを整備。実測の絶対値は実キー投入後。§3 |
| ③ ヒアリング→提案の捏造防止 | structured output ＋ ID 検証で捏造が落ちる | ダミー LLM 応答で end-to-end 検証。実 LLM 往復は残作業。§4 |
| ④ プロンプト初版 | ヒアリング 2〜3 問→検索→検索結果内のみ提案 | `src/lib/ai/prompts.ts` に定数化。§5 |
| ⑤ 検証スクリプトの隔離 | 使い捨て・main のビルド対象外 | `scripts/` 配下。§7 |
| ⑥ B-1（HNSW クエリ形状） | ANN 経路とタグ経路の分離 | 実装＋機能等価テスト。実データ EXPLAIN は手順を記録。§8 |

---

## 2. 評価セット（①）

`scripts/lib/rag-eval/eval-set.ts` に 10 パターンを定義した。各質問は「ユーザーがチャットで言いそうな
自然文（`freeText`）＋ヒアリングで確定しそうな条件（`tagNames`/`prefectureCode`/`priceRange`）」と、
「その意図に対して上位に来てほしい銘柄（期待銘柄）」を持つ。

- **期待銘柄は seed-data/sakes.ts の実在銘柄名で表現**し、実行時に DB の実 ID へ解決する
  （`harness.ts` の `loadSakeIdsByName`）。期待銘柄名が seed-data と厳密一致することは
  `harness.test.ts` の整合テストで担保（typo・未投入があれば `unresolvedExpectedNames` に出て失敗）。
- カバーする軸: 味わい（辛口・山廃/濃醇・華やか/フルーティー）、産地（新潟の淡麗辛口・山口の獺祭）、
  種別（純米大吟醸・純米吟醸）、価格帯（1500 円以下・3000 円超）、シーン（食中酒・贈答・晩酌）、
  希少性（東北の入手困難銘柄）。10 パターンで retriever の主要な検索経路を通す。

質問と期待銘柄の対応は `eval-set.ts`（`EVAL_CASES`）を単一情報源とする（本書には転載しない）。

---

## 3. 評価ハーネス（②）

### 3.1 構成

| ファイル | 責務 |
|---|---|
| `scripts/lib/rag-eval/metrics.ts` | 指標計算の純関数（`evaluateQuery` / `aggregateMetrics`）。recall@k・MRR・hit@k |
| `scripts/lib/rag-eval/eval-set.ts` | 評価セット（10 質問 × 期待銘柄名） |
| `scripts/lib/rag-eval/fake-embedding.ts` | 決定的ダミー埋め込み（実キー不在時のフォールバック） |
| `scripts/lib/rag-eval/harness.ts` | retriever へ埋め込みを注入して評価を走らせ指標を集計（`runEval`） |
| `scripts/rag-poc.ts` | 実行スクリプト（実/ダミー切替・レポート出力）。`npm run rag:poc` |

配置理由（DIRECTORY_STRUCTURE §3・DIR-7）: 評価ハーネスは**使い捨ての PoC 資産**であり Web アプリの
ビルド対象に含めない。`scripts/lib/` 配下に置き（本番バンドルに入れない）、ロジックはユニット/PGlite で
テストする（`tsconfig`/`vitest.config` の対象範囲: `scripts/**` は型チェック・テスト対象だが next build 非対象）。

### 3.2 評価指標（設計判断）

- **recall@k**: 期待銘柄のうち上位 k 件に含まれた割合。「意図した銘柄が上位に来るか」（②の主目的）を測る。
- **MRR（Mean Reciprocal Rank）**: 最初にヒットした期待銘柄の逆順位の平均。上位に出す力を強調する指標で、
  提案の先頭に良い銘柄を置けるかを測る（チャットは上位数件をカード提示するため順位が重要）。
- **hit@k**: 少なくとも 1 件ヒットした質問の割合。「全く外す」質問がどれだけあるかの粗い健全性。
- k の既定は 5（`runEval` の既定）。チャットの提案候補は上位 8 件程度（DESIGN §6.3）だが、
  評価は「上位で当てる」ことを厳しめに見るため k=5 を既定にした（実行時に変更可能）。

### 3.3 実/ダミー両対応（設計判断）

retriever は埋め込み関数を `EmbedQueryFn` で注入する（T12 の設計）。ハーネスはこの注入口を使い分ける:

- **実キーあり**: `embedText`（AI Gateway / text-embedding-3-small）でクエリを埋め込み、実データ
  （投入済み `sake_embeddings`）に対する日本語検索精度を実測する。
- **実キーなし（現状）**: `fakeEmbedText`（決定的ダミー）で動く。**ダミーの決定性**:
  同一テキスト→同一ベクトル、L2 正規化した単位ベクトル、文字 3-gram のハッシュを次元へ分散
  （語彙が重なるテキストがやや近くなる擬似語彙一致）。**精度の絶対値は無意味**（意味空間を再現しない）だが、
  「ハーネスの配線（retriever 注入→距離計算→指標集計）が end-to-end で動く・指標が計算される」ことを確認できる。

ハーネスの配線妥当性は `harness.test.ts` で「期待銘柄そのものを近傍にする理想埋め込みなら recall/MRR が
最大化する」ことを確認済み（良い埋め込みなら高スコアを出せることの担保）。

### 3.4 実行手順（実キー投入後）

```
# 1. .env.local に接続情報とキーを設定（.env.example 参照）
#    DATABASE_URL / AI_GATEWAY_API_KEY / NEXT_PUBLIC_SUPABASE_*
# 2. 実データ投入（T02〜T04・T11 の残作業）
npm run import:sakenowa
npm run seed
npm run embed          # sake_embeddings に実埋め込みを生成
# 3. PoC 実行（実キーがあれば実埋め込みで実測）
npm run rag:poc
#    → recall@5・MRR・hit@5 と質問ごとの初ヒット順位を出力
#    RAG_POC_FORCE_FAKE=1 npm run rag:poc  # 実キーがあってもダミー（配線確認）
```

---

## 4. 捏造防止の end-to-end 確認（③）

`scripts/lib/rag-eval/fabrication-guard.test.ts` で、実 LLM を叩かずに捏造防止の二段目を検証した。

- **ダミー LLM 応答**（proposeSake の structured output を模す）に、**実在銘柄 ID ＋ 実在しない ID（捏造）**を
  混ぜる。捏造は (a) 書式は正しいが DB に無い UUID、(b) UUID ですらない文字列（銘柄名を ID 欄に入れる）の 2 種。
- proposeSake 相当の Zod スキーマ（T14 ツール定義の雛形）でパース → `validateProposedSakeIds`
  （`selectExistingSakes`）で DB 存在検証。
- 確認できたこと:
  - スキーマ適合でも DB に無い ID は落ちる（**二段構えの二段目が効く**）。
  - 実在銘柄は**入力順（LLM の提示順）を保って**残り、カード化に必要な情報（名前・蔵元）が揃う。
  - 全提案が捏造なら 1 件も残らない（提案ゼロにフォールバック可能）。
  - UUID 書式ですらない捏造は DB 到達前に弾かれる。

**残作業**: 実 LLM（Claude Haiku 4.5）でのヒアリング→条件変換→提案の実往復（③の LLM 部分）は
実キーが要るため T14 と実キー投入後に実施する（§6）。本 PoC はサーバ側検証ロジックの正しさを決定的に固めた。

---

## 5. システムプロンプト初版（④）

`src/lib/ai/prompts.ts` に `CHAT_SYSTEM_PROMPT` を定数として用意した（T14 が使用）。方針:

- ヒアリングは 2〜3 問（`MAX_HEARING_QUESTIONS=3`）に絞る（DESIGN §2.6・D8: 進行制御は LLM に委任し
  アプリ側に状態機械を持たない）。1 メッセージ 1〜2 問。
- **提案は searchSake の検索結果にある銘柄のみ**（捏造禁止の一段目をプロンプトでも指示）。二段目は
  サーバ側の `validateProposedSakeIds`（§4）。受賞歴・スペック等の未確認情報を作らない。
- 検索 0 件は無理に提案せず条件緩和を促す。プロンプトインジェクション（役割無視の指示）に従わない。
- プロンプト文字列・上限数はすべて定数化（マジック文字列/数値禁止）。整合は `prompts.test.ts` で担保。

**残作業**: 実 LLM での進行品質（何問で十分か・条件変換の精度）の検証とプロンプト微調整は実キー投入後
（DESIGN D8: 不十分なら質問テンプレートをプロンプトに追加する方向で調整）。

---

## 6. 実キー投入後の残作業（絶対値確定はここで）

| # | 作業 | 前提 |
|---|---|---|
| 1 | 実データ投入（import:sakenowa / seed / embed） | Supabase 実プロジェクト（T02 残作業）＋ AI_GATEWAY_API_KEY |
| 2 | `npm run rag:poc` で実埋め込みの recall@5・MRR・hit@5 を実測 | 上記 1 完了 |
| 3 | 実測に基づき retriever 重み（`VECTOR_WEIGHT`/`TAG_WEIGHT`）を確定 | §9 の暫定値を調整（DESIGN §9） |
| 4 | 実 LLM でヒアリング→条件変換→提案の往復を試行し捏造が落ちることを確認 | T14 の tools 実装 |
| 5 | プロンプトの進行品質を検証し微調整（質問数・条件変換） | 同上 |
| 6 | **実 Postgres で B-1 の EXPLAIN 確認**（HNSW 使用可否） | §8.3 の手順 |

**ダミー埋め込みでの指標の絶対値は無意味**（意味空間を再現しない）。本 PoC で確立したのは
「ハーネスが動く・指標が計算される・実キーでの実行手順」であり、精度の絶対値の確定は上記 2・3 で行う。

**運用上の注意（REVIEW T13 セキュリティ Consider）**:
- `npm run rag:poc` は `DATABASE_URL` の DB に読み取りクエリを流す。**本番 DB を誤って指さない**よう、
  評価用 DB を明示指定して実行する（起動ログに接続先を確認する運用を推奨）。
- `fabrication-guard.test.ts` の `proposeSakeSchema` は PoC 用の雛形。**T14 で決着**（消し込み済み）:
  本番スキーマ `proposeSakeInputSchema` は `api/chat/_lib/tools.ts` に確定したが、scripts は src/app を
  import できない（DIRECTORY_STRUCTURE §5.2）ため差し替えはできない。**本番スキーマそのものでの捏造防止
  E2E は `src/app/api/chat/_lib/tools.test.ts` に移設**し、PoC 雛形は同一構造で据え置いた。両者と tools.ts に
  相互参照コメントを付けドリフトに気づける状態にした（T14 REVIEW PHIL S-1）。
- `scripts/lib/rag-eval/` は使い捨て資産。実キー投入後に本 PoC の役目を終えたら、`fake-embedding.ts` を含め
  ハーネス一式は撤去してよい（恒久資産は `src/lib/ai/prompts.ts` のみ）。

---

## 7. 検証スクリプトの隔離（⑤）

- 評価ハーネス・PoC スクリプトはすべて `scripts/` 配下（`scripts/rag-poc.ts`・`scripts/lib/rag-eval/`）に置く。
- `next build`（本番バンドル）の対象は `src/`。`scripts/` はローカル tsx バッチで**ビルド対象外**
  （DIRECTORY_STRUCTURE §3）。`vitest.config.ts` の `include` は `scripts/**/*.test.ts` を含むため
  **型チェック・テストは対象**（ロジックを PGlite/ユニットで検証できる）。build に含まれないことは
  §9 の検証（build グリーン）で確認。
- retriever 本体（`src/lib/rag/retriever.ts`）は使い捨て資産に依存しない（依存は一方向: scripts → src/lib）。

---

## 8. B-1: HNSW クエリ形状の分離（⑥ / REVIEW T12 PERF B-1 の移管）

### 8.1 背景（T12 で移管された理由）

T12 の retriever は `sakes` を起点に `LEFT JOIN sake_embeddings` ＋ `CASE`（NULL 分岐）＋
複合 ORDER BY（距離→人気→名前）で母集団を並べていた。この形状では pgvector の **HNSW インデックス
（DATABASE §3 index 10）が近傍探索に使われず**、フリーテキスト検索が実質全件距離計算になり得る
（REVIEW T12 B-1）。ただし index 使用可否は PGlite では確認できず実 Postgres の EXPLAIN が必須で、
クエリ形状チューニングは T13 の主目的そのものだったため T13 へ移管された。

### 8.2 変更内容（分離方式・設計判断）

`retrieveSakeCandidates` を **ANN 経路とタグ経路の分離＋和集合**に変更した（公開シグネチャ
`retrieve(query)`・戻り値 `SakeCandidate[]` は不変）。

- **ANN 経路**（`selectAnnCandidates`）: `sake_embeddings` を起点に、素の
  `embedding <=> $query` の `ORDER BY <=> LIMIT` で近傍上位を取る。**CASE 式・LEFT JOIN・複合 ORDER BY を
  挟まない**ため HNSW（`vector_cosine_ops`）が近傍探索に使える形状。タグ/都道府県/価格帯のハード絞り込みは
  同じ where で AND する（プランナが index 併用可）。freeText があるときだけ実行。
- **タグ経路**（`selectTagCandidates`）: タグ/都道府県/価格帯のハード絞り込みで母集団を取る。
  `sake_embeddings` を JOIN しないため、**埋め込みが無い銘柄も母集団に残せる**（ベクタ検索に出ない銘柄を
  タグで拾う。DESIGN §2.6 の担保）。
- **和集合＋スコアリング**: 両経路の sakeId を `Set` で和集合にし、その集合の銘柄要約・タグを一括取得
  （`inArray`・N+1 回避）。ANN 経路の距離をベクタ類似度成分に、タグ一致数をタグ成分にして `combineScore`
  （加重和）を計算。最終順位はスコア降順（同点は距離昇順→人気昇順→名前→id の安定順を明示比較）。

### 8.3 機能的等価の担保

分離しても「分離前と同じ候補が返る・埋め込み無し銘柄もタグで拾える・上位 N」ことを PGlite(+pgvector) で
テストした（`src/lib/rag/retriever.test.ts`）:

- T12 からの既存 18 テストが**分離後も全パス**（近い銘柄が上位・タグ AND 絞り込み・埋め込み無しをタグで拾う・
  都道府県/価格帯絞り込み・上位 N・limit0 で埋め込み非呼び出し・freeText 無しで人気順・逆向き埋め込みの
  クランプ・limit/freeText の安全上限）。
- B-1 の追加テスト（5 件）: ANN 近傍とタグ経路全件の和集合・ANN 経路の距離昇順・タグ経路が埋め込み無し銘柄を
  残す・ANN 経路にも都道府県フィルタが乗る・両経路に出る重複が 1 件に畳まれる。

**注記（母集団の広がり）**: タグ未指定かつ freeText 有りのとき、タグ経路は全件（人気順 pool 件）を返し ANN
近傍と和集合になるため、分離前（距離順 pool 件）より母集団がやや広がりうる。ただし最終スコアは距離で決まり
上位 limit 件を返すため**返る結果は等価**（既存テストが裏付け）。数千件規模では pool=100 の 2 経路で問題ない。

### 8.4 実データ EXPLAIN 確認手順（PGlite では確認不能）

HNSW インデックスが実際に使われるかは**実 Postgres でのみ**確認できる（PGlite の pgvector は
プランナ挙動が実 Postgres と一致する保証がなく、本確認は対象外）。実 Supabase 投入後に以下で確認する:

```sql
-- 1. HNSW を近傍探索に使わせるための計画確認（ANN 経路の素の形状）
--    $1 は 1536 次元のクエリベクトル（アプリは Drizzle がバインド）。
EXPLAIN ANALYZE
SELECT se.sake_id, se.embedding <=> $1 AS distance
FROM sake_embeddings se
JOIN sakes s ON s.id = se.sake_id
JOIN breweries b ON b.id = s.brewery_id
-- （タグ/都道府県/価格帯フィルタがあれば AND で付ける）
ORDER BY se.embedding <=> $1
LIMIT 100;

-- 期待: 出力計画に "Index Scan using sake_embeddings_embedding_idx"（HNSW）が現れること。
--       Seq Scan + Sort になっていれば index が効いていない（要調査）。
-- 補助: SET enable_seqscan = off; で index 使用を強制した計画と比較して差を見る。
--       件数が少ないと planner が Seq Scan を選ぶため、実データ規模（数千件）で確認する。
```

- **3 形状で個別に確認する**（フィルタの選択率が下がると planner が HNSW を捨てやすいため。REVIEW T13 PERF S-1）:
  1. フィルタ無し（純粋な意味検索。※この経路はタグ経路を省く＝PERF S-2 実装済み）
  2. 都道府県フィルタ有り（`AND b.prefecture_code = $2`）
  3. タグ EXISTS 有り（`AND EXISTS (... sake_tags ...)`）
  各形状で `Index Scan using sake_embeddings_embedding_idx`（HNSW）が残るかを個別に見る。
- 確認観点: (a) ANN 経路が `Index Scan ... hnsw` になる、(b) フィルタ AND を足しても近傍探索が壊れない、
  (c) 実測レイテンシが分離前より悪化しない。
- 効いていない場合の対処（フォールバック設計。公開シグネチャは不変で内部吸収）:
  - `SET hnsw.ef_search` の調整。
  - フィルタ有り形状で HNSW が外れる場合は、ANN 経路を `sake_embeddings` **単独**（JOIN 無し）で
    `ORDER BY embedding <=> $vec LIMIT k` の純 top-k とし、都道府県/価格帯/タグのハードフィルタは
    和集合後のメモリ側 or 別クエリで適用する（index を最優先で活かす形へ）。

---

## 9. retriever 重みの暫定値と確定方針

| 定数 | 暫定値 | 意味 |
|---|---|---|
| `VECTOR_WEIGHT` | 0.7 | ベクタ類似度成分の重み（自然文がある場合の主シグナル） |
| `TAG_WEIGHT` | 0.3 | タグ一致率成分の重み（埋め込み無し銘柄もこの成分で順位が付く） |
| `DEFAULT_CANDIDATE_LIMIT` | 8 | 返す候補の既定上限（DESIGN §6.3） |
| `CANDIDATE_POOL_SIZE` | 100 | 各経路の母集団上限（自己 DoS 回避） |

- 初期値 0.7/0.3 は T12 で定めた**暫定値**（DESIGN §9: 実装時に定数化し PoC で調整）。小規模 DB では
  タグ SQL で母集団を絞った上での意味的近さが効くためベクタを高めにしている。
- **確定方針**: 実埋め込み投入後に `npm run rag:poc` の recall@5・MRR を指標に、重みを振って
  （例: 0.5/0.5・0.7/0.3・0.8/0.2）最良の組を選ぶ。重みは `retriever.ts` の定数変更のみで差し替わる
  （DIRECTORY_STRUCTURE §5.1）。本 PoC はダミー埋め込みのため重みの確定は行わず、暫定値を据え置く。

---

## 10. 本 PoC の結論

- **枠組みは完成**: 評価セット・評価ハーネス（実/ダミー両対応）・指標計算・捏造防止 E2E・プロンプト初版・
  B-1 の分離実装がそろい、すべて PGlite/ユニットで検証済み（テストグリーン）。
- **B-1 は機能的に等価な分離を実装**（HNSW を活かす ANN 経路）。index 使用可否の実測は §8.4 の手順で実データ確認へ。
- **精度の絶対値・重みの確定・実 LLM 往復は実キー投入後の残作業**（§6）。FR-08 の品質リスク R3/R4 は
  「実キーがあれば実測できる枠組み」を確立したことで、解消の見込みが立った。
