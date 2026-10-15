import type { Metadata } from "next";
import type { CSSProperties } from "react";
import "./globals.css";

// 沿用系统字体兜底；构建与运行均不向 Google 请求字体。
const systemFonts = { "--font-heiti": '"PingFang SC", "Microsoft YaHei"', "--font-hud": '"Arial Narrow", "Segoe UI", sans-serif' } as CSSProperties;

export const metadata: Metadata = {
  title: "大川经营指挥舱",
  description: "DachuanPro CRM 可视化大屏一期：KPI、销售目标、发货地图",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" style={{ background: "#07080a", colorScheme: "dark" }}>
      <body style={{ ...systemFonts, background: "#07080a" }}>{children}</body>
    </html>
  );
}
