"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { JarvisCore } from "@/components/overlay/JarvisCore";
import { AnswerCard } from "@/components/overlay/AnswerCard";
import "./overlay.css";
import {
  DEMO_LINES,
  DEMO_QUESTION,
  DEMO_TIMING,
  buildTargetProgressCard,
  demoAmplitude,
  scenarioForCycle,
} from "@/lib/voice/demo-script.ts";
import { LAUNCH, overlayGeometry, type OverlayGeometry, type VoiceFrame } from "@/lib/voice/params";
import {
  initSessionState,
  sessionReducer,
  VOICE_TIMING,
  type AnswerCardData,
  type VoiceEvent,
  type VoiceStateName,
  type VoiceSessionState,
} from "@/lib/voice/session-machine";
import { parseWireEvent } from "@/lib/voice/protocol";
import {
  connectionLostEvents,
  initLiveSourceContext,
  wireToMachineEvents,
  HUB_TOKEN_STORAGE_KEY,
  takeHubTokenFromHash,
  type LiveSourceContext,
} from "@/lib/voice/live-source";
import type { PublicScreenPayload } from "@/lib/public-screen-payload";

/**
 * 语音覆盖层舞台(plan §5/§11 8a;§16.2 8b 起 double 驱动)。
 *
 * 接管:大屏不改动——本组件以 fixed 全屏近黑场淡入盖住基线(≈500ms),
 * 基线轮播与轮询全程继续跑,退场淡出后观众无缝接回原相位。
 *
 * driver="demo"(默认,?voiceDemo=1):8a 脚本回放器,自动循环演示全流程,
 * 剧本按 cycles 轮换(偶数轮正常 / 奇数轮 thinking 超时降级)。
 * driver="live"(?voiceLive=1):订阅编排服务 WS hub——session.start 唤醒、
 * asr.partial 转写、answer.delta 携卡发射、error 降级、断链 FORCE_CLOSE。
 * 状态机/粒子/卡片两个驱动共用;wire→状态机映射在 live-source.ts(纯函数)。
 * F9 = 手动唤醒;Esc = 立即退场。
 */

type Phase = "off" | "enter" | "on" | "exit";

const STATUS: Partial<Record<VoiceStateName, { en: string; zh: string }>> = {
  waking: { en: "Waking", zh: "唤醒中" },
  listening: { en: "Listening", zh: "聆听中" },
  thinking: { en: "Thinking", zh: "思考中" },
  answering: { en: "Answering", zh: "播报中" },
  followup: { en: "Awaiting", zh: "等待追问" },
  closing: { en: "Closing", zh: "退场中" },
  "error-fallback": { en: "Degraded", zh: "服务降级" },
};

