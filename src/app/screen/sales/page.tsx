import { ScreenStage } from "@/components/screen/ScreenStage";
import { OverlayStage } from "@/components/overlay/OverlayStage";
import { OverlayErrorBoundary } from "@/components/overlay/OverlayErrorBoundary";
import { sanitizeHubParam } from "@/lib/voice/live-source";
import { buildMockScreenPayload } from "@/lib/mock";
import { toPublicScreenPayload } from "@/lib/public-screen-payload";

/**
 * 大屏入口。
 *
 * 这里是 Server Component：数据在服务端取好直接进首屏 HTML，
 * 不再出现「先黑屏一行 loading、再等 fetch 回来」的空窗期。
 * 迁回平台时把 buildMockScreenPayload() 换成 getCrmDashboard() / listSalesTargets()
 * 即可，组件层不需要改动。
 *
 * ?voiceDemo=1 挂载「小川」语音覆盖层（8a 视觉壳，纯前端脚本回放，
 * 见 docs/jarvis-voice-mode-plan.md）：基线 ScreenStage 原样保留，
 * 覆盖层以 fixed 全屏淡入淡出完成接管/退场，基线零改动。
 * ?voiceLive=1 为 8b 数据通路入口：覆盖层订阅编排服务 WS hub，
 * 由真实提问→预取→LLM 的事件流驱动（plan §16.2）；?hub= 指定 hub 地址。
 */
export default async function SalesScreenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const payload = toPublicScreenPayload(buildMockScreenPayload());

  return (
    <>
      <ScreenStage
        initialPayload={payload}
        kiosk={params.kiosk === "1"}
        initialFit={params.fit !== "0"}
      />
      {params.voiceLive === "1" ? (
        <OverlayErrorBoundary>
          <OverlayStage
            payload={payload}
            lite={params.lite === "1"}
            driver="live"
            hubUrl={sanitizeHubParam(typeof params.hub === "string" ? params.hub : null) ?? undefined}
          />
        </OverlayErrorBoundary>
      ) : params.voiceDemo === "1" ? (
        <OverlayStage payload={payload} lite={params.lite === "1"} />
      ) : null}
    </>
  );
}
