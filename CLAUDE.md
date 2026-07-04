# CLAUDE.md — Jizake

Jizake は日本酒レコメンド Web アプリ。日本酒 DB を軸に、検索・都道府県別地酒・詳細ページ・
履歴ベース推薦・RAG チャットボットを提供する（Next.js 16 / Supabase / Drizzle / AI SDK 6 / shadcn/ui）。

## ドキュメント体系

設計フェーズは完了済み。仕様・設計の正はすべて `docs/` 配下にある。本ファイルは索引であり、内容は転載しない。

| ドキュメント | 内容 | いつ参照するか |
|---|---|---|
| `docs/REQUIREMENTS.md` | 要件定義（FR-01〜FR-08＋受け入れ条件） | 機能の仕様・完了判定を確認するとき |
| `docs/FEASIBILITY.md` | 実現可能性調査（さけのわAPI・楽天API・RAG構成の裏取り） | 外部依存の制約・リスク・代替案を確認するとき |
| `docs/philosophy/PLAN_PHILOSOPHY.md` | 設計思想（シンプルさ最優先・データ中心・差し替え可能な知能） | 設計判断・トレードオフで迷ったとき |
| `docs/philosophy/CODING_PHILOSOPHY.md` | 実装思想（FW規約優先・境界で型厳格・コロケーション） | コードの書き方・命名・抽象化の判断時 |
| `docs/philosophy/TEST_PHILOSOPHY.md` | テスト思想（比率目安・LLM必須モック・受け入れ条件対応） | テストを書くとき・CI設定時 |
| `docs/GIT_CONVENTIONS.md` | Git運用（`feature/<ID>-<slug>`・Conventional Commits・禁止事項） | ブランチ作成・コミット・PR 作成時 |
| `docs/TECH_STACK.md` | 技術選定（採用スタック一覧と選定理由・バージョン方針） | ライブラリ追加・バージョン判断時 |
| `docs/DESIGN.md` | アーキテクチャ設計（7コンポーネント・決定記録 D1〜D8） | コンポーネント間の責務・データフローを確認するとき |
| `docs/DATABASE.md` | DB設計（10テーブル・ER図・命名規約・RLS方針） | スキーマ・マイグレーション・クエリを書くとき |
| `docs/DIRECTORY_STRUCTURE.md` | ディレクトリ構造（配置ルール・決定記録 DIR-1〜9） | ファイルをどこに置くか迷ったとき |
| `docs/TASKS.md` | タスク分解（T01〜T16・依存関係・状態管理） | 実装フェーズの駆動表。タスク開始・完了時に必ず更新 |
| `docs/SAKENOWA_API.md` | さけのわAPI調査メモ（実測レスポンス構造・利用規約） | T03 データインポート実装時のリファレンス |

## 実装の原則

- **実装は必ずドキュメントに沿う。** 仕様は REQUIREMENTS、構造は DESIGN / DATABASE /
  DIRECTORY_STRUCTURE、判断基準は philosophy/ が正。
- **コードとドキュメントが食い違ったら、実装を止めてユーザーに確認する。** 勝手にどちらかへ寄せない。
- 思想から逸脱する判断をする場合は、該当ドキュメントに「逸脱と理由」を残す（PLAN_PHILOSOPHY の逸脱ルール）。

## 変更時のルール

- **コードを変更したら、関連ドキュメントも同じ PR で更新する**（GIT_CONVENTIONS のドキュメント運用）。
- **仕様変更は、先にドキュメントを直してから実装する。** ドキュメント更新 → 実装の順を崩さない。
- タスクの着手・完了時は `docs/TASKS.md` の状態（未着手/進行中/レビュー中/完了）を更新する。

## 基本ルール

- **Git**: `docs/GIT_CONVENTIONS.md` に従う。1タスク=1ブランチ=1PR、Conventional Commits、
  `.env*`・シークレットのコミット禁止、`main` は常に起動可能・テストグリーン。
- **テスト**: `docs/philosophy/TEST_PHILOSOPHY.md` に従う。LLM API は必ずモック、
  受け入れ条件ごとにテスト最低1つ、バグ修正は再現テストを先に書く。

## 言語ルール

- ドキュメント・コミットメッセージ・UI 文言: **日本語**
- コード・識別子（変数名・関数名・テーブル名等）: **英語**

## 実装フェーズの進め方

1. `docs/TASKS.md` を駆動表とし、依存関係の順に T01〜T16 を進める。
2. 1タスク = 1ブランチ（`feature/<ID>-<slug>`）= 1PR。画面〜DB を貫く縦スライスで実装する。
3. 各タスクの受け入れ条件（REQUIREMENTS 対応）を満たし、lint / typecheck / テストが通ってからマージする。
