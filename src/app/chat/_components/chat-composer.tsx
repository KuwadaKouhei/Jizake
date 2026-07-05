"use client";

import { Button } from "@/components/ui/button";

/**
 * チャット入力フォーム（TASKS T14 ④）。
 *
 * Enter で送信（Shift+Enter で改行）。送信中（disabled）は入力・送信を止める。
 * 制御は親（ChatContainer）が useChat とともに持ち、この部品はプレゼンテーションに徹する。
 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="chat-input" className="sr-only">
        メッセージを入力
      </label>
      <textarea
        id="chat-input"
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="例: 辛口で食事に合う日本酒を探しています"
        className="min-h-[2.5rem] flex-1 resize-y rounded-2xl border-[1.5px] border-input bg-background px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        className="self-end rounded-full px-5"
        size="lg"
      >
        送信
      </Button>
    </form>
  );
}
