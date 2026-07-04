# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T14-chat`（T14 RAG チャットボット UI＋API）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T13: PR #13）

## 判定: ✅ マージ可

Blocker 0 件。Should をすべて本ブランチ内で対応済み（対応コミット: `a71b7c8`, `60386ba`, `4b4d66c`, `9a79491`）。修正後、全検証グリーン（384 テスト・lint 0 警告・typecheck・format・build〔Turbopack + webpack 型チェック〕）。

## 検証結果

- test 44 ファイル / 384 件全パス（strip-data-parts の +3 含む）
- lint / typecheck / format:check / build すべてグリーン
- **セキュリティ: 捏造防止・XSS・プロンプトインジェクションは「構造的に堅牢」**（LLM 出力を信頼境界外として扱い、サーバ側 DB 検証が真の担保）。性能・思想準拠も良好

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | セキュリティ | `role` に `system` を許容しクライアントから system 注入の下地 | `z.enum(["user","assistant"])` に限定 |
| S-2 | セキュリティ | `maxOutputTokens` 未設定で出力側コスト DoS が素通し | `MAX_OUTPUT_TOKENS=1024` を streamText に設定（DESIGN §6.3 の最低限ガード前倒し） |
| S-3 | セキュリティ | `parts` 配列に要素数上限がなく増幅 DoS の余地 | `.max(50)` を追加 |
| S-4 | コード | クライアントが echo する過去の `data-proposedSakes` パートが信頼境界外で LLM コンテキストに漏れ得る | `stripAssistantDataParts` 純関数で convertToModelMessages 前に明示除去。data 内容が LLM 材料に混ざらないことをテスト固定（Zod strip の暗黙挙動に依存しない） |
| S-5 | コード | サーバ onError と useChat error の文言が二重管理 | ユーザー向けエラー文言を UI（chat-container）に一本化、サーバ onError はログ＋エラーパートに徹する（責務をコメント明示） |
| S-6 | 性能 | `/chat` の First Load JS が +498KB（gzip 118KB、ai+@ai-sdk/react+zod）で他ルートの約5.6倍 | ChatContainer を `next/dynamic`（`ssr:false`）で遅延読み込み、LCP 要素（h1・説明文）は RSC の page.tsx に静的に残す。page エントリチャンク約61%減、SDK は表示後に非同期取得 |

### Consider（対応済み・記録）

- CODE/PERF C-2: 提案カードの `key` を先頭 sake.id で安定化 — 対応済み
- PHIL S-1: fabrication-guard（PoC 雛形）と本番 `proposeSakeInputSchema` の相互参照コメント＋RAG_POC §6 の TODO 消し込み（T14 で tools.test.ts に移設決着）— 対応済み
- SEC/CODE: 偽装 `data-*` パートが Zod strip＋`stripAssistantDataParts` で LLM/描画に到達しない旨をコメント明記 — 対応済み

## 実装上の判断（記録）

- **Route Handler の export 規約**: `route.ts` から純関数を export すると Next.js が不正なルートエントリと解釈し webpack ビルドで型エラー（Turbopack build は見逃す）になるため、`_lib/strip-data-parts.ts` に切り出し。webpack 型チェックでも通過を確認

## 受け入れ条件の充足

- FR-08（チャットで質問→回答→複数提案、提案は実在銘柄＋詳細リンク、捏造しない）: `/api/chat` の streamText＋searchSake/proposeSake、proposeSake の ID を `validateProposedSakeIds` で DB 検証してから検証済みカードのみ送信、useChat ストリーミング UI、提案は sake-card で /sake/[id] リンク付き表示。捏造防止の二段構えをテストで担保 ✅
- 制約: 実 LLM 往復・エラー表示の実挙動・モデル ID の正確性は実キー投入後の残作業。ロジックは AI アダプタのモックで検証済み

## 設計思想の達成

- AI SDK の import は `src/lib/ai`・`src/app/api/chat`・`chat/_components` の useChat のみ（DIRECTORY_STRUCTURE §5.2）。`src/lib/rag` は AI SDK 非依存を維持（retriever/generator 分離）
- 捏造防止の二段構え: searchSake が retriever の実在候補のみ LLM に返す（一段目）＋ proposeSake の ID を DB 存在検証（二段目）。tool result に LLM 自由文を混ぜず、UI は検証済みデータパートからのみ SakeCard 描画
- T14/T15 の境界（レート制限・詳細コスト上限・タイムアウト/フォールバック・chat_sessions 保存は T15）を実施メモに明記、先回りの抽象化なし

## 次タスクへの引き継ぎ（T15）

- 匿名レート制限・多数リクエスト連打対策・maxDuration・タイムアウト→検索誘導フォールバック・chat_sessions/chat_messages 保存（検証済み ID のみ）
- 実キー投入後: 実 LLM 往復疎通・S-5 のエラー表示実挙動・`CHAT_MODEL_ID` の正確性確定
