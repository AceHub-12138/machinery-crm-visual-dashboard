"use client";
import { useEffect, useState } from "react";
import { MotionProvider } from "./motion/MotionProvider";
import { ScreenStage } from "./ScreenStage";
import { useClock } from "./HeaderBar";
import { OverlayStage } from "@/components/overlay/OverlayStage";
import { OverlayErrorBoundary } from "@/components/overlay/OverlayErrorBoundary";
import { refreshScreenSnapshot } from "@/app/screen/sales/actions";
import type { PublicScreenPayload } from "@/lib/public-screen-payload";
import type { ScreenLayout } from "@/lib/screen-layout";
import type { QualityMode } from './motion/QualityPolicy';
export interface ScreenExperienceProps {
  qualityMode?: QualityMode; manualQualityAllowed?: boolean;
  initialPayload: PublicScreenPayload | null; source: "mock" | "public"; layout: ScreenLayout; kiosk: boolean; fit: boolean; initialNow: number; voice: "live" | "demo" | null; lite: boolean; hubUrl?: string; demoMode?: boolean; MotionComponent?: typeof MotionProvider;
}
export function ScreenExperience({ initialPayload, source, layout, kiosk, fit, initialNow, voice, lite, hubUrl, demoMode = false, qualityMode = 'baseline', manualQualityAllowed = false, MotionComponent = MotionProvider }: ScreenExperienceProps) {
  const [payload, setPayload] = useState(initialPayload);
  const clock = useClock();
  useEffect(() => {
    let active = true, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await refreshScreenSnapshot(source);
        if (active && next) setPayload(prev => !prev || Date.parse(next.generatedAt) >= Date.parse(prev.generatedAt) ? next : prev);
      } catch { /* retain the complete last successful snapshot */ }
      finally { pending = false; }
    };
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [source]);
  const Provider = MotionComponent;
  return <Provider key={`${qualityMode}:${manualQualityAllowed}`} manualQualityAllowed={manualQualityAllowed} qualityMode={qualityMode} dataTime={payload?.generatedAt ?? "无快照"}>
    {payload ? <ScreenStage initialPayload={payload} layout={layout} kiosk={kiosk} initialFit={fit} demoMode={demoMode || voice === "demo"} now={clock || initialNow}/> : <main className="nexus-no-snapshot" role="status">数据暂不可用</main>}
    {payload && voice ? <OverlayErrorBoundary><OverlayStage payload={payload} driver={voice} lite={lite} hubUrl={hubUrl}/></OverlayErrorBoundary> : null}
  </Provider>;
}
