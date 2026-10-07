"use client";

import { memo, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  foldProgress,
  LAUNCH,
  launchPhase,
  typedChars,
  type LaunchConfig,
  type OverlayGeometry,
} from "@/lib/voice/params";
import type { AnswerCardData } from "@/lib/voice/session-machine";
import { renderCardTemplate } from "./cards/registry";

/**
 * 答案卡发射编排(plan §7,总时长约 700ms,时序参数在 LaunchConfig)。
 *
 * ① 核心亮度脉冲(0–120ms)→ ② 粒子束(100–450ms,画布层负责)→
 * ③ 锚点先成一条水平细线,纵向展开 + SVG 边框描边(400–650ms)→
 * ④ 打字机逐字出正文 → ⑤ 高亮同步(8a 以打字进度近似句级边界)。
 *
 * 全部进度由本组件自持的一个 rAF 逐帧写入 DOM(style/textContent),
 * 不经 React 状态——60fps 下零重渲染;编排推进完毕即停帧。
 */

/* memo:编排推进全走 ref 直写 DOM,重渲染只会浪费(几何/配置不变时不进) */
export const AnswerCard = memo(function AnswerCard({
  card,
  launchAt,
  geometry,
  config = LAUNCH,
  foldAt = null,
  sentenceRef,
}: {
  card: AnswerCardData;
  /** 发射起点(performance.now 域,由 OverlayStage 在派发 ANSWER 时写下) */
  launchAt: number;
  geometry: OverlayGeometry;
  config?: LaunchConfig;
  /** 折叠吸回起点(closing 进入时刻,§5);null = 正常展示 */
  foldAt?: number | null;
  sentenceRef?: RefObject<{ start: number; end: number } | null>;
}) {
  const lineRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<SVGRectElement | null>(null);
  const cornerRef = useRef<HTMLDivElement | null>(null);
  const spokenRef = useRef<HTMLSpanElement | null>(null);
  const barFillRef = useRef<HTMLSpanElement | null>(null);

  /* 进度条填充只写一次;宽度目标从卡片数据算出 */
  const barWidth = `${clamp01(card.kind === "target-progress" ? card.completionRate / 100 : 0) * 100}%`;

  /* SVG 边框按卡体实测尺寸建立描边路径(SVG 属性不认 calc,JS 写像素值) */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const metrics = useRef({ w: 0, h: 0, perimeter: 0 });
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const svg = svgRef.current;
    const rect = frameRef.current;
    if (!body || !svg || !rect) return;
    const w = body.offsetWidth;
    const h = body.offsetHeight;
    metrics.current = { w, h, perimeter: 2 * (w + h) };
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "none");
    rect.setAttribute("width", String(w - 1.5));
    rect.setAttribute("height", String(h - 1.5));
  }, []);

  /* 编排主循环:rAF 写 DOM,打字完毕即停。
     bar(进度条)只存在于 target-progress 模板——其余模板无进度条,
     缺 ref 不阻断编排(8b 起 5 种模板共用本管线)。 */
  useEffect(() => {
    const body = bodyRef.current;
    const line = lineRef.current;
    const frameRect = frameRef.current;
    const corners = cornerRef.current;
    const spoken = spokenRef.current;
    const bar = barFillRef.current;
    if (!body || !line || !frameRect || !corners || !spoken) return;

    let raf = 0;
    let disposed = false;
    let lastTyped = -1;
    let lastHighlight = "";
    let barSet = false;

    const paint = (now: number) => {
      if (disposed) return;

      /* §5 退场第一步:折叠吸回核心(200ms)——发射编排的逆过程;
         完成后停帧,覆盖层淡出接管余下的退场 */
      if (foldAt != null) {
        const fp = foldProgress(now - foldAt);
        const inv = 1 - easeInOutCubic(fp);
        line.style.transform = `scaleX(${inv})`;
        body.style.transform = `scaleY(${0.012 + 0.988 * inv})`;
        body.style.opacity = String(fp < 0.7 ? 1 : Math.max(0, 1 - (fp - 0.7) / 0.3));
        const per = metrics.current.perimeter;
        if (per > 0) frameRect.style.strokeDashoffset = String(per * (1 - inv));
        corners.classList.remove("is-on");
        if (fp >= 1) return;
        raf = requestAnimationFrame(paint);
        return;
      }

      const elapsed = now - launchAt;
      const ph = launchPhase(elapsed, config);
      const u = ph.unfold;

      /* ③ 细线先横向生长(占展开前 40%),随后卡体纵向展开 */
      if (u <= 0) {
        line.style.transform = "scaleX(0)";
        body.style.opacity = "0";
      } else if (u < 0.4) {
        line.style.transform = `scaleX(${easeOutCubic(u / 0.4)})`;
        body.style.opacity = "0";
      } else {
        line.style.transform = "scaleX(1)";
        body.style.opacity = "1";
        body.style.transform = `scaleY(${0.012 + 0.988 * easeInOutCubic((u - 0.4) / 0.6)})`;
      }

      /* ③ SVG 边框描边绘制 */
      const { perimeter } = metrics.current;
      if (perimeter > 0) {
        frameRect.style.strokeDasharray = String(perimeter);
        frameRect.style.strokeDashoffset = String(perimeter * (1 - easeInOutCubic(u)));
      }
      corners.classList.toggle("is-on", u >= 1);

      /* 进度条:展开完成时写入目标宽度,CSS transition 负责填充
         (仅 target-progress 挂了 barFillRef;其余模板跳过) */
      if (u >= 1 && !barSet && bar) {
        barSet = true;
        bar.style.width = barWidth;
      }

      /* ④⑤ 打字机 + 高亮(8a 近似:金额/文案一体逐字;8b 起全模板通用) */
      {
        const active = sentenceRef?.current;
        const typed = Math.max(typedChars(card.spoken, ph.typingMs, config.typeCps), active?.end ?? 0);
        const highlight = active ? `${active.start}:${active.end}` : "";
        if (typed !== lastTyped || highlight !== lastHighlight) {
          lastTyped = typed; lastHighlight = highlight;
          const text = card.spoken.slice(0, typed);
          if (active) {
            const mark = document.createElement("span");
            mark.className = "overlay-sentence-active";
            mark.dataset.sentenceStart = String(active.start);
            mark.dataset.sentenceEnd = String(active.end);
            mark.textContent = text.slice(active.start, active.end);
            spoken.replaceChildren(document.createTextNode(text.slice(0, active.start)), mark, document.createTextNode(text.slice(active.end)));
          } else spoken.textContent = text;
        }
        if (typed >= card.spoken.length && !sentenceRef) return; // 编排完成,停帧
      }

      raf = requestAnimationFrame(paint);
    };

    raf = requestAnimationFrame(paint);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [card, launchAt, config, barWidth, foldAt, sentenceRef]);

  const anchor = geometry.cardAnchor;

  return (
    <div
      className="overlay-card"
      style={{ top: anchor.y, width: anchor.width }}
      role="status"
      aria-label={card.title}
    >
      <div className="overlay-card-line" ref={lineRef} style={{ transform: "scaleX(0)" }} />
      <div className="overlay-card-body" ref={bodyRef} style={{ opacity: 0, transform: "scaleY(0.012)" }}>
        <svg ref={svgRef} className="overlay-card-frame" aria-hidden="true">
          <rect ref={frameRef} className="overlay-card-frame-rect" x="0.75" y="0.75" width="10" height="10" />
        </svg>
        <div className="overlay-card-corners" ref={cornerRef}>
          <i className="overlay-card-corner overlay-card-corner-tl" />
          <i className="overlay-card-corner overlay-card-corner-tr" />
          <i className="overlay-card-corner overlay-card-corner-bl" />
          <i className="overlay-card-corner overlay-card-corner-br" />
        </div>
        {renderCardTemplate(card, { spokenRef, barFillRef })}
      </div>
    </div>
  );
});
