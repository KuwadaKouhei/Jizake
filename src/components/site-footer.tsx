// さけのわデータの帰属表示は利用条件のため全ページに常設する（DESIGN §2.7）
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground">
        <p>
          このサイトは
          <a
            href="https://sakenowa.com"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-4 hover:text-foreground"
          >
            さけのわデータ
          </a>
          を利用しています。
        </p>
      </div>
    </footer>
  );
}
