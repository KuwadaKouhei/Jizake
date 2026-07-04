/**
 * RAG 精度 PoC の評価セット（質問 10 パターン × 期待銘柄。TASKS T13①）。
 *
 * FEASIBILITY R3/R4 の「銘柄 50 件 × 質問 10 パターン」に対応する評価セット。
 * 期待銘柄は seed-data/sakes.ts の実在銘柄名で表現し、実行時に DB の実 ID へ解決する
 * （scripts/rag-poc.ts が名前 → id を引く）。期待銘柄名は seed-data と厳密一致させること。
 *
 * 各質問は「ユーザーがチャットで言いそうな自然文（freeText）＋ヒアリングで確定しそうな
 * 条件（tagNames/prefectureCode/priceRange）」と、「その意図に対して上位に来てほしい銘柄」を
 * 持つ。retriever の recall@k / MRR を測る基準になる（絶対値の確定は実埋め込み投入後。§記録）。
 *
 * 配置: 使い捨ての PoC 資産のため scripts/lib 配下（本番バンドル対象外。DIRECTORY_STRUCTURE §3）。
 */

import type { RetrieveQuery } from "@/lib/rag/retriever";

/** 評価 1 件（質問＋期待銘柄名）。 */
export type EvalCase = {
  /** 人が読む用のラベル（意図の要約）。 */
  label: string;
  /** retriever に渡す検索クエリ（freeText＋条件）。 */
  query: RetrieveQuery;
  /**
   * この意図に対して上位に来てほしい銘柄名（seed-data/sakes.ts の name と厳密一致）。
   * recall@k / MRR はこの集合に対して計算する。
   */
  expectedSakeNames: string[];
};

/**
 * 評価セット（10 パターン）。味わい・産地・種別・価格帯・自然文の各軸をカバーする。
 * freeText は説明文に出やすい語彙で書く（埋め込み検索の意図一致を測るため）。
 */
export const EVAL_CASES: EvalCase[] = [
  {
    label: "華やかな吟醸香の純米大吟醸を冷やして飲みたい",
    query: {
      freeText: "華やかな吟醸香でフルーティー、冷やして楽しむ純米大吟醸",
      tagNames: ["純米大吟醸"],
    },
    expectedSakeNames: [
      "獺祭 純米大吟醸 磨き二割三分",
      "獺祭 純米大吟醸 45",
      "久保田 萬寿 純米大吟醸",
      "梵 ゴールド 純米大吟醸",
    ],
  },
  {
    label: "新潟の淡麗辛口をすっきり食中酒で",
    query: {
      freeText: "新潟の淡麗辛口ですっきり、料理に合わせる食中酒",
      prefectureCode: "15",
    },
    expectedSakeNames: [
      "八海山 清酒",
      "久保田 千寿 吟醸",
      "越乃寒梅 白ラベル",
      "〆張鶴 純",
    ],
  },
  {
    label: "とにかく辛口・キレのある酒",
    query: {
      freeText: "辛口でキレがあり後味がすっきりした酒",
    },
    expectedSakeNames: [
      "山本 純米吟醸 ど辛",
      "王祿 超辛口 純米",
      "三井の寿 純米吟醸 大辛口",
      "澤乃井 純米大辛口",
      "真澄 純米吟醸 辛口生一本",
    ],
  },
  {
    label: "山廃・生酛の濃醇で燗が映える酒",
    query: {
      freeText: "山廃仕込みで濃醇、燗にすると旨みが増す骨太な酒",
    },
    expectedSakeNames: [
      "天狗舞 山廃仕込純米酒",
      "玉乃光 純米吟醸 伝承山廃",
      "飛良泉 山廃純米酒",
      "悦凱陣 山廃純米",
    ],
  },
  {
    label: "山口の獺祭が飲みたい",
    query: {
      freeText: "山田錦を磨いた華やかな純米大吟醸",
      prefectureCode: "35",
    },
    expectedSakeNames: ["獺祭 純米大吟醸 磨き二割三分", "獺祭 純米大吟醸 45"],
  },
  {
    label: "予算控えめ（1500円以下）で日常の晩酌に",
    query: {
      freeText: "日常の晩酌に気軽に飲めるコスパのよい定番酒",
      priceRange: "under_1500",
    },
    expectedSakeNames: [
      "八海山 清酒",
      "剣菱 上撰",
      "月桂冠 上撰",
      "白鶴 特別純米酒 山田錦",
    ],
  },
  {
    label: "フルーティーで女性にも飲みやすい甘口寄り",
    query: {
      freeText:
        "フルーティーで香り高く、日本酒初心者でも飲みやすい甘口寄りの酒",
    },
    expectedSakeNames: [
      "作 純米吟醸 恵乃智",
      "鳳凰美田 純米吟醸",
      "紀土 純米吟醸",
      "醸し人九平次 純米大吟醸 山田錦",
    ],
  },
  {
    label: "東北の入手困難な人気銘柄",
    query: {
      freeText: "東北の蔵の希少で人気の高い、旨みのある純米酒",
    },
    expectedSakeNames: [
      "十四代 本丸 秘伝玉返し",
      "飛露喜 特別純米",
      "新政 No.6 R-type",
      "田酒 特別純米酒",
    ],
  },
  {
    label: "食中酒に向く純米吟醸をおすすめして",
    query: {
      freeText: "料理に寄り添う、香り穏やかでバランスのよい純米吟醸",
      tagNames: ["純米吟醸"],
    },
    expectedSakeNames: [
      "八海山 純米吟醸",
      "浦霞 禅 純米吟醸",
      "磯自慢 純米吟醸",
      "松の司 純米吟醸 竜王山田錦",
    ],
  },
  {
    label: "贈答用に高級な純米大吟醸",
    query: {
      freeText: "贈り物に選ばれる上品で高級感のある純米大吟醸",
      priceRange: "over_3000",
    },
    expectedSakeNames: [
      "久保田 萬寿 純米大吟醸",
      "獺祭 純米大吟醸 磨き二割三分",
      "満寿泉 純米大吟醸",
      "くどき上手 純米大吟醸",
    ],
  },
];
