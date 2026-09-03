import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal-shell">
      <Link className="legal-back" href="/">
        ← 返回 RentProof
      </Link>
      <header className="legal-header">
        <p className="eyebrow">DRAFT・尚未生效</p>
        <h1>{title}</h1>
        <p>
          本頁是產品設計草案，不代表已完成台灣法務或隱私審閱。營運者、聯絡方式與正式生效日仍待確認。
        </p>
      </header>
      <article className="legal-content">{children}</article>
    </main>
  );
}
