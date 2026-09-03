import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "租得明白 RentProof",
  description: "在付訂金前，把租屋承諾連回可定位的證據。",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
