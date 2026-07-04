/**
 * AI Gateway 経由のモデル ID 定数（TECH_STACK §5・DESIGN §2.6）。
 *
 * モデルの差し替えはこのファイルの定数変更だけで行う（DIRECTORY_STRUCTURE §5.1）。
 * ID は AI Gateway の `provider/model` 形式（例: "openai/text-embedding-3-small"）。
 * Gateway 経由にすることでプロバイダ SDK への直接依存を排除し、
 * ベンダー型をドメイン層へ漏らさない（TECH_STACK §5・原則3）。
 */

/**
 * 埋め込みモデル。text-embedding-3-small は 1536 次元・日本語対応・低コスト
 * （FEASIBILITY R3・§3.1）。`sake_embeddings.model` 列にこの値を記録し、
 * モデル差し替え時の再埋め込み対象を判定する（DATABASE.md §2.10）。
 */
export const EMBEDDING_MODEL_ID = "openai/text-embedding-3-small";

/**
 * text-embedding-3-small の埋め込み次元。`sake_embeddings.embedding` の
 * vector(1536) と一致させる（DATABASE.md §2.10）。生成結果が想定次元と違えば
 * 格納前に検出するためのガードにも使う。
 */
export const EMBEDDING_DIMENSIONS = 1536;
