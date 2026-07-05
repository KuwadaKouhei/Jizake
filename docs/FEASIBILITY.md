# 技術調査書（Feasibility Study）— Jizake（日本酒レコメンドWebアプリ）

> 対象: `docs/REQUIREMENTS.md`（FR-01〜FR-08）
> 前提: グリーンフィールド（既存コードなし）。自律実行モードのため、判断が必要な点は推奨デフォルトを採用し本書に明記した。
> 調査日: 2026-07-04

## 0. 判定サマリ

| 要件 | 内容 | 判定 | 主な条件・リスク |
|---|---|---|---|
| FR-01 | 日本酒データ取得・管理 | 条件付き可能 | さけのわAPIは「説明文」を提供しない → 説明文は自作シード必須。帰属表示（クレジット＋リンク）必須 |
| FR-02 | 特徴タグ | 実現可能 | さけのわのフレーバータグ/チャートから機械的に生成可能 |
| FR-03 | 詳細ページ（価格帯・購入リンク） | 条件付き可能 | Amazon PA-APIは初期利用不可（売上実績要件）→ 検索リンク or 楽天市場APIで代替 |
| FR-04 | ログイン | 実現可能 | Supabase Auth 無料枠 50,000 MAU で個人開発規模は余裕 |
| FR-05 | 履歴ベース推薦 | 実現可能 | ルールベース（タグ頻度）はDBクエリのみで実装可。コールドスタートはランキングでフォールバック |
| FR-06 | 検索 | 実現可能 | Postgres の ILIKE / pg_trgm とタグJOINで十分 |
| FR-07 | 都道府県別地酒 | 実現可能 | さけのわ areas/breweries で都道府県マッピング可 |
| FR-08 | RAGチャットボット | 条件付き可能（PoC推奨） | 技術的には確立済み（pgvector + AI SDK + Claude）。LLM APIに無料枠なし（低コストだが従量課金）。捏造防止の設計とPoCが必要 |

差し戻し（/1-requirements）を要する「困難」判定はなし。ただし FR-01 の「説明文」と FR-03 の「価格帯」は要件の期待値調整が必要（後述）。

---

## 1. 日本酒データの取得方法（FR-01, FR-02, FR-07）

### 1.1 さけのわデータプロジェクト（第一候補）

公式ページ（一次情報）: https://muro.sakenowa.com/sakenowa-data/

- 提供API（JSON / UTF-8、HTTP GET）:
  - `GET /areas`（地域一覧 = 都道府県）
  - `GET /brands`（銘柄一覧: 銘柄ID・名称・蔵元ID）
  - `GET /breweries`（蔵元一覧: 蔵元ID・名称・地域ID）
  - `GET /rankings`（全国ランキング50件＋地域別ランキング）
  - `GET /flavor-charts`（華やか/芳醇/重厚/穏やか/軽快/ドライの6軸数値）
  - `GET /flavor-tags`, `GET /brand-flavor-tags`（フレーバータグと銘柄への紐付け）
- 規模: 2,500超の銘柄フレーバーデータを公開（PR TIMES 発表: https://prtimes.jp/main/html/rd/p/000000003.000060490.html ）
- 利用条件（公式ページより）:
  - 無料、商用・非商用を問わず利用可、データの加工利用可
  - 必須: 「さけのわデータを利用している」旨の表示と https://sakenowa.com へのリンク（帰属表示）
  - 禁止: 帰属表示なしの利用、さけのわのイメージを損なう利用
  - 明示的なライセンス条項（CC等）や更新頻度の記載はなし → 規約変更・提供終了リスクあり。取得データはDBに取り込み（スナップショット化）、API直依存を避ける
- 実装実績: サードパーティのラッパーや作例が複数存在し、APIの安定利用実績がある（例: https://github.com/ironball1113/sakenowa_wrapper 、https://qiita.com/ranchi1977/items/fff2dc52def04f6a8cee ）

重要な制約: さけのわAPIは銘柄名・蔵元・地域・フレーバー・ランキングを提供するが、銘柄の「説明文」「公式サイトURL」「種別（純米/吟醸等）」「価格」は提供しない。FR-01 の必須項目「説明文」は満たせないため、説明文は自作が必要。

