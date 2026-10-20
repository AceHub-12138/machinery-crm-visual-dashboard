import { GsapScreenExperience } from "@/components/screen/GsapScreenExperience";
import { ScreenExperience } from "@/components/screen/ScreenExperience";
import { sanitizeHubParam } from "@/lib/voice/live-source";
import { resolveScreenLayout } from "@/lib/screen-layout";
import { refreshScreenSnapshot, screenRequestTime } from "./actions";
import { resolveQualityMode, localQualityPermission } from '@/components/screen/motion/quality-permission';
import { headers } from 'next/headers';
export const dynamic = "force-dynamic";
export default async function SalesScreenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestHost = (await headers()).get('host');
  const source = params.source === "mock" ? "mock" : "public";
  const layout = resolveScreenLayout(typeof params.layout === "string" ? params.layout : undefined, process.env.SCREEN_LAYOUT);
  const payload = await refreshScreenSnapshot(source);
  const initialNow = await screenRequestTime();
  const Experience = params.motion === "gsap" ? GsapScreenExperience : ScreenExperience;
  return <Experience manualQualityAllowed={process.env.NEXUS_QUALITY_PERMISSION === "local-candidate" && localQualityPermission(process.env.NEXUS_QUALITY_PERMISSION, requestHost)} qualityMode={resolveQualityMode(params, process.env.NEXUS_QUALITY_PERMISSION, requestHost)} demoMode={params.demo === "1"} initialPayload={payload} source={source} layout={layout} kiosk={params.kiosk === "1"} fit={params.fit === "1" || (params.fit !== "0" && layout.fit)} initialNow={initialNow} voice={params.voiceLive === "1" ? "live" : params.voiceDemo === "1" ? "demo" : null} lite={params.lite === "1"} hubUrl={sanitizeHubParam(typeof params.hub === "string" ? params.hub : null) ?? undefined}/>;
}
