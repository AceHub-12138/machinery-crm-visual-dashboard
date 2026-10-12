"use client";
import { ClipText } from "@/components/screen/ClipText";
import type { AnswerCardData } from "@/lib/voice/session-machine";
import { cardExcerpt, shipmentPages } from "@/lib/voice/card-presentation";
export function CustomersShipmentsCard({card, pageIndex}: {card: Extract<AnswerCardData, {kind: "customers-shipments"}>; pageIndex: number}) {
  const pages = shipmentPages(card.rows, card.omittedCount);
  const activePage = Math.min(pages.length - 1, pageIndex);
  return <div className="overlay-shipments-block" data-page={activePage + 1}>
    {card.counts ? <div className="overlay-shipment-badges"><span>今日到期 <strong>{card.counts.today}</strong></span><span>七日内 <strong>{card.counts.sevenDays}</strong></span><span className={card.counts.overdue > 0 ? "is-accent" : ""}>逾期未发 <strong>{card.counts.overdue}</strong></span></div> : null}
    <div className="overlay-pages-window"><div className="overlay-pages-track" style={{transform: `translateX(-${activePage * 100}%)`}}>
      {pages.map((rows, p) => <div className="overlay-shipment-page" role="table" aria-label={`发运明细第 ${p + 1} 页`} aria-hidden={p !== activePage} key={p}>
        {rows.map((row, i) => "otherCount" in row ? <div className="overlay-shipment-row overlay-empty" role="row" key="other">其他 {row.otherCount} 项</div> : <div className="overlay-shipment-row" role="row" key={i}>
          <strong title={row.equipmentText}><ClipText full={row.equipmentText}>{cardExcerpt(row.equipmentText, 24)}</ClipText></strong><small title={row.detailText}><ClipText full={row.detailText}>{cardExcerpt(row.detailText, 10)}</ClipText></small><span className="overlay-card-chip" title={row.statusText}><ClipText full={row.statusText}>{cardExcerpt(row.statusText, 6)}</ClipText></span><time>{row.dateLabel}</time>
        </div>)}
        {rows.length === 0 ? <p className="overlay-empty">暂无发运明细</p> : null}
      </div>)}
    </div></div>
    <div className="overlay-page-dots" aria-label={`第 ${activePage + 1} 页，共 ${pages.length} 页`}>{pages.map((_, i) => <i key={i} className={i === activePage ? "is-active" : ""} />)}</div>
  </div>;
}