### 1.2 その他の公開データソース

| ソース | 内容 | 実用性 |
|---|---|---|
| 国税庁（酒類等製造免許の新規取得者一覧、酒のしおり等: https://www.nta.go.jp/taxes/sake/menkyo/shinki/seizo/02.htm ） | 免許取得者名・製造場所在地等（Excel/PDF中心） | 低。統計・免許情報であり銘柄単位のデータではない。蔵元マスタの補完程度 |
| e-Gov データポータル（ https://data.e-gov.go.jp/ ） | 法人情報CSV等 | 低。銘柄データなし |
| Wikipedia | 銘柄・蔵元の解説文 | 低〜中。CC BY-SA 継承（コピーレフト）義務があり、説明文の転載はライセンス伝播の問題。参考資料として自分の言葉で書き起こす用途に留める |

### 1.3 スクレイピングの法的・実務的リスク

- スクレイピング自体は直ちに違法ではないが、次のリスクがある。
  1. 著作権: 説明文・レビュー等の複製転載は侵害になり得る。情報解析目的の複製は著作権法の例外規定（平成30年改正後は30条の4等）で許容されるが、取得した文章をそのままサイトに表示する行為は「解析」ではなく対象外
  2. 利用規約違反: 酒販EC・レビューサイトの多くはスクレイピングを禁止
  3. 過負荷による業務妨害: 岡崎図書館事件では過剰アクセスにより偽計業務妨害容疑で逮捕例（起訴猶予）
  - 弁護士監修解説: https://pig-data.jp/blog_news/blog/scraping-crawling/scrapinglaw/ 、https://it-bengosi.com/blog/scraping/
- 公式APIが提供されている場合はAPI利用が強く推奨される。
- 結論: スクレイピングは採用しない。

### 1.4 推奨（デフォルト採用）

ハイブリッド方式: さけのわAPIをインポートスクリプトで取り込み（銘柄・蔵元・都道府県・フレーバー・ランキング）＋ 説明文・種別タグ・公式リンクは手作業シード（初期は主要銘柄 50〜100件に説明文を付与し段階拡充）。

- インポートは再実行可能な CLI スクリプト（upsert）として整備 → FR-01 受け入れ条件を満たす
- フレーバーチャート6軸をしきい値で「淡麗/濃醇/華やか」等のタグへ機械変換 → FR-02 のタグを自動生成
- `areas` と `breweries` の結合で都道府県→銘柄の逆引きが可能 → FR-07 成立
- フッター等に「さけのわデータを利用しています」＋リンクを常時表示（利用条件遵守）

判定: FR-01 条件付き可能 / FR-02 実現可能 / FR-07 実現可能

---

## 2. 価格帯・Amazonリンク（FR-03）

### 2.1 Amazon Product Advertising API（PA-API v5）

公式（アソシエイト・セントラル）: https://affiliate.amazon.co.jp/help/node/topic/GVJ2BJP35457CLML

- 利用には Amazon アソシエイト登録に加え、サインアップから180日以内に3件以上の適格販売が必要（さらにサイト審査あり）
- アクセス許可後も直近30日間に売上がないと利用が一時停止される（売上再発生で復旧）
- リクエスト上限も売上連動（初期 8,640回/日、以降は売上 $0.05 ごとに +1回/日）
- 参考（ポリシー変更告知）: https://affiliate.amazon.co.jp/help/node/topic/GW65C7J2CSK7CA6C

結論: 新規サービスの立ち上げ時点では PA-API は事実上利用不可（売上実績が先に必要という鶏と卵の問題）。

### 2.2 代替案の比較

| 案 | 価格帯取得 | 実装コスト | 備考 |
|---|---|---|---|
| A. Amazon 検索リンク（`https://www.amazon.co.jp/s?k=銘柄名`。アソシエイトタグは審査通過後に付与） | 不可 | 極小 | 静的URL生成のみ。規約リスクなし。購入リンク要件はこれで満たせる |
| B. 楽天市場 商品検索API（Rakuten Web Service: https://webservice.rakuten.co.jp/documentation/ichiba-product-search ） | 可（商品名・価格・アフィリエイトURL） | 小 | アプリID登録のみで無料利用可。売上実績要件なし。レート制限あり（1リクエスト/秒目安） |
| C. 手作業シードで参考価格帯（例: 〜1,500円 / 1,500〜3,000円 / 3,000円〜 の区分） | 可(静的) | 小 | 更新が手動。主要銘柄のみ |
| D. PA-API | 可 | 中 | 売上実績が付いた後に後付けで移行可能な設計にしておく |