export function OverlayStage({
  payload,
  lite = false,
  driver = "demo",
  hubUrl,
}: {
  payload: PublicScreenPayload;
  /** &lite=1:强制降级档(软件渲染环境预览演示用) */
  lite?: boolean;
  /** demo=8a 脚本回放;live=8b 编排服务事件流 */
  driver?: "demo" | "live";
  /** live 模式 hub 地址(缺省同主机 3210) */
  hubUrl?: string;
}) {
  const [session, dispatch] = useReducer(sessionReducer, undefined, () => initSessionState());
  const [phase, setPhase] = useState<Phase>("off");
  const [geometry, setGeometry] = useState<OverlayGeometry>(() => overlayGeometry(1920, 1080));
  const [launchAt, setLaunchAt] = useState(0);

  /* ---- 同步镜像:wire 事件可能在同一渲染帧内连发(答案末片与
     state.change answering 同 tick 到达),映射的 prev 必须取即时状态,
     不能等 React 提交。镜像与视图走同一 reducer,事件流一致则必然一致;
     effect 里再从视图回同步一次作漂移兜底。 ---- */
  const mirrorRef = useRef<VoiceSessionState>(initSessionState());
  useEffect(() => {
    mirrorRef.current = session;
  }, [session]);
  const dispatchTracked = useCallback((event: VoiceEvent) => {
    mirrorRef.current = sessionReducer(mirrorRef.current, event);
    dispatch(event);
  }, []);

  /* 画布每帧读取的快照;React 状态只在状态机转移时更新,帧内全走 ref */
  const frameRef = useRef<VoiceFrame>({
    name: "ambient",
    since: 0,
    amplitude: () => 0.4,
    launchAt: null,
    foldAt: null,
    geometry: overlayGeometry(1920, 1080),
  });

  /* ---- 几何:核心/锚点随视口换算(1080p 全屏即方案落位) ---- */
  useEffect(() => {
    const apply = () => {
      const g = overlayGeometry(window.innerWidth, window.innerHeight);
      frameRef.current.geometry = g;
      setGeometry(g);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  /* ---- 状态机 → 画布快照(名字/相位/振幅源/折叠起点) ---- */
  useEffect(() => {
    frameRef.current.name = session.name;
    frameRef.current.since = session.since;
    frameRef.current.amplitude = (now: number) => demoAmplitude(session.name, session.since, now);
    frameRef.current.foldAt = session.name === "closing" ? session.since : null;
    if (session.name !== "answering") frameRef.current.launchAt = null;
  }, [session.name, session.since]);

  /* ---- 驱动器:每个状态排一个动作序列,转移即换排 ----
     demo:全流程脚本化;live:唤醒/播报/追问/退场用同一套本地节奏常量,
     只有 聆听转写与思考结果 来自 wire 事件(思考保底 8s+1.5s 兜底超时)。 */
  const timers = useRef<number[]>([]);
  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  const live = driver === "live";

  const wake = useCallback(() => {
    // 守卫:手动 F9 与回放器排定的唤醒撞车时,第二次直接忽略。
    // 读同步镜像而非 React state:本回调必须身份稳定——live effect 依赖它,
    // 否则每次状态转移都会重建 WS,答案事件会落在重连空窗里丢包。
    if (mirrorRef.current.name !== "ambient") return;
    setPhase("enter"); // 挂载画布(透明),下一帧淡入
    dispatchTracked({ type: "WAKE", at: performance.now() });
  }, [dispatchTracked]);

  const fireAnswer = useCallback(
    (card?: AnswerCardData) => {
      const resolved =
        card ??
        buildTargetProgressCard(payload.salesTargets.targets, payload.salesTargets.period.label);
      const now = performance.now();
      frameRef.current.launchAt = now;
      setLaunchAt(now);
      dispatchTracked({ type: "ANSWER", at: now, card: resolved });
    },
    [payload, dispatchTracked],
  );

  useEffect(() => {
    clearTimers();
    const now = () => performance.now();

    switch (session.name) {
      case "ambient": {
        // demo:基线停留后开始下一轮演示;live:等 hub 的 session.start
        if (!live) at(DEMO_TIMING.ambientHoldMs, wake);
        break;
      }
      case "waking": {
        at(VOICE_TIMING.wakingMs, () => dispatchTracked({ type: "WOKEN", at: now() }));
        break;
      }
      case "listening": {
        if (live) break; // 转写与提交由编排服务 asr.partial / state.change 驱动
        // ASR 逐字中间结果 → 静音判定提交
        for (let i = 1; i <= DEMO_QUESTION.length; i++) {
          const text = DEMO_QUESTION.slice(0, i);
          at(i * DEMO_TIMING.partialStepMs, () => dispatchTracked({ type: "PARTIAL", text, at: now() }));
        }
        at(DEMO_TIMING.listenMs, () => dispatchTracked({ type: "SUBMIT", question: DEMO_QUESTION, at: now() }));
        break;
      }
      case "thinking": {
        if (live) {
          // 思考结果来自 wire;本地只保 8s 兜底(plan §4 超时降级,留 1.5s 容网)
          at(VOICE_TIMING.thinkingMaxMs + 1500, () => dispatchTracked({ type: "THINK_TIMEOUT", at: now() }));
          break;
        }
        if (scenarioForCycle(session.cycles) === "normal") {
          at(DEMO_TIMING.thinkOkMs, () => fireAnswer());
        } else {
          at(DEMO_TIMING.thinkTimeoutMs, () => dispatchTracked({ type: "THINK_TIMEOUT", at: now() }));
        }
        break;
      }
      case "answering": {
        // 播报完成 = 打字时长 + 持卡展示,随后进入追问
        // (typeStart = unfoldStart + unfoldMs,与 launchPhase 的打字起点一致)
        const typeMs = session.spoken ? (session.spoken.length / LAUNCH.typeCps) * 1000 : 0;
        const typeStartMs = LAUNCH.unfoldStartMs + LAUNCH.unfoldMs;
        at(typeStartMs + typeMs + DEMO_TIMING.answerHoldMs, () => dispatchTracked({ type: "SPOKEN", at: now() }));
        break;
      }
      case "followup": {
        at(VOICE_TIMING.followupMs, () => dispatchTracked({ type: "FOLLOWUP_TIMEOUT", at: now() }));
        break;
      }
      case "closing": {
        // 退场:粒子收拢 800ms 走完 → 派发 CLOSED,同时覆盖层淡出卸载,
        // 基线在淡出中接回原相位(plan §5)
        at(VOICE_TIMING.closingMs, () => {
          dispatchTracked({ type: "CLOSED", at: now() });
          setPhase("exit");
        });
        at(VOICE_TIMING.closingMs + DEMO_TIMING.exitFadeMs, () => setPhase("off"));
        break;
      }
      case "error-fallback": {
        at(DEMO_TIMING.errorHoldMs, () => dispatchTracked({ type: "ERROR_SPOKEN", at: now() }));
        break;
      }
    }
    return clearTimers;
  }, [session.name, session.cycles, session.spoken, at, clearTimers, fireAnswer, wake, live, dispatchTracked]);

  /* ---- live:编排服务事件源(WS;断链优雅退场,重连退火) ---- */
  const liveCtxRef = useRef<LiveSourceContext>(initLiveSourceContext());

  useEffect(() => {
    if (!live) return;
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let retryDelay = 800;
    let cancelled = false;

    const dispatchWire = (raw: string) => {
      const event = parseWireEvent(raw);
      if (!event) return;
      const prev = mirrorRef.current.name;
      const result = wireToMachineEvents(prev, event, liveCtxRef.current);
      liveCtxRef.current = result.ctx;
      for (const machineEvent of result.events) {
        if (machineEvent.type === "ANSWER") {
          // 发射起点在本组件写下(粒子束/细线/打字都以它为 t0)
          fireAnswer(machineEvent.card);
        } else if (machineEvent.type === "WAKE") {
          wake();
        } else {
          dispatch({ ...machineEvent, at: performance.now() } as VoiceEvent);
        }
      }
    };

    // 令牌:#hubToken= 优先(读后写入 sessionStorage 并从地址栏抹掉),否则取 sessionStorage
    let hubToken: string | null = null;
    try {
      const fromHash = takeHubTokenFromHash(window.location.hash);
      if (fromHash) {
        window.sessionStorage.setItem(HUB_TOKEN_STORAGE_KEY, fromHash);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      hubToken = fromHash ?? window.sessionStorage.getItem(HUB_TOKEN_STORAGE_KEY);
    } catch {
      hubToken = null;
    }

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(hubUrl ?? `ws://${window.location.hostname}:3210`);
      socket.onmessage = (e) => {
        try {
          dispatchWire(String(e.data));
        } catch (err) {
          console.error("[overlay] wire event dropped:", (err as Error).message);
        }
      };
      socket.onopen = () => {
        retryDelay = 800;
        if (hubToken) socket?.send(JSON.stringify({ type: "hub.auth", at: Date.now(), token: hubToken }));
        socket?.send(JSON.stringify({ type: "console.hello", at: Date.now(), role: "screen" }));
      };
      socket.onclose = (e) => {
        if (cancelled) return;
        if (e.code === 4401) {
          console.warn("[overlay] hub 令牌无效");
          return;
        }
        // 编排崩溃(plan §16.2 C 降级路径 1):活跃会话立即优雅退场
        for (const machineEvent of connectionLostEvents(mirrorRef.current.name)) {
          dispatch({ ...machineEvent, at: performance.now() } as VoiceEvent);
        }
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [live, hubUrl, fireAnswer, wake, dispatchTracked]);

  /* enter → 下一帧进 on,触发 500ms 淡入过渡 */
  useEffect(() => {
    if (phase !== "enter") return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("on")));
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  /* ---- 运维后备:F9 手动唤醒 / Esc 立即退场(plan §3) ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") {
        e.preventDefault();
        wake();
      } else if (e.key === "Escape") {
        dispatchTracked({ type: "FORCE_CLOSE", at: performance.now() });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wake, dispatchTracked]);

  /* ---- A3 文案过渡:状态词/转写按状态名 key 重挂载,CSS 淡入(240ms);
     同状态内的 ASR 打字就地刷新,不经任何 effect/setState ---- */
  const captionText =
    session.name === "waking"
      ? DEMO_LINES.wake
      : session.name === "listening"
        ? session.partial
        : session.name === "followup"
          ? DEMO_LINES.followup
          : session.name === "error-fallback"
            ? DEMO_LINES.fallback
            : null;
  const captionDim = session.name === "listening" && !session.partial;
  const statusNow = STATUS[session.name];

  if (phase === "off") return null;

  return (
    <div className="overlay-root" data-phase={phase}>
      <JarvisCore frameRef={frameRef} quality={lite ? "lite" : "high"} />

      <div key={session.name} className="overlay-caption-block overlay-caption-appear">
        {statusNow ? (
          <p className="overlay-status">
            <span className="overlay-en">{statusNow.en}</span>
            <span aria-hidden="true">{statusNow.zh}</span>
          </p>
        ) : null}
        {captionText ? (
          <p className={`overlay-partial${captionDim ? " overlay-partial-idle" : ""}`}>{captionText}</p>
        ) : null}
      </div>

      {session.card ? (
        <AnswerCard
          card={session.card}
          launchAt={launchAt}
          geometry={geometry}
          foldAt={session.name === "closing" ? session.since : null}
        />
      ) : null}

      <p className="overlay-hint">
        {live ? "HUB LIVE · ESC EXIT — XIAOCHUAN 8B" : "F9 WAKE · ESC EXIT — XIAOCHUAN 8A"}
      </p>
    </div>
  );
}
