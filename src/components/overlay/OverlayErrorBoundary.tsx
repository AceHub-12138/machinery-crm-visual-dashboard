"use client";

import { Component, Fragment, type ReactNode } from "react";

/**
 * 覆盖层兜底边界(2026-09-28 安全审核项;2026-09-30 审核后支持自动恢复)。
 *
 * 覆盖层任何渲染错误(理论上不应发生:wire 事件已做 fail-closed schema
 * 校验;这里是最后一道防线)只允许影响覆盖层自身——大屏工业基线必须继续
 * 轮播。捕获即静默卸载覆盖层,观众只会看到基线照常播放;30 秒后自动重新
 * 挂载(最多 3 次),给瞬时故障自愈机会,连续失败则保持基线。
 */
export class OverlayErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; generation: number }
> {
  override state = { failed: false, generation: 0 };
  private retries = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): Partial<{ failed: boolean }> {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    console.error("[overlay] degraded to baseline after render error:", error.message);
    if (this.retries >= 3) return; // 连续失败 3 次后保持基线,避免崩溃循环
    this.retries += 1;
    this.timer = setTimeout(() => {
      this.setState((s) => ({ failed: false, generation: s.generation + 1 }));
    }, 30_000);
  }

  override componentWillUnmount(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  override render(): ReactNode {
    if (this.state.failed) return null;
    return <Fragment key={this.state.generation}>{this.props.children}</Fragment>;
  }
}