推奨（デフォルト採用）: 初期は A（Amazon検索リンク）＋ C（価格帯の手動区分）。価格の自動取得が必要になった段階で B（楽天API）を追加。PA-API は将来オプション。REQUIREMENTS の前提どおり価格帯はベストエフォート項目として扱う。

追記（2026-07-05・FR-09 銘柄画像）: B（楽天市場 商品検索API）は商品画像も返す
（`mediumImageUrls`: 128px。URL の `_ex=WxH` パラメータで最大 400px 程度まで拡大取得可）。
2026 年の API 移行後のエンドポイントは `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701` で、
認証は applicationId＋accessKey（アプリ ID 登録のみ・無料・売上実績要件なし）。
日本酒ジャンルは genreId=100337。画像は楽天 CDN の URL を参照表示する（自前保存・加工はしない）。
名前検索の誤マッチ（セット商品等）が主リスクのため、銘柄名包含・NG ワード・監査ログで抑止する（T17）。

判定: FR-03 条件付き可能（条件: PA-API に依存しない。価格帯はベストエフォート）

---

## 3. RAGチャットボット（FR-08）

### 3.1 実現方式（推奨構成）

数百〜数千件規模の日本酒DBを知識源とする RAG は、確立されたパターンで実現可能。

- ベクタDB: Supabase（Postgres）の pgvector 拡張。全プラン（無料含む）で追加費用なしで利用可（ https://supabase.com/docs/guides/database/extensions/pgvector ）。数千件 x 1536次元なら容量・性能とも余裕（1536次元 float で約6KB/件 → 3,000件で約20MB。無料枠 500MB に収まる）
- 埋め込み: OpenAI `text-embedding-3-small`（$0.02/100万トークン、多言語対応・日本語可、1536次元。 https://developers.openai.com/api/docs/models/text-embedding-3-small ）。全銘柄の説明文（3,000件 x 約300トークン = 約90万トークン）の埋め込みは $0.02 程度で完了
- 生成: Claude API（Anthropic）。Claude Haiku 4.5 は入力 $1 / 出力 $5（100万トークンあたり）（ https://platform.claude.com/docs/en/about-claude/pricing ）。1会話（入力 約3Kトークン x 5往復、出力 約2Kトークン）で $0.02〜0.03/会話 程度
- フレームワーク: Vercel AI SDK ＋ `@ai-sdk/anthropic`。`useChat` によるストリーミングUI、tool calling（DB検索をツールとしてLLMに実行させる）を標準サポート。公式RAGテンプレートあり（ https://vercel.com/templates/next.js/ai-sdk-rag 、https://ai-sdk.dev/docs/introduction ）
- 捏造防止（受け入れ条件対応）:
  1. ベクタ検索/タグ検索の結果（DB内の銘柄ID付き）のみを提案候補としてプロンプトに渡す
  2. 提案は tool calling / structured output で銘柄IDを返させ、サーバ側でDB存在チェックしてからカードUIに描画する。IDが実在しない提案は表示しない
  - この2段構えでハルシネーション表示を構造的に排除できる

補足: 小規模DB（数千件）では「純粋なベクタ検索」よりも「タグ・フレーバー条件によるSQL絞り込み＋ベクタ類似度の併用（ハイブリッド検索）」のほうが精度が出やすい。ヒアリング回答→検索条件への変換を tool calling で行う設計を推奨。

### 3.2 コスト感と無料枠

| 項目 | 無料枠 | 想定コスト（月間500会話・個人開発規模） |
|---|---|---|
| Anthropic API | 無料枠なし（従量課金、最低チャージ $5 程度） | Haiku 4.5 で $10〜15/月 |
| OpenAI Embeddings | 無料枠なし | 初期投入 $0.02、クエリ埋め込みは $0.1未満/月 |
| Supabase（DB+pgvector+Auth） | 無料（500MB DB、50,000 MAU、5GB帯域。7日間アクセスなしで一時停止: https://www.itpathsolutions.com/supabase-free-tier-limits ） | $0 |
| Vercel（Hobby） | 無料（個人・非商用） | $0 |

