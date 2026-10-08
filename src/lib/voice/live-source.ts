/**
 * wire → 状态机事件映射(plan §9 两层协议的桥,8b)。
 *
 * 编排服务广播 VoiceWireEvent;大屏覆盖层据本映射驱动 8a 纯 reducer。
 * 纯函数:不碰 WS、不碰时钟(at 由调用方注入 performance.now()),
 * 单测里可以用同一条事件序列喂「编排镜像」与「本映射」断言终态一致。
 *
 * 时序分工(两侧共用 VOICE_TIMING / LAUNCH / DEMO_TIMING 常量,不漂移):
 * - waking 成型、closing 动画、
 *   error-fallback 播报计时 → 覆盖层本地定时(与 8a 回放器同构);
 * - listening 转写、答案内容、answering→followup 与追问超时 → wire 驱动。
 *   PCM 队列耗尽上报 hub 后，由 hub 广播状态；不按打字速度估计。
 * 映射对乱序/重复事件保持惰性:非法转移返回空数组,reducer 侧再兜一层。
 */

import type {
  AnswerCardData,
  VoiceEventInput,
  VoiceStateName,
} from "@/lib/voice/session-machine";
import type { VoiceWireEvent } from "@/lib/voice/protocol";
import { VOICE_HUB_DEFAULT_PORT } from "@/lib/voice/protocol";

/** 映射所需的状态缓冲(answer.delta full 的卡片 / 最近一条错误文案)。 */
export type LiveSourceContext = {
  lastFullCard: AnswerCardData | null;
  lastErrorMessage: string | null;
};

export function initLiveSourceContext(): LiveSourceContext {
  return { lastFullCard: null, lastErrorMessage: null };
}

export type WireMappingResult = {
  /** 依序派发进 sessionReducer 的事件(可能为空) */
  events: VoiceEventInput[];
  ctx: LiveSourceContext;
};

export function wireToMachineEvents(
  prev: VoiceStateName,
  ev: VoiceWireEvent,
  ctx: LiveSourceContext,
): WireMappingResult {
  const keep: WireMappingResult = { events: [], ctx };
  switch (ev.type) {
    case "session.start":
      // 只有 ambient 才接管;重复的 session.start 忽略
      return prev === "ambient" ? { events: [{ type: "WAKE" }], ctx } : keep;

    case "state.change": {
      const to = ev.to;
      if (to === "listening") {
        switch (prev) {
          case "waking":
            return { events: [{ type: "WOKEN" }], ctx }; // waking 被编排侧先行收口
          case "thinking":
            return { events: [{ type: "THINKING_VOICE" }], ctx };
          case "answering":
            return { events: [{ type: "BARGE_IN" }], ctx };
          case "followup":
            return { events: [{ type: "SPEAK" }], ctx };
          default:
            return keep; // ambient/closing/error-fallback 不处理
        }
      }
      if (to === "thinking") {
        switch (prev) {
          case "listening":
            return { events: [{ type: "SUBMIT", question: ev.question ?? "" }], ctx };
          case "answering":
            // 播报中直接追问:打断后立即提交(编排镜像走同一序列)
            return {
              events: [{ type: "BARGE_IN" }, { type: "SUBMIT", question: ev.question ?? "" }],
              ctx,
            };
          case "followup":
            return {
              events: [{ type: "SPEAK" }, { type: "SUBMIT", question: ev.question ?? "" }],
              ctx,
            };
          default:
            return keep;
        }
      }
      if (to === "answering") {
        // answer.delta(full) 先于本事件到达,卡片已入缓冲
        if (prev !== "thinking" || !ctx.lastFullCard) return keep;
        return {
          events: [{ type: "ANSWER", card: ctx.lastFullCard }],
          ctx,
        };
      }
      if (to === "followup") {
        return prev === "answering" ? { events: [{ type: "SPOKEN" }], ctx } : keep;
      }
      if (to === "error-fallback") {
        if (!isSessionActiveName(prev)) return keep;
        return {
          events: [{ type: "ERROR", message: ctx.lastErrorMessage ?? "orchestrator-error" }],
          ctx,
        };
      }
      if (to === "closing") {
        if (!isSessionActiveName(prev) || prev === "closing") return keep;
        return { events: [{ type: "FORCE_CLOSE" }], ctx };
      }
      return keep; // to === "waking" / ambient 等:本地自管理
    }

    case "asr.partial":
      return prev === "listening" ? { events: [{ type: "PARTIAL", text: ev.text }], ctx } : keep;

    case "answer.delta": {
      if (!ev.full || !ev.card) return keep;
      // 只入缓冲;真正的 ANSWER 由随后的 state.change(to=answering)派发
      return { events: [], ctx: { ...ctx, lastFullCard: ev.card } };
    }

    case "error":
      // 只记录文案;error-fallback 转移由紧随的 state.change 驱动
      return { events: [], ctx: { ...ctx, lastErrorMessage: ev.message } };

    case "session.end":
      // 兜底:正常路径 closing 已由 state.change 驱动;漏收时强收
      return isSessionActiveName(prev) && prev !== "closing"
        ? { events: [{ type: "FORCE_CLOSE" }], ctx }
        : keep;

    case "input.open":
    case "input.progress":
    case "barge.result":
    case "input.listen":
    case "speech.fixed": return keep;
    /* 不驱动状态机的事件 */
    case "tool.invoke":
    case "tts.boundary":
    case "hub.hello":
    case "trace.turn":
      return keep;
  }
}

/** WS 断链(编排进程被 kill 等):活跃会话立即优雅退场;ambient 无感。 */
export function connectionLostEvents(prev: VoiceStateName): VoiceEventInput[] {
  return isSessionActiveName(prev) && prev !== "closing" ? [{ type: "FORCE_CLOSE" }] : [];
}

function isSessionActiveName(name: VoiceStateName): boolean {
  return name !== "ambient";
}

/** 从页面 searchParams 解析 hub 地址:?hub=ws://… 优先;缺省同主机默认端口。 */
export function resolveHubUrl(hubParam: string | null | undefined, locationHost: string): string {
  const explicit = sanitizeHubParam(hubParam);
  if (explicit) return explicit;
  const host = locationHost || "localhost";
  return `ws://${host.split(":")[0]}:${VOICE_HUB_DEFAULT_PORT}`;
}

const BASE_HUB_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function defaultExtraHubHosts(): string[] {
  return (process.env.NEXT_PUBLIC_VOICE_HUB_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

/** ?hub= 白名单:本机地址 + 构建期 NEXT_PUBLIC_VOICE_HUB_HOSTS 列出的主机(审核 H2)。
 *  大屏 URL 可被转发/分享,放行任意地址 = 让大屏连到别人的 hub 显示任意内容。 */
export function sanitizeHubParam(
  hubParam: string | null | undefined,
  extraHosts: string[] = defaultExtraHubHosts(),
): string | null {
  if (!hubParam) return null;
  let url: URL;
  try {
    url = new URL(hubParam);
  } catch {
    return null;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  const host = url.hostname.toLowerCase();
  return [...BASE_HUB_HOSTS, ...extraHosts].includes(host) ? hubParam : null;
}

export const HUB_TOKEN_STORAGE_KEY = "voice.hubToken";

/** 从 URL 片段 #hubToken=… 取令牌(片段不随请求发往服务器、不进 Referer) */
export function takeHubTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("hubToken");
  return token && token.length <= 256 ? token : null;
}
