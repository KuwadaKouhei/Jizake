/**
 * LLM・埋め込みのモデル ID 定数（TECH_STACK §5・DESIGN §2.6）。
 *
 * モデルの差し替えはこのファイルの定数変更だけで行う（DIRECTORY_STRUCTURE §5.1）。
 * ID の形式は呼び出し側のプロバイダで異なる:
 * - 埋め込み: AI Gateway 経由のため `provider/model` 形式（例: "openai/text-embedding-3-small"）。
 * - チャット LLM: Claude API 直接接続（@ai-sdk/anthropic）のため Anthropic のモデル ID そのまま
 *   （例: "claude-haiku-4-5"）。
 *
 * いずれも AI SDK のプロバイダ抽象（`streamText`/`embed`）越しに呼ぶため、ドメイン層に
 * ベンダー型は漏れない。チャット LLM を Gateway 経由から Claude API 直接接続へ変更した
 * 逸脱と理由は TECH_STACK §5 に記録（原則3）。
 */

/**
 * 埋め込みモデル。text-embedding-3-small は 1536 次元・日本語対応・低コスト
 * （FEASIBILITY R3・§3.1）。`sake_embeddings.model` 列にこの値を記録し、
 * モデル差し替え時の再埋め込み対象を判定する（DATABASE.md §2.10）。
 * 埋め込みは Anthropic に該当モデルがないため AI Gateway（OpenAI）経由のまま。
 */
export const EMBEDDING_MODEL_ID = "openai/text-embedding-3-small";

/**
 * text-embedding-3-small の埋め込み次元。`sake_embeddings.embedding` の
 * vector(1536) と一致させる（DATABASE.md §2.10）。生成結果が想定次元と違えば
 * 格納前に検出するためのガードにも使う。
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * RAG チャットの generator（会話・ツール呼び出し）に使う LLM（TECH_STACK §5・DESIGN §2.6）。
 *
 * Claude Haiku 4.5 を Claude API 直接接続（@ai-sdk/anthropic）で呼ぶ。値は Anthropic の
 * モデル ID（エイリアス。最新スナップショット `claude-haiku-4-5-20251001` を指す）。
 * モデルの差し替えはこの定数変更だけで行う（DIRECTORY_STRUCTURE §5.1）。
 *
 * 認証は環境変数 ANTHROPIC_API_KEY（route.ts で anthropic プロバイダが実行時に参照）。
 */
export const CHAT_MODEL_ID = "claude-haiku-4-5";
