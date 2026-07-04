import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import {
  buildPersistableMessages,
  insertConfirmedSession,
} from "./persist-session";
import type { ChatUIMessage } from "./tools";

/**
 * 確定提案セッション保存（TASKS T15 ④・DESIGN 決定 D4）のテスト。
 *
 * - buildPersistableMessages: UIMessage→保存レコードの純関数（提案 ID を末尾 assistant に付与）。
 * - insertConfirmedSession: PGlite で本人の chat_sessions/chat_messages 保存を検証
 *   （user_id 強制・検証済み ID のみ・提案が無ければ保存しない）。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SAKE_1 = "d1111111-1111-4111-8111-111111111111";
const SAKE_2 = "d2222222-2222-4222-8222-222222222222";

function userMsg(text: string): ChatUIMessage {
  return {
    id: `u-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  } as ChatUIMessage;
}

function assistantMsg(text: string): ChatUIMessage {
  return {
    id: `a-${text}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as ChatUIMessage;
}

function assistantWithCard(text: string): ChatUIMessage {
  return {
    id: `a-card-${text}`,
    role: "assistant",
    parts: [
      { type: "text", text },
      { type: "data-proposedSakes", data: { sakes: [] } },
    ],
  } as unknown as ChatUIMessage;
}

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await migrate(orm, { migrationsFolder: "drizzle" });
  await db.exec(`INSERT INTO auth.users (id) VALUES ('${USER_A}');`);
});

beforeEach(async () => {
  await orm.delete(schema.chatMessages);
  await orm.delete(schema.chatSessions);
});

describe("buildPersistableMessages（純関数）", () => {
  it("user/assistant の text を連結し、提案 ID を末尾 assistant に付ける", () => {
    const records = buildPersistableMessages(
      [
        userMsg("辛口が好き"),
        assistantMsg("承知しました"),
        userMsg("山口県で"),
        assistantMsg("こちらはいかがでしょう"),
      ],
      [SAKE_1, SAKE_2],
    );
    expect(records.map((r) => r.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    // 提案 ID は末尾の assistant にのみ付く。
    expect(records[3].proposedSakeIds).toEqual([SAKE_1, SAKE_2]);
    expect(records[1].proposedSakeIds).toBeUndefined();
  });

  it("text の無いメッセージ（カードのみ）はスキップする（content 必須）", () => {
    const records = buildPersistableMessages(
      [userMsg("辛口"), assistantWithCard("おすすめです")],
      [SAKE_1],
    );
    // カード付き assistant も text があるので残り、提案 ID が付く。
    expect(records).toHaveLength(2);
    expect(records[1].proposedSakeIds).toEqual([SAKE_1]);
  });

  it("提案 ID があるのに assistant メッセージが無ければ合成 assistant を足す", () => {
    const records = buildPersistableMessages([userMsg("辛口")], [SAKE_1]);
    expect(records).toHaveLength(2);
    expect(records[1].role).toBe("assistant");
    expect(records[1].proposedSakeIds).toEqual([SAKE_1]);
  });

  it("提案 ID が空なら提案 ID は付かない", () => {
    const records = buildPersistableMessages(
      [userMsg("辛口"), assistantMsg("承知")],
      [],
    );
    expect(records.every((r) => r.proposedSakeIds === undefined)).toBe(true);
  });

  it("in-flight（末尾が user）でも finalAssistantText を確定 assistant 本文として補い提案理由を残す", () => {
    // ステートレスで、確定した assistant 応答はまだ入力 messages に無い（末尾は user）。
    const records = buildPersistableMessages(
      [userMsg("辛口が好き")],
      [SAKE_1],
      "こちらの獺祭がおすすめです。華やかな香りが特長です。",
    );
    expect(records.map((r) => r.role)).toEqual(["user", "assistant"]);
    // 合成固定文言「（提案）」ではなく、確定した応答本文が入る。
    expect(records[1].content).toBe(
      "こちらの獺祭がおすすめです。華やかな香りが特長です。",
    );
    expect(records[1].proposedSakeIds).toEqual([SAKE_1]);
  });

  it("提案 ID の重複を排除して末尾 assistant に付ける（proposeSake 複数回のマージ想定）", () => {
    const records = buildPersistableMessages(
      [userMsg("辛口")],
      [SAKE_1, SAKE_2, SAKE_1],
      "おすすめです",
    );
    const assistant = records[records.length - 1];
    expect(assistant.proposedSakeIds).toEqual([SAKE_1, SAKE_2]);
  });
});

describe("insertConfirmedSession（PGlite）", () => {
  it("会話と検証済み提案 ID を本人の user_id で保存する（確定応答本文が assistant に残る）", async () => {
    // in-flight を反映: 入力履歴の末尾は user、確定応答は finalAssistantText で渡す。
    await insertConfirmedSession(
      orm,
      USER_A,
      [userMsg("辛口が好き")],
      [SAKE_1, SAKE_2],
      "こちらの2本がおすすめです。",
    );

    const sessions = await orm
      .select()
      .from(schema.chatSessions)
      .where(eq(schema.chatSessions.userId, USER_A));
    expect(sessions).toHaveLength(1);

    const messages = await orm
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.sessionId, sessions[0].id));
    expect(messages).toHaveLength(2);

    const assistant = messages.find((m) => m.role === "assistant");
    // 合成固定文言でなく、確定した応答本文（提案理由）が保存される。
    expect(assistant?.content).toBe("こちらの2本がおすすめです。");
    expect(assistant?.proposedSakeIds).toEqual([SAKE_1, SAKE_2]);
    const user = messages.find((m) => m.role === "user");
    expect(user?.proposedSakeIds).toBeNull();
  });

  it("提案 ID が空なら保存しない（確定提案のみ保存。決定 D4）", async () => {
    await insertConfirmedSession(
      orm,
      USER_A,
      [userMsg("辛口"), assistantMsg("承知")],
      [],
    );
    const sessions = await orm.select().from(schema.chatSessions);
    expect(sessions).toHaveLength(0);
  });

  it("保存内容は指定した user_id で作られる（他人に書けない構造）", async () => {
    await insertConfirmedSession(orm, USER_A, [userMsg("辛口")], [SAKE_1]);
    const sessions = await orm.select().from(schema.chatSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe(USER_A);
  });

  it("1 回の保存で chat_sessions は 1 行（1 会話 1 セッション・重複 ID はマージ）", async () => {
    // proposeSake 複数回分の検証済み ID（重複含む）を 1 回の保存にまとめて渡す想定。
    await insertConfirmedSession(
      orm,
      USER_A,
      [userMsg("辛口")],
      [SAKE_1, SAKE_2, SAKE_1],
      "おすすめです",
    );
    const sessions = await orm.select().from(schema.chatSessions);
    expect(sessions).toHaveLength(1);

    const messages = await orm
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.sessionId, sessions[0].id));
    const assistant = messages.find((m) => m.role === "assistant");
    // 重複排除された ID が 1 つの assistant に付く。
    expect(assistant?.proposedSakeIds).toEqual([SAKE_1, SAKE_2]);
  });
});