- リスク: LLM APIキーの露出・乱用（対策: サーバサイドのみで使用、レート制限を実装）、Supabase 無料枠の自動一時停止（対策: 定期 ping、または本運用時に Pro $25/月）
- PoC 推奨: 日本語の短い説明文に対する埋め込み検索の精度（意図通りの銘柄が上位に来るか）と、ヒアリング→検索条件変換の品質。銘柄50件＋質問10パターンで半日〜1日のスパイクで検証可能

判定: FR-08 条件付き可能（条件: 従量課金コストの許容〔月 $10〜20 目安〕、捏造防止のID検証設計、PoC実施）

---

## 4. 認証（FR-04）

| 候補 | 無料枠 | 特徴 | 懸念 |
|---|---|---|---|
| Supabase Auth（推奨） | 50,000 MAU | DB と同一基盤。RLS（行レベルセキュリティ）により「履歴は本人のみ参照可能」を DB 層で強制できる。メール＋パスワード / OAuth 対応 | メールテンプレート等のカスタマイズ性は中程度 |
| Clerk | 10,000 MAU | UI コンポーネントが最も洗練。実装最速 | 超過後 $25/月〜＋従量。DB と別サービスになる |
| Auth.js (NextAuth) | 無制限（自前ホスト） | 無料・自由度高 | メンテナンスモード入り（セキュリティ修正のみ、新機能なし）が報告されており新規採用は非推奨（ https://makerkit.dev/blog/tutorials/better-auth-vs-clerk ） |
| Better Auth | 無制限（自前ホスト） | Auth.js の後継的ポジションで開発が活発 | パスワードリセットやメール送信等を自前で運用する手間 |

比較出典: https://qiita.com/DevMasatoman/items/7bcabe0325dfc3f8cc4d 、https://www.buildmvpfast.com/blog/best-auth-providers-2026-clerk-supabase-comparison

推奨（デフォルト採用）: Supabase Auth。DB（pgvector）と統合でき、無料枠が最大で、非機能要件（パスワードハッシュ化はマネージド側で担保、履歴の本人限定参照は RLS で実装）を最小工数で満たす。

判定: FR-04 実現可能

---

## 5. 履歴ベース推薦（FR-05）と検索（FR-06）

### 5.1 履歴ベースのルールベース推薦

- 閲覧履歴（view_history: user_id, sake_id, viewed_at）と検索履歴（search_history: user_id, query, filters）を記録
- 推薦スコア = 履歴に紐づくタグ（味わい・都道府県・種別）の出現頻度を集計し、未閲覧銘柄をタグ一致度でスコアリング。単一の SQL（集計＋JOIN）で実装可能。数千件規模なら性能問題なし（一覧2秒以内の非機能要件は容易に達成）
- 直近履歴の重み付け（時間減衰）も viewed_at ベースの係数で対応可
- コールドスタート対策: 履歴ゼロ〜少数のユーザーには、さけのわランキングAPI由来の人気銘柄（全国/地域別）にランダム性を加えて表示（受け入れ条件のフォールバック要件と一致）
- 外部依存なし・追加コストなし。将来の協調フィルタリングへの拡張はイベントログ形式のテーブル設計で担保

判定: FR-05 実現可能

### 5.2 検索

- 名前部分一致: Postgres ILIKE。件数増加時は pg_trgm インデックスで対応（Supabase で拡張利用可）
- 都道府県・味（タグ）: 正規化テーブルの JOIN / EXISTS。複合条件は AND 結合
- 日本語の表記ゆれ（ひらがな/カタカナ/漢字）はリスク。銘柄に「読み仮名」列を持たせ両方を検索対象にする（さけのわ brands には読みがないため、シードで補完。初期は主要銘柄のみでも可）

判定: FR-06 実現可能（0件時の空状態表示は実装課題のみ）

---

## 6. 推奨技術スタック（デフォルト採用）

