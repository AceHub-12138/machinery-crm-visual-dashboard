import type { Metadata } from "next";
import { Noto_Sans_SC, Rajdhani } from "next/font/google";
import "./globals.css";

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  variable: "--font-heiti",
});

const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-hud",
});

export const metadata: Metadata = {
  title: "大川经营指挥舱",
  description: "DachuanPro CRM 可视化大屏一期：KPI、销售目标、发货地图",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${notoSansSC.variable} ${rajdhani.variable}`}>{children}</body>
    </html>
  );
}
