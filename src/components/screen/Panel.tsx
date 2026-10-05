import type { ReactNode } from "react";

/** Panel表面：左侧品牌强调条 + 统一的头/体结构。 */
export function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}

/**
 * 面板头：眉题 + 中文标题 + 右侧指标。
 * 固定 56px 高，保证四块面板标题基线对齐。
 */
export function PanelHead({
  eyebrow,
  title,
  extra,
}: {
  eyebrow: string;
  title: string;
  extra?: ReactNode;
}) {
  return (
    <header className="panel-head shrink-0">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="h-6 w-[3px] shrink-0 rounded-full bg-[var(--brand-orange)]"
        />
        <div className="min-w-0">
          <p className="panel-eyebrow">{eyebrow}</p>
          <h2 className="panel-title mt-1 truncate">{title}</h2>
        </div>
      </div>
      {extra ? <div className="shrink-0 text-right">{extra}</div> : null}
    </header>
  );
}

/** 面板内的次级信息块 —— 全屏统一的「一格里一个数」。 */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  className = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "brand" | "collect" | "partial" | "overdue" | "live";
  className?: string;
}) {
  const toneClass = {
    neutral: "text-[var(--ink)]",
    brand: "text-[var(--brand-orange-hot)]",
    collect: "text-[var(--c-collect)]",
    partial: "text-[var(--c-pending)]",
    overdue: "text-[var(--c-overdue)]",
    live: "text-[var(--c-live)]",
  }[tone];

  return (
    <div
      className={`rounded-[var(--radius)] border border-[var(--hairline)] bg-[var(--panel-raise)] px-3 py-2.5 ${className}`}
    >
      <p className="text-micro leading-none text-[var(--ink-3)]">{label}</p>
      <p className={`num mt-2 text-metric leading-none ${toneClass}`}>{value}</p>
      {hint ? (
        <p className="mt-1.5 text-micro leading-none text-[var(--ink-3)]">{hint}</p>
      ) : null}
    </div>
  );
}