| レイヤ | 採用 | 根拠 |
|---|---|---|
| フレームワーク | Next.js (App Router) + TypeScript | AI SDK・Vercel との親和性、レスポンシブWeb要件 |
| ホスティング | Vercel Hobby | 無料、ストリーミング対応 |
| DB / ベクタ | Supabase Postgres + pgvector | 無料枠内で DB・ベクタ・認証を一元化 |
| ORM | Drizzle または Prisma | シードスクリプトの再実行可能性 |
| 認証 | Supabase Auth | 4章参照 |
| LLM | Claude Haiku 4.5（AI SDK 経由。必要に応じ Sonnet へ切替可能に抽象化） | コスト最小・ストリーミング / tool calling 対応 |
| 埋め込み | OpenAI text-embedding-3-small | 低コスト・日本語対応・1536次元で pgvector と整合 |
| データ | さけのわAPI インポート + 手作業シード | 1章参照。帰属表示必須 |
| 購入リンク | Amazon 検索リンク（将来: 楽天API / PA-API） | 2章参照 |

## 7. リスク一覧と PoC 要否

| # | リスク | 影響 | 対策 | PoC |
|---|---|---|---|---|
| R1 | さけのわAPIの規約変更・提供終了 | データ更新不能 | インポート方式でスナップショット保持。API直参照しない | 不要 |
| R2 | 説明文の著作権（他サイトからの転載不可） | 法的リスク | 説明文は必ず自作。Wikipedia 等は参考のみ | 不要 |
| R3 | RAG の検索精度（日本語・短文） | 提案品質低下 | ハイブリッド検索（タグSQL＋ベクタ）。PoCで検証 | 要（半日〜1日） |
| R4 | LLM の銘柄捏造 | 受け入れ条件違反 | structured output で銘柄IDを返却しサーバ側で存在検証 | R3 と同時に検証 |
| R5 | LLM/埋め込みの従量課金 | コスト超過 | Haiku 採用、レート制限、会話長上限、月次予算アラート | 不要 |
| R6 | Supabase 無料枠の7日停止 | 可用性低下 | 定期 ping（cron）または本運用時に Pro 化 | 不要 |
| R7 | PA-API が使えない | 価格自動取得不可 | 検索リンク＋手動価格帯で開始（要件上ベストエフォートと整理済み） | 不要 |
| R8 | 銘柄名の表記ゆれ検索 | 検索取りこぼし | 読み仮名列の整備（段階的） | 不要 |

## 8. 出典一覧

- さけのわデータプロジェクト（公式）: https://muro.sakenowa.com/sakenowa-data/
- さけのわデータ公開プレスリリース: https://prtimes.jp/main/html/rd/p/000000003.000060490.html
- Amazon PA-API 利用要件（アソシエイト・セントラル）: https://affiliate.amazon.co.jp/help/node/topic/GVJ2BJP35457CLML
- Amazon PA-API 利用ポリシー変更: https://affiliate.amazon.co.jp/help/node/topic/GW65C7J2CSK7CA6C
- 楽天ウェブサービス 商品検索API: https://webservice.rakuten.co.jp/documentation/ichiba-product-search
- Supabase pgvector: https://supabase.com/docs/guides/database/extensions/pgvector
- Supabase 無料枠制限の解説: https://www.itpathsolutions.com/supabase-free-tier-limits
- Claude API 料金（公式）: https://platform.claude.com/docs/en/about-claude/pricing
- OpenAI text-embedding-3-small（公式）: https://developers.openai.com/api/docs/models/text-embedding-3-small
- Vercel AI SDK: https://ai-sdk.dev/docs/introduction
- AI SDK RAG テンプレート: https://vercel.com/templates/next.js/ai-sdk-rag
- 認証比較（2026）: https://qiita.com/DevMasatoman/items/7bcabe0325dfc3f8cc4d 、https://makerkit.dev/blog/tutorials/better-auth-vs-clerk
- スクレイピングの法的解説（弁護士監修）: https://pig-data.jp/blog_news/blog/scraping-crawling/scrapinglaw/ 、https://it-bengosi.com/blog/scraping/
- 国税庁 酒類関連公表資料: https://www.nta.go.jp/taxes/sake/menkyo/shinki/seizo/02.htm
