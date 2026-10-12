"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ClipText } from "@/components/screen/ClipText";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cardExcerpt, cardFollowups, shipmentPages, ShipmentPageClock, displaySpoken } from "@/lib/voice/card-presentation";
import { buildSpokenSentences } from "@/lib/voice/spoken-normalize";
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
import { spokenNodes, useSpokenPages } from "./spoken-pages";
import { CARD_TIERS, renderCardTemplate } from "./cards/registry";

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
  audioNotice = null,
  launchAt,
  geometry,
  config = LAUNCH,
  foldAt = null,
  sentenceRef,
  sentenceVersion = 0,
  playbackPaused = false,
  playbackFinished = false,
}: {
  card: AnswerCardData;
  audioNotice?: string | null;
  /** 发射起点(performance.now 域,由 OverlayStage 在派发 ANSWER 时写下) */
  launchAt: number;
  geometry: OverlayGeometry;
  config?: LaunchConfig;
  /** 折叠吸回起点(closing 进入时刻,§5);null = 正常展示 */
  foldAt?: number | null;
  sentenceVersion?: number;
  sentenceRef?: RefObject<{ start: number; end: number } | null>;
  playbackPaused?: boolean;
  playbackFinished?: boolean;
}) {
  const reduced = useReducedMotion();
  const announcedRef = useRef<{ card: AnswerCardData | null; index: number }>({card:null,index:-1});
  const liveRef = useRef<HTMLParagraphElement>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<SVGPathElement | null>(null);
  const cornerRef = useRef<HTMLDivElement | null>(null);
  const spokenRef = useRef<HTMLSpanElement | null>(null);
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const spokenPages = useSpokenPages(displaySpoken(card.spoken),paragraphRef);
  const [spokenPageIndex,setSpokenPageIndex] = useState(0);
  const spokenPage = Math.min(spokenPageIndex,spokenPages.length-1);
  const activeSpokenPage = spokenPages[spokenPage];
  const progressRef = useRef(0);
  const manualUntil = useRef(0);
  const visiblePageRef = useRef(0);
  const selectSpokenPage = (page: number) => { manualUntil.current=performance.now()+10000;setSpokenPageIndex(page); };
  useEffect(()=>{ visiblePageRef.current=spokenPage; },[spokenPage]);
  useEffect(()=>{
    if(reduced || spokenPages.length===1 || foldAt!==null) return;
    let lastKey="",boundary=performance.now(),base=0;
    const update=()=>{
      const now=performance.now();if(now<manualUntil.current) return;
      const active=sentenceRef?.current;
      const complete=progressRef.current>=card.spoken.length;
      const key=active ? `${active.start}:${active.end}` : complete ? "complete" : "typing";
      if(key!==lastKey) {lastKey=key;boundary=now;base=visiblePageRef.current;}
      let page=0;
      if(active) {
        const first=Math.max(0,spokenPages.findIndex(p=>active.start>=p.start && active.start<p.end));
        const last=Math.max(first,spokenPages.findIndex(p=>active.end-1>=p.start && active.end-1<p.end));
        page=first+Math.floor((now-boundary)/4000)%(last-first+1);
      } else if(complete) page=(base+Math.floor((now-boundary)/4000))%spokenPages.length;
      else page=Math.max(0,spokenPages.findIndex(p=>Math.max(0,progressRef.current-1)>=p.start && progressRef.current-1<p.end));
      setSpokenPageIndex(page);
    };
    update();const timer=window.setInterval(update,100);return()=>window.clearInterval(timer);
  },[card,spokenPages,reduced,foldAt,sentenceRef]);
  const barFillRef = useRef<HTMLSpanElement | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const pages = card.kind === "customers-shipments" ? shipmentPages(card.rows, card.omittedCount).length : 1;
  const followups = cardFollowups(card);
  const pagingFlags = useRef({ paused: false, finished: false });
  useEffect(() => { pagingFlags.current = { paused: playbackPaused, finished: playbackFinished }; }, [playbackPaused, playbackFinished]);
  useEffect(() => {
    if (pages <= 1 || foldAt !== null) return;
    const sentences = buildSpokenSentences(card.spoken);
    const clock = new ShipmentPageClock(pages, sentences.length, launchAt + config.unfoldStartMs + config.unfoldMs);
    const update = () => {
      const active = sentenceRef?.current;
      const index = active ? sentences.findIndex(s => active.start >= s.displayStart && active.start < s.displayEnd) : -1;
      setPageIndex(clock.update(performance.now(), index < 0 ? null : index, pagingFlags.current.paused, pagingFlags.current.finished));
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [card, pages, launchAt, config, foldAt, sentenceRef]);

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
    const c = 22;
    rect.setAttribute("d", `M ${c} 1 L ${w-c} 1 L ${w-1} ${c} L ${w-1} ${h-c} L ${w-c} ${h-1} L ${c} ${h-1} L 1 ${h-c} L 1 ${c} Z`);
  }, [card.kind, geometry.cardAnchor.width, geometry.scale, audioNotice]);

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
    const sentences = buildSpokenSentences(displaySpoken(card.spoken));
    if (announcedRef.current.card !== card) announcedRef.current = { card, index: -1 };

    const paint = (now: number) => {
      if (disposed) return;

      /* §5 退场第一步:折叠吸回核心(200ms)——发射编排的逆过程;
         完成后停帧,覆盖层淡出接管余下的退场 */
      if (foldAt != null && !reduced) {
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

      const elapsed = reduced ? config.unfoldStartMs + config.unfoldMs + card.spoken.length / config.typeCps * 1000 : now - launchAt;
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
        const typed = reduced ? card.spoken.length : Math.max(typedChars(card.spoken, ph.typingMs, config.typeCps), active?.end ?? 0);
        progressRef.current = typed;
        body.dataset.spokenComplete = String(typed >= card.spoken.length);
        const highlight = active ? `${active.start}:${active.end}` : "";
        if (typed !== lastTyped || highlight !== lastHighlight) {
          lastTyped = typed; lastHighlight = highlight;
          const text = displaySpoken(card.spoken).slice(activeSpokenPage.start, Math.max(activeSpokenPage.start, Math.min(typed,activeSpokenPage.end)));
          if (active && active.end>activeSpokenPage.start && active.start<activeSpokenPage.end) {
            const mark = document.createElement("span");
            mark.className = "overlay-sentence-active";
            mark.dataset.sentenceStart = String(active.start);
            mark.dataset.sentenceEnd = String(active.end);
            const start=Math.max(0,active.start-activeSpokenPage.start);
            const end=Math.min(text.length,active.end-activeSpokenPage.start);
            mark.append(spokenNodes(text.slice(start,end)));
            spoken.replaceChildren(spokenNodes(text.slice(0,start)),mark,spokenNodes(text.slice(end)));
          } else spoken.replaceChildren(spokenNodes(text));
        }
        const completed = sentences.findLastIndex(s => s.displayEnd <= typed);
        if (completed > announcedRef.current.index && liveRef.current) {
          liveRef.current.textContent = sentences.slice(announcedRef.current.index + 1, completed + 1).map(s => s.text).join("");
          announcedRef.current.index = completed;
        }
        if (typed >= card.spoken.length && u >= 1) return; // 编排完成,停帧
      }

      raf = requestAnimationFrame(paint);
    };

    if (reduced) paint(performance.now());
    else raf = requestAnimationFrame(paint);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [card, launchAt, config, barWidth, foldAt, sentenceRef, sentenceVersion, reduced, activeSpokenPage]);

  const anchor = geometry.cardAnchor;

  return (
    <div
      className={`overlay-card${card.kind === "brief" ? " is-brief" : ""}`}
      data-card-kind={card.kind}
      data-tier={CARD_TIERS[card.kind]}
      style={{ top: anchor.y, width: anchor.width / geometry.scale, transform: `translateX(-50%) scale(${geometry.scale})` }}
      role="region"
      aria-label={card.title}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true" ref={liveRef} />
      <div className="overlay-card-line" ref={lineRef} style={{ transform: "scaleX(0)" }} />
      <div className="overlay-card-body" ref={bodyRef} style={{ opacity: 0, transform: "scaleY(0.012)" }}>
        <svg ref={svgRef} className="overlay-card-frame" aria-hidden="true">
          <path ref={frameRef} className="overlay-card-frame-rect" />
        </svg>
        <div className="overlay-card-corners" ref={cornerRef}>
          <i className="overlay-card-corner overlay-card-corner-tl" />
          <i className="overlay-card-corner overlay-card-corner-tr" />
          <i className="overlay-card-corner overlay-card-corner-bl" />
          <i className="overlay-card-corner overlay-card-corner-br" />
        </div>
        <header className="overlay-card-header">{audioNotice ? <p className="overlay-audio-notice" role="status">{audioNotice}</p> : null}<h2 className="overlay-card-title" title={card.title}><ClipText full={card.title}>{cardExcerpt(card.title, 24)}</ClipText></h2>
          <p className="overlay-card-subtitle" title={"summaryText" in card ? card.summaryText : undefined}>{"summaryText" in card ? <ClipText full={card.summaryText}>{cardExcerpt(card.summaryText, 40)}</ClipText> : card.kind === "brief" ? "小川 · 为您服务" : "经营数据总览"}</p>
        </header>
        {card.kind !== "brief" ? <div className="overlay-card-data">{renderCardTemplate(card, { barFillRef, launchAt, pageIndex })}</div> : null}
        <section className="overlay-spoken-section" aria-label="小川播报" data-page={spokenPage+1} data-pages={spokenPages.length}>
          <div className="overlay-spoken-heading"><h3><span aria-hidden="true">✦</span> 小川播报</h3>
            {spokenPages.length>1 ? <div className="overlay-spoken-pagination">
              <button type="button" aria-label="上一页播报" onClick={()=>selectSpokenPage((spokenPage+spokenPages.length-1)%spokenPages.length)}>‹</button>
              <span>{spokenPage+1}/{spokenPages.length}</span>
              <div className="overlay-page-dots" aria-hidden="true">{spokenPages.slice(Math.max(0,spokenPage-3),Math.max(7,spokenPage+4)).map((p)=><i key={p.start} className={p.start===activeSpokenPage.start ? "is-active" : ""} />)}</div>
              <button type="button" aria-label="下一页播报" onClick={()=>selectSpokenPage((spokenPage+1)%spokenPages.length)}>›</button>
            </div> : null}
          </div>
          <p ref={paragraphRef} className="overlay-card-spoken" title={displaySpoken(card.spoken)} aria-hidden="true"><span ref={spokenRef} /></p>
        </section>
        <div className="overlay-followups">{followups.length ? <><span className="overlay-followups-label">{card.kind === "brief" ? "您可以问我：" : "可继续追问："}</span>{followups.map(q => <span key={q}>{q}</span>)}</> : null}</div>
      </div>
    </div>
  );
});
