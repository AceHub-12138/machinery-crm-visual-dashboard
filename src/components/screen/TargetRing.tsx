"use client";

import { Panel, PanelHead } from "@/components/screen/Panel";
import { formatMoney } from "@/lib/format";
import type { CrmDashboardStats } from "@/lib/types";
import type { PublicScreenPayload } from "@/lib/public-screen-payload";

/**
 * 累计回款率环。
 *
 * 简化后的回款环只承担一个任务：让管理者在远处看清总体回款率。
 * 金额与目标移到环外，避免同一块图形里同时塞进三组口径。
 */
function RateDial({ rate }: { rate: number }) {
  const radius = 74;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, rate));

  return (
    <svg viewBox="0 0 180 180" className="size-full" role="img" aria-label={`累计回款率 ${rate.toFixed(1)}%`}>
      <defs>
        <linearGradient id="dial-arc" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#b95a12" />
          <stop offset="50%" stopColor="var(--c-contract)" />
          <stop offset="100%" stopColor="var(--brand-orange-hot)" />
        </linearGradient>
      </defs>

      {/* 稀疏刻度只保留方向感，不与主读数竞争。 */}
      {Array.from({ length: 24 }, (_, index) => {
        const angle = (index / 24) * Math.PI * 2 - Math.PI / 2;
        const inner = 86;
        const outer = index % 3 === 0 ? 80 : 83;
        const point = (radiusValue: number, axis: "x" | "y") =>
          Number(
            (
              90 +
              (axis === "x" ? Math.cos(angle) : Math.sin(angle)) * radiusValue
            ).toFixed(4),
          );
        return (
          <line
            key={index}
            x1={point(inner, "x")}
            y1={point(inner, "y")}
            x2={point(outer, "x")}
            y2={point(outer, "y")}
            stroke="rgba(150,168,196,0.2)"
            strokeWidth={index % 3 === 0 ? 1.6 : 1}
          />
        );
      })}

      <circle cx="90" cy="90" r={radius} fill="none" stroke="rgba(150,168,196,0.14)" strokeWidth="13" />
      <g transform="rotate(-90 90 90)">
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="url(#dial-arc)"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          strokeLinecap="round"
          strokeWidth="13"
        />
      </g>
      <circle cx="90" cy="90" r={radius - 10} fill="none" stroke="rgba(150,168,196,0.1)" strokeWidth="1" />
    </svg>
  );
}

/**
 * 直线进度条。
 *
 * 用 div 而不是 SVG：横条不需要路径能力，div 的高度/圆角直接由 CSS
 * 控制，比 SVG（要处理 preserveAspectRatio="none" 带来的纵向拉伸）
 * 更稳，也更容易和右侧数字对齐。
 */
export function TargetRing({
  targets,
  periodLabel,
  stats,
}: {
  targets: PublicScreenPayload["salesTargets"];
  periodLabel: string;
  stats: CrmDashboardStats;
}) {
  const company = targets.targets.find((item) => item.salesUserId === null);

  // 回款率口径与平台一致：已回 / (已回 + 未回)。
  // 优先用销售目标里的金额，没有目标时退回到 dashboard 的累计口径。
  const receivedFromTarget = Number(company?.actualAmount ?? 0);
  const targetAmount = Number(company?.amount ?? 0);
  const received = receivedFromTarget > 0 ? receivedFromTarget : stats.totalPaidAmount;
  const outstanding = stats.totalUnpaidAmount;
  const contracted = stats.totalContractAmount || received + outstanding;
  const collectRate = contracted > 0 ? received / contracted : 0;

  return (
    <Panel className="flex h-full min-h-0 flex-col">
      <PanelHead
        eyebrow="Collection"
        title="合同与回款"
        extra={<span className="text-micro text-[var(--ink-3)]">{periodLabel}</span>}
      />

      <div className="collection-layout min-h-0 flex-1 overflow-hidden p-[var(--panel-pad)]">
        <div className="collection-overview grid grid-cols-[198px_1fr] items-center gap-6">
          <div className="ring-box relative">
            <RateDial rate={collectRate * 100} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-micro leading-none tracking-[0.08em] text-[var(--ink-3)]">
                总体回款率
              </p>
              <p className="num mt-2.5 flex items-baseline text-hero leading-none tracking-[-0.02em] text-[var(--ink)]">
                {(collectRate * 100).toFixed(1)}
                <span className="ml-1 text-label leading-none text-[var(--ink-3)]">%</span>
              </p>
            </div>
          </div>

          <div className="collection-numbers min-w-0">
            <div className="collection-number collection-number-received">
              <p className="text-micro leading-none text-[var(--ink-3)]">已收款</p>
              <p className="num money mt-2 text-metric leading-none text-[var(--c-received)]">
                {formatMoney(received)}
              </p>
            </div>
            <div className="collection-number collection-number-pending">
              <p className="text-micro leading-none text-[var(--ink-3)]">未收款</p>
              <p className="num money mt-2 text-metric leading-none text-[var(--c-pending)]">
                {formatMoney(outstanding)}
              </p>
            </div>
          </div>
        </div>

        <div className="collection-summary mt-4">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-micro leading-none text-[var(--ink-3)]">累计合同</p>
              <p className="num money mt-2 text-label leading-none text-[var(--ink)]">
                {formatMoney(contracted)}
              </p>
            </div>
            {targetAmount > 0 ? (
              <p className="num text-right text-micro leading-tight text-[var(--ink-3)]">
                本月目标 {formatMoney(targetAmount)}
                <br />
                <span className="text-[var(--brand-orange-hot)]">
                  已完成 {formatMoney(Number(company?.actualAmount ?? 0))}
                </span>
              </p>
            ) : null}
          </div>
          <div className="collection-track mt-3 flex overflow-hidden">
            <span className="bg-[var(--c-received)]" style={{ width: `${collectRate * 100}%` }} />
            <span className="bg-[var(--c-pending)]" style={{ width: `${(1 - collectRate) * 100}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-micro leading-none text-[var(--ink-3)]">
            <span>已回 {Math.round(collectRate * 100)}%</span>
            <span>待回 {Math.round((1 - collectRate) * 100)}%</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
