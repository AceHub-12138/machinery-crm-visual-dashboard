"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { useSceneMotion } from "./motion/useSceneMotion";
import { HeaderBar } from "./HeaderBar";
import { ContractGauge, OperationMetrics, CollectionDial, DeliveryAlerts, ShipmentFeed } from "./NexusPanels";
import { ShipmentMap } from "./ShipmentMap";
import { freshness } from "@/lib/freshness";
import { MAP_HEADING_HEIGHT, layoutGeometry, resolveScreenLayout, type ScreenLayout } from "@/lib/screen-layout";
import type { PublicScreenPayload } from "@/lib/public-screen-payload";

export function ScreenStage({ initialPayload: payload, kiosk, initialFit, layout = resolveScreenLayout(), now = Date.parse(payload.generatedAt) }: {
  initialPayload: PublicScreenPayload; kiosk: boolean; initialFit: boolean; layout?: ScreenLayout; now?: number;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const select = useSceneMotion(payload, setActiveKey);
  const business = payload.business;
  const g = layoutGeometry(layout, business?.delivery.routes);
  const status = freshness(payload.generatedAt, now);
  useEffect(() => {
    const stage = document.getElementById("screen-stage");
    if (!stage) return;
    document.documentElement.dataset.debug = new URLSearchParams(window.location.search).get("debug") === "1" ? "1" : "0";
    const apply = () => {
      const scale = initialFit ? Math.min(window.innerWidth / layout.width, window.innerHeight / layout.height) : 1;
      stage.style.setProperty("--stage-scale", String(scale));
      stage.style.transform = `scale(${scale})`;
      const frame = stage.parentElement;
      if (frame) { frame.style.width = `${layout.width * scale}px`; frame.style.height = `${layout.height * scale}px`; }
    };
    apply(); window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [layout, initialFit]);
  useEffect(() => { document.documentElement.classList.toggle("kiosk-mode", kiosk); return () => document.documentElement.classList.remove("kiosk-mode"); }, [kiosk]);
  const style = { "--stage-width": `${layout.width}px`, "--stage-height": `${layout.height}px`, "--layout-margin": `${layout.margin}px`, "--header-height": `${layout.header}px`, "--rail-width": `${layout.rail}px`, "--layout-gap": `${layout.gap}px`, "--map-width": `${layout.map}px`, "--feed-height": `${layout.feed}px`, "--row-gap": `${layout.rowGap}px`, "--padding-y": `${layout.paddingY}px`, "--collection-height": `${layout.collection}px`, "--map-heading-height": `${MAP_HEADING_HEIGHT}px`, "--map-surface-height": `${g.mapSurfaceHeight}px`, "--map-base-bottom": `${g.contentHeight - g.glowBottom}px`, "--map-left": `${g.mapLeft}px`, "--map-top": `${g.mapTop}px`, "--map-svg-width": `${g.mapWidth}px`, "--map-svg-height": `${g.mapHeight}px` } as CSSProperties;
  return <div className="screen-shell" style={style}><div className="screen-frame"><main id="screen-stage" className="screen-stage nexus-stage" data-layout={layout.id}>
    <canvas className="nexus-particles" aria-hidden="true"/><div className="nexus-pulse-top" aria-hidden="true"/><div className="nexus-pulse-base" aria-hidden="true"/>
    <HeaderBar periodLabel={payload.salesTargets.period.label} isSample={payload.source === "mock"} displayNotice={business?.displayNotice} freshnessLabel={status.state === "stale" ? status.label : ""}/>
    {business && status.state !== "unavailable" ? <div className="nexus-grid">
      <div className="nexus-left col-start-1 row-start-1"><ContractGauge business={business}/><OperationMetrics business={business}/></div>
      <div className="nexus-map-cell col-start-2 row-start-1" data-screen-panel="map"><ShipmentMap payload={payload} layout={layout} activeKey={activeKey} onSelect={select}/></div>
      <div className="nexus-right col-start-3 row-start-1"><CollectionDial business={business}/><DeliveryAlerts business={business}/></div>
      <div className="nexus-feed-cell"><ShipmentFeed business={business} activeKey={activeKey} onSelect={select}/></div>
    </div> : <div className="nexus-unavailable" role="status">数据暂不可用</div>}
  </main></div></div>;
}
