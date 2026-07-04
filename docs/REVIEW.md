# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T15-chat-guards`（T15 チャット運用ガード）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T14: PR #14）

## 判定: ✅ マージ可

Blocker 0 件。Should をすべて本ブランチ内で対応済み（対応コミット: `3f9a281`, `05ddcc7`, `9ee1112`）。修正後、全検証グリーン（423 テスト・lint 0 警告・typecheck・format・build）。

## 検証結果

- test 47 ファイル / 423 件全パス（T15 で +39）
- lint / typecheck / format:check / build すべてグリーン
- セキュリティは「user_id 二段防御・捏造 ID 非保存・オープンリダイレクト対策は構造的に安全、Blocker なし」、思想準拠は「決定 D4/D5 に高準拠」と評価

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | コード/性能 | proposeSake 実行時点で保存するため、複数回呼び出しで「1 会話 1 セッション」(D4)が破れ、レート制限カウントも二重増加。保存 I/O がストリーム経路に乗る | 保存を `streamText` の `onFinish` に一本化。proposeSake は検証済み提案をリクエストスコープに蓄積するのみ。`after()` でレスポンス後にバックグラウンド保存。proposeSake 複数回でもセッションは 1 行 |
| S-2 | コード | 保存される assistant 本文が in-flight 応答を含まず「（提案）」固定になり提案理由が残らない | onFinish の確定応答本文（`event.text`）を assistant 本文として保存。末尾 user の in-flight でも補完 |
| S-3 | 思想 | 検索条件表現（SearchCriteria/toSearchQueryString/isEmptyCriteria/sanitizeCriteria）が検索・履歴・チャットの 3 機能で使われ Rule of Three の昇格トリガに到達（DIR-11 の予告） | `src/lib/search-query/` へ昇格（git mv で履歴保持）。3 機能の import を更新、DIRECTORY_STRUCTURE DIR-11・§2・DESIGN §2.2/§5.3 を更新 |
| S-4 | セキュリティ | フォールバックの都道府県短縮形が部分一致で誤検出し得る | 「フルネーム完全一致優先→無ければ短縮形」の 2 パスに変更＋回帰テスト。/search 側で再検証される旨をコメント |
| S-5 | コード | `conversation-guard` の docstring が自己矛盾（同一式の対比） | 「`turns >= MAX` ではなく `turns > MAX`」に修正（ロジックは正しく変更なし） |

### Consider（対応済み・記録）

- 性能 S-1（匿名の Auth 往復回避）: Supabase auth cookie 名がプロジェクト依存で実キーなしでは確度検証不可、getCurrentUser は React.cache 済み。実キー投入後の TTFB 計測で判断する残作業として記録
- C-3（maxDuration=60 と Vercel Hobby 実行時間上限の整合・AbortError 経路のフォールバック実挙動）: デプロイ TODO・実キー投入後の残作業に記録
- 見送り（D5 準拠）: 匿名の IP/KV レート制限・ヒアリングのみ会話のカウント方式変更は乱用観測後

## 受け入れ条件の充足

- FR-08（安定運用）＋非機能（コスト・可用性）: 往復数上限（10）・maxOutputTokens（1024）・タイムアウト（30s）・maxDuration（60s）でコスト/実行時間を有界化、ログインユーザーの 20 会話/日レート制限、LLM 障害時のフォールバック検索導線、確定提案のセッション保存（検証済み ID のみ・匿名は保存しない・user_id 二段防御）をテストで担保 ✅
- 制約: 実 LLM 往復での onFinish 保存・タイムアウトフォールバックの実挙動・レート制限の実 DB カウントは実キー投入後の残作業。ロジックは PGlite＋モックで検証済み

## セキュリティ・設計の特記

- **ユーザーデータ分離**: `saveConfirmedProposal`/`isChatRateLimited` は user_id を引数でなく `getCurrentUser` から強制取得（履歴 T09 と同型の二段防御）、`proposed_sake_ids` は `validateProposedSakeIds` 通過済みの検証済み ID のみ、匿名は保存しない、RLS が二段目
- **フォールバック**: `toSearchQueryString` で内部 `/search` パスのみ生成、ユーザー自由文を q に載せない、既知語彙の完全一致のみ（オープンリダイレクトなし）
- **決定 D4/D5**: 1 会話 1 セッション・確定提案のみ保存・匿名の連打先回り対策はしない を遵守
- T14 の捏造防止フローは無改変で維持

## 次タスク（T16）への引き継ぎ

- E2E（Playwright）3 導線: 検索→一覧→詳細、ログイン、チャット 1 往復
- 実キー投入後: onFinish 保存の実往復疎通・タイムアウトフォールバック・レート制限の実 DB カウント・匿名 Auth 往復の TTFB 計測
