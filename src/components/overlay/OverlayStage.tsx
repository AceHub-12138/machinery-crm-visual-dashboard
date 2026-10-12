"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { LevelMeter } from "@/components/overlay/LevelMeter";
import { JarvisCore } from "@/components/overlay/JarvisCore";
import { AnswerCard } from "@/components/overlay/AnswerCard";
import "./overlay.css";
import {
  DEMO_LINES,
  DEMO_TIMING,
  buildTargetProgressCard,
  demoAnswerForCycle,
  demoAmplitude,
} from "@/lib/voice/demo-script.ts";
import { LAUNCH, overlayGeometry, easeInOutCubic, lerp, type OverlayGeometry, type VoiceFrame } from "@/lib/voice/params";
import {
  initSessionState,
  sessionReducer,
  VOICE_TIMING,
  type AnswerCardData,
  type VoiceEvent,
  type VoiceStateName,
  type VoicePresentationReason,
  type VoiceSessionState,
} from "@/lib/voice/session-machine";
import { PausableDeadline } from "@/lib/voice/deadline";
import { VoiceMicrophone } from "@/lib/voice/microphone";
import { PcmPlayer, audioBaseUrl, type Speech, type PlaybackFailure } from "@/lib/voice/pcm-player";
import { playbackFallbackMs } from "@/lib/voice/playback-timing";
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
 * 剧本按 cycles 轮播全部七张数据卡。
 * driver="live"(?voiceLive=1):订阅编排服务 WS hub——session.start 唤醒、
 * asr.partial 转写、answer.delta 携卡发射、error 降级、断链 FORCE_CLOSE。
 * 状态机/粒子/卡片两个驱动共用;wire→状态机映射在 live-source.ts(纯函数)。
 * F9 = 手动唤醒;Esc = 立即退场。
 */

type Phase = "off" | "enter" | "on" | "exit";

const STATUS: Partial<Record<VoiceStateName | VoicePresentationReason, { en: string; zh: string }>> = {
  "no-data": { en: "No Data", zh: "暂无数据" },
  offline: { en: "Offline", zh: "网络中断" },
  "asr-miss": { en: "Pardon", zh: "没听清" },
  interrupted: { en: "Interrupted", zh: "已打断" },
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
  const reduced = useReducedMotion();
  const payloadRef = useRef(payload);
  useEffect(() => { payloadRef.current = payload; }, [payload]);
  const [session, dispatch] = useReducer(sessionReducer, undefined, () => initSessionState());
  const [phase, setPhase] = useState<Phase>("off");
  const [geometry, setGeometry] = useState<OverlayGeometry>(() => overlayGeometry(1920, 1080));
  const [launchAt, setLaunchAt] = useState(0);
  const [promptCaption, setPromptCaption] = useState<string | null>(null);
  const [debug] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1");
  const [audioNotice, setAudioNotice] = useState<string | null>(null);
  const [bargePaused, setBargePaused] = useState(false);
  const playbackGuardRef = useRef<PausableDeadline | null>(null);
  const micRef = useRef<VoiceMicrophone | null>(null);
  const fixedIdRef = useRef<string | null>(null);
  const [sentenceVersion, setSentenceVersion] = useState(0);
  const playerRef = useRef<PcmPlayer | null>(null);
  const speechRef = useRef<Speech | null>(null);
  const sentenceRef = useRef<{ start: number; end: number } | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const listenIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const screenIdRef = useRef<string | null>(null);
  const ownsSessionRef = useRef(false);
  const getPlayer = useCallback(() => playerRef.current ??= new PcmPlayer({ onActive: () => micRef.current?.playbackStarted(), onIdle: latency => micRef.current?.playbackEnded(latency) }), []);
  const reportPlayback = useCallback((type: "playback.started" | "playback.drained" | "playback.failed", turnId: string, reason?: PlaybackFailure | "dismissed") => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, at: Date.now(), turnId, ...(reason ? { reason } : {}) }));
    }
  }, []);

  /* 画布每帧读取的快照;React 状态只在状态机转移时更新,帧内全走 ref */
  const frameRef = useRef<VoiceFrame>({
    name: "ambient",
    listenClock: driver === "live" ? null : undefined,
    since: 0,
    amplitude: () => 0.4,
    launchAt: null,
    foldAt: null,
    geometry: overlayGeometry(1920, 1080),
  });

  /* ---- 同步镜像:wire 事件可能在同一渲染帧内连发(答案末片与
     state.change answering 同 tick 到达),映射的 prev 必须取即时状态,
     不能等 React 提交。镜像与视图走同一 reducer,事件流一致则必然一致;
     所有派发都先更新镜像,不拿旧的 React 渲染覆盖即时状态。 ---- */
  const mirrorRef = useRef<VoiceSessionState>(initSessionState());
  const dispatchTracked = useCallback((event: VoiceEvent) => {
    const next = sessionReducer(mirrorRef.current, event);
    if (["thinking", "closing", "ambient", "error-fallback"].includes(next.name)) { setBargePaused(false); frameRef.current.listenClock = null; setPromptCaption(null); }
    if (next.name !== "answering" && mirrorRef.current.name === "answering") {
      playerRef.current?.stop(); playingIdRef.current = null; sentenceRef.current = null;
    }
    if (["closing", "ambient", "error-fallback"].includes(next.name) && next.name !== mirrorRef.current.name && fixedIdRef.current) {
      playerRef.current?.stop(); fixedIdRef.current = null;
    }
    mirrorRef.current = next;
    dispatch(event);
  }, []);

  /* ---- 几何:核心/锚点随视口换算(1080p 全屏即方案落位) ---- */
  useEffect(() => {
    let raf = 0;
    const apply = () => {
      cancelAnimationFrame(raf);
      const g = overlayGeometry(window.innerWidth, window.innerHeight, session.name, session.card?.kind === "region");
      const from = frameRef.current.geometry.core;
      const start = performance.now();
      const paint = (now: number) => {
        const p = Math.min(1, (now - start) / 600);
        frameRef.current.geometry = { ...g, core: { x: lerp(from.x, g.core.x, easeInOutCubic(p)), y: lerp(from.y, g.core.y, easeInOutCubic(p)) } };
        if (p < 1) raf = requestAnimationFrame(paint);
      };
      if (reduced) frameRef.current.geometry = g;
      else raf = requestAnimationFrame(paint);
      setGeometry(g);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", apply); };
  }, [session.name, session.card?.kind, reduced]);

  /* ---- 状态机 → 画布快照(名字/相位/振幅源/折叠起点) ---- */
  useEffect(() => {
    frameRef.current.name = bargePaused ? "listening" : session.name;
    frameRef.current.since = session.since;
    frameRef.current.amplitude = driver === "live"
      ? () => playerRef.current?.getAmplitude() ?? 0
      : (now: number) => demoAmplitude(session.name, session.since, now);
    frameRef.current.foldAt = session.name === "closing" ? session.since : null;
    if (session.name !== "answering") frameRef.current.launchAt = null;
  }, [session.name, session.since, driver, bargePaused]);

  // Audio diagnostics must remain live when the particle renderer is static.
  useEffect(() => {
    if (!reduced || driver !== "live" || session.name === "ambient") return;
    const timer = window.setInterval(() => { frameRef.current.amplitude(performance.now()); }, 50);
    return () => window.clearInterval(timer);
  }, [reduced, driver, session.name]);

  /* ---- 驱动器:每个状态排一个动作序列,转移即换排 ----
     demo:全流程脚本化;live:播完和追问倒计时由hub统一驱动,
     本地只负责动画及思考/音频异常兜底。 */
  const timers = useRef<number[]>([]);
  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  const live = driver === "live";
  const sampleInput = useCallback(() => driver === "live" ? micRef.current?.getAmplitude() ?? 0 : demoAmplitude("listening", mirrorRef.current.since, performance.now()),[driver]);

  const wake = useCallback(() => {
    // 守卫:手动 F9 与回放器排定的唤醒撞车时,第二次直接忽略。
    // 读同步镜像而非 React state:本回调必须身份稳定——live effect 依赖它,
    // 否则每次状态转移都会重建 WS,答案事件会落在重连空窗里丢包。
    if (mirrorRef.current.name !== "ambient") return;
    if (live) void getPlayer().resume().catch(() => setAudioNotice("请点击屏幕启用声音。"));
    setPhase("enter"); // 挂载画布(透明),下一帧淡入
    dispatchTracked({ type: "WAKE", at: performance.now() });
  }, [dispatchTracked, live, getPlayer]);

  const fireAnswer = useCallback(
    (card?: AnswerCardData) => {
      const resolved =
        card ??
        (live ? buildTargetProgressCard(payloadRef.current.salesTargets.targets, payloadRef.current.salesTargets.period.label) : demoAnswerForCycle(payloadRef.current, mirrorRef.current.cycles).card);
      const now = performance.now();
      frameRef.current.launchAt = now;
      setLaunchAt(now);
      dispatchTracked({ type: "ANSWER", at: now, card: resolved });
      if (live) {
        sentenceRef.current = null;
        setAudioNotice(null);
        const speech = speechRef.current;
        if (!ownsSessionRef.current) return;
        if (!speech) {
          setAudioNotice("声音暂不可用，请查看卡片。");
          return;
        }
        playingIdRef.current = speech.turnId;
        let reportedStart = false;
        const isCurrent = () => playingIdRef.current === speech.turnId && mirrorRef.current.name === "answering";
        getPlayer().play(speech, audioBaseUrl(hubUrl ?? `ws://${window.location.hostname}:3210`), tokenRef.current, {
          onMetrics: metrics => {
            if (isCurrent() && socketRef.current?.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({ type: "playback.metrics", at: Date.now(), turnId: speech.turnId, ...metrics }));
            }
          },
          onSentenceStart: (index) => {
            if (!isCurrent()) return;
            const sentence = speech.sentences[index];
            sentenceRef.current = { start: sentence.displayStart, end: sentence.displayEnd }; setSentenceVersion(v => v + 1);
            if (!reportedStart) { reportedStart = true; reportPlayback("playback.started", speech.turnId); }
          },
          onSentenceSkipped: (sentenceIndex, reason) => {
            if (!isCurrent()) return;
            setAudioNotice("部分语音播报中断，请查看卡片。");
            if (socketRef.current?.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({ type: "playback.skipped", at: Date.now(), turnId: speech.turnId, sentenceIndex, reason }));
            }
          },
          onDrained: () => {
            if (!isCurrent()) return;
            sentenceRef.current = null; setSentenceVersion(v => v + 1);
            reportPlayback("playback.drained", speech.turnId);
            playingIdRef.current = null;
            // Hub owns live state transitions; wait for its followup/closing.
          },
          onError: (reason) => {
            if (!isCurrent()) return;
            sentenceRef.current = null; setSentenceVersion(v => v + 1);
            setAudioNotice(reason === "autoplay_blocked" ? "请点击屏幕启用声音；本次回答请查看卡片，随后重新唤醒。" : "语音播报中断，请查看卡片。");
            reportPlayback("playback.failed", speech.turnId, reason);
            playingIdRef.current = null;
          },
        }, playbackFallbackMs(resolved.spoken));
      }
    },
    [dispatchTracked, live, hubUrl, getPlayer, reportPlayback],
  );

  useEffect(() => {
    clearTimers();
    const now = () => performance.now();

    switch (session.name) {
      case "ambient": {
        if (live) void playerRef.current?.suspend().catch(() => {});
        // demo:基线停留后开始下一轮演示;live:等 hub 的 session.start
        if (!live) at(DEMO_TIMING.ambientHoldMs, wake);
        break;
      }
      case "waking": {
        if (live) break;
        at(VOICE_TIMING.wakingMs, () => dispatchTracked({ type: "WOKEN", at: now() }));
        break;
      }
      case "listening": {
        if (live) break; // 转写与提交由编排服务 asr.partial / state.change 驱动
        // ASR 逐字中间结果 → 静音判定提交
        const question = demoAnswerForCycle(payloadRef.current, session.cycles).question;
        for (let i = 1; i <= question.length; i++) {
          const text = question.slice(0, i);
          at(i * DEMO_TIMING.partialStepMs, () => dispatchTracked({ type: "PARTIAL", text, at: now() }));
        }
        at(DEMO_TIMING.listenMs, () => dispatchTracked({ type: "SUBMIT", question, at: now() }));
        break;
      }
      case "thinking": {
        if (live) {
          // 思考结果来自 wire;本地只保 8s 兜底(plan §4 超时降级,留 1.5s 容网)
          at(VOICE_TIMING.thinkingMaxMs + 1500, () => dispatchTracked({ type: "THINK_TIMEOUT", at: now() }));
          break;
        }
        at(DEMO_TIMING.thinkOkMs, () => fireAnswer());
        break;
      }
      case "answering": {
        if (live) {
          // Network loss is handled by the WS close path. A hung browser/hub
          // still releases the exhibition UI after a conservative audio guard.
          playbackGuardRef.current = new PausableDeadline(playbackFallbackMs(session.spoken ?? "") + VOICE_TIMING.failedCardHoldMs + 2000, () => {
            playerRef.current?.stop();
            const id = playingIdRef.current;
            if (id) reportPlayback("playback.failed", id, "timeout");
            setAudioNotice("语音播报中断，请查看卡片。");
            dispatchTracked({ type: "FORCE_CLOSE", at: now() });
          });
          break;
        }
        // 播报完成 = 打字时长 + 持卡展示,随后进入追问
        // (typeStart = unfoldStart + unfoldMs,与 launchPhase 的打字起点一致)
        const typeMs = session.spoken ? (session.spoken.length / LAUNCH.typeCps) * 1000 : 0;
        const typeStartMs = LAUNCH.unfoldStartMs + LAUNCH.unfoldMs;
        at(typeStartMs + typeMs + DEMO_TIMING.answerHoldMs, () => dispatchTracked({ type: "SPOKEN", at: now() }));
        break;
      }
      case "followup": {
        if (live) break; // Hub owns the countdown after it receives playback.drained.
        frameRef.current.listenClock = { receivedAt: now(), remainingMs: VOICE_TIMING.longListenMs, timeoutMs: VOICE_TIMING.longListenMs, paused: false };
        at(0, () => setPromptCaption(null));
        at(VOICE_TIMING.longListenMs, () => { frameRef.current.listenClock = null; setPromptCaption(DEMO_LINES.followup); });
        const shortAt = VOICE_TIMING.longListenMs + DEMO_TIMING.followupPromptMs;
        at(shortAt, () => { frameRef.current.listenClock = { receivedAt: now(), remainingMs: VOICE_TIMING.shortListenMs, timeoutMs: VOICE_TIMING.shortListenMs, paused: false }; });
        at(shortAt + VOICE_TIMING.shortListenMs, () => { frameRef.current.listenClock = null; setPromptCaption(DEMO_LINES.decline); });
        at(shortAt + VOICE_TIMING.shortListenMs + DEMO_TIMING.idleExitMs, () => dispatchTracked({ type: "FOLLOWUP_TIMEOUT", at: now() }));
        break;
      }
      case "closing": {
        // 退场:粒子收拢 800ms 走完 → 派发 CLOSED,同时覆盖层淡出卸载,
        // 基线在淡出中接回原相位(plan §5)
        at(VOICE_TIMING.closingMs, () => {
          dispatchTracked({ type: "CLOSED", at: now() });
          setPhase("exit");
        });
        break;
      }
      case "error-fallback": {
        if (live) break;
        at(DEMO_TIMING.errorHoldMs, () => dispatchTracked({ type: "ERROR_SPOKEN", at: now() }));
        break;
      }
    }
    return () => { clearTimers(); playbackGuardRef.current?.cancel(); playbackGuardRef.current = null; };
  }, [session.name, session.cycles, session.spoken, at, clearTimers, fireAnswer, wake, live, dispatchTracked, reportPlayback]);

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
      if (event.type === "hub.hello" && event.screenId) { screenIdRef.current = event.screenId; micRef.current?.setScreen(event.screenId); }
      if (event.type === "session.start") { sessionIdRef.current = event.sessionId; ownsSessionRef.current = !event.screenId || event.screenId === screenIdRef.current; micRef.current?.setSession(event.sessionId, ownsSessionRef.current); }
      if (event.type === "session.end") { micRef.current?.setListen(null); frameRef.current.listenClock = null; setBargePaused(false); }
      if (event.type === "input.listen") {
        frameRef.current.listenClock = event.mode === "listening" || event.mode === "followup"
          ? { receivedAt: performance.now(), remainingMs: event.timeoutMs ?? VOICE_TIMING.shortListenMs, timeoutMs: event.timeoutMs ?? VOICE_TIMING.shortListenMs, paused: true }
          : null;
        listenIdRef.current = event.listenId;
        if (event.phase === "long" || event.mode === "off") setPromptCaption(null);
        if (ownsSessionRef.current) micRef.current?.setListen(event); return;
      }
      if (event.type === "input.open" || event.type === "input.progress") {
        if (event.sessionId !== sessionIdRef.current || event.listenId !== listenIdRef.current) return;
        frameRef.current.listenClock = { receivedAt: performance.now(), remainingMs: event.remainingMs, timeoutMs: event.timeoutMs, paused: event.paused };
        return;
      }
      if (event.type === "barge.result") {
        if (event.sessionId !== sessionIdRef.current) return;
        if (!micRef.current?.bargeResult(event.attemptId, event.accepted, event.reason === "rate_limited" ? "rate_limited" : undefined)) return;
        if (event.accepted || event.reason === "rate_limited") { getPlayer().stop(); fixedIdRef.current = null; playingIdRef.current = null; setBargePaused(false); }
        return;
      }
      if (event.type === "state.change" && ["thinking", "closing", "error-fallback"].includes(event.to)) { micRef.current?.setListen(null); frameRef.current.listenClock = null; }
      if (event.type === "answer.delta" && event.full) speechRef.current = event.speech ?? null;
      if (event.type === "speech.fixed") {
        if (event.speech.fixed === "unheard") dispatchTracked({ type: "PRESENTATION_REASON", reason: "asr-miss", at: performance.now() });
        if (!ownsSessionRef.current) return;
        frameRef.current.listenClock = null; setPromptCaption(event.text);
        const id = event.speech.turnId; fixedIdRef.current = id;
        getPlayer().play(event.speech, audioBaseUrl(hubUrl ?? `ws://${window.location.hostname}:3210`), tokenRef.current, {
          onSentenceStart: () => reportPlayback("playback.started", id),
          onDrained: () => { if (fixedIdRef.current !== id) return; fixedIdRef.current = null; reportPlayback("playback.drained", id); },
          onError: (reason) => { if (fixedIdRef.current !== id) return; fixedIdRef.current = null; reportPlayback("playback.failed", id, reason); },
        }, playbackFallbackMs(event.text)); return;
      }
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
          dispatchTracked({ ...machineEvent, at: performance.now() } as VoiceEvent);
        }
      }
      if (event.type === "state.change" && event.reason) dispatchTracked({ type: "PRESENTATION_REASON", reason: event.reason, at: performance.now() });
      if (event.type === "state.change" && event.to === "answering" && speechRef.current?.fixed === "unheard") dispatchTracked({ type: "PRESENTATION_REASON", reason: "asr-miss", at: performance.now() });
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

    tokenRef.current = hubToken;
    if (hubToken) {
      const mic = new VoiceMicrophone({ hubUrl: hubUrl ?? `ws://${window.location.hostname}:3210`, token: hubToken, state: () => mirrorRef.current.name, notice: setAudioNotice,
        sentenceIndex: () => getPlayer().currentSentence,
        barge: (action, turnId) => {
          const currentId = playingIdRef.current ?? fixedIdRef.current;
          if (turnId && currentId && turnId !== currentId) return;
          if (action === "duck") { getPlayer().duck(); playbackGuardRef.current?.pause(); }
          else if (action === "pause") { setBargePaused(true); void getPlayer().pausePlayback(); }
          else { setBargePaused(false); playbackGuardRef.current?.resume(); void getPlayer().continuePlayback(); }
        } });
      micRef.current = mic; void mic.start();
    }
    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(hubUrl ?? `ws://${window.location.hostname}:3210`);
      socketRef.current = socket;
      socket.onmessage = (e) => {
        try {
          dispatchWire(String(e.data));
        } catch (err) {
          console.error("[overlay] wire event dropped:", (err as Error).message);
        }
      };
      socket.onopen = () => {
        micRef.current?.setConnected(true);
        retryDelay = 800;
        if (hubToken) socket?.send(JSON.stringify({ type: "hub.auth", at: Date.now(), token: hubToken }));
        socket?.send(JSON.stringify({ type: "console.hello", at: Date.now(), role: "screen" }));
      };
      socket.onclose = (e) => {
        if (cancelled) return;
        setBargePaused(false); frameRef.current.listenClock = null;
        micRef.current?.setConnected(false); micRef.current?.setScreen(null); screenIdRef.current = null;
        playerRef.current?.stop(); playingIdRef.current = null; sentenceRef.current = null;
        for (const machineEvent of connectionLostEvents(mirrorRef.current.name)) {
          dispatchTracked({ ...machineEvent, at: performance.now() } as VoiceEvent);
        }
        if (mirrorRef.current.name !== "ambient") dispatchTracked({ type: "PRESENTATION_REASON", reason: "offline", at: performance.now() });
        if (e.code === 4401) {
          console.warn("[overlay] hub 令牌无效");
          return;
        }
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    return () => {
      cancelled = true;
      void micRef.current?.close(); micRef.current = null;
      window.clearTimeout(retryTimer);
      socket?.close(); socketRef.current = null;
      playingIdRef.current = null; sentenceRef.current = null; speechRef.current = null;
      void playerRef.current?.close(); playerRef.current = null;
    };
  }, [live, hubUrl, fireAnswer, wake, dispatchTracked, getPlayer, reportPlayback]);

  useEffect(() => {
    if (!live) return;
    const enable = () => { void getPlayer().resume().catch(() => {}); void micRef.current?.resume().catch(() => {}); };
    window.addEventListener("pointerdown", enable);
    window.addEventListener("keydown", enable);
    return () => { window.removeEventListener("pointerdown", enable); window.removeEventListener("keydown", enable); };
  }, [live, getPlayer]);

  /* enter → 下一帧进 on,触发 500ms 淡入过渡 */
  useEffect(() => {
    if (phase !== "enter") return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("on")));
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // The closing state timer is cleared when CLOSED moves to ambient. Own the
  // exit fade separately so that state cleanup cannot leave an invisible overlay.
  useEffect(() => {
    if (phase !== "exit") return;
    const timer = window.setTimeout(() => setPhase("off"), DEMO_TIMING.exitFadeMs);
    return () => window.clearTimeout(timer);
  }, [phase]);

  /* ---- 运维后备:F9 手动唤醒 / Esc 立即退场(plan §3) ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") {
        e.preventDefault();
        if (live) { void getPlayer().resume(); void micRef.current?.wake(); } else wake();
      } else if (e.key === "Escape") {
        const state = mirrorRef.current.name;
        const id = fixedIdRef.current ?? speechRef.current?.turnId;
        if (live && ownsSessionRef.current && state !== "ambient" && sessionIdRef.current && socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "session.dismiss", at: Date.now(), sessionId: sessionIdRef.current }));
        else if (live && ownsSessionRef.current && id) reportPlayback("playback.failed", id, "dismissed");
        dispatchTracked({ type: "FORCE_CLOSE", at: performance.now() });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wake, dispatchTracked, live, reportPlayback, getPlayer]);

  /* ---- A3 文案过渡:状态词/转写按状态名 key 重挂载,CSS 淡入(240ms);
     同状态内的 ASR 打字就地刷新,不经任何 effect/setState ---- */
  const captionText = session.reason === "asr-miss" ? "没听清，请再说一次" :
    session.name === "waking"
      ? DEMO_LINES.wake
      : session.name === "listening"
        ? session.partial
        : session.name === "followup"
          ? promptCaption
          : session.name === "error-fallback"
            ? DEMO_LINES.fallback
            : null;
  const captionDim = session.name === "listening" && !session.partial;
  const statusNow = STATUS[session.reason ?? session.name];

  if (phase === "off") return null;

  return (
    <div className="overlay-root" data-phase={phase} data-has-card={session.card !== null} data-barge-paused={bargePaused}>
      <JarvisCore reduced={reduced} stateKey={session.name} frameRef={frameRef} quality={lite ? "lite" : "high"} />

      <div key={session.name} className="overlay-caption-block overlay-caption-appear">
        {statusNow ? (
          <p className="overlay-status" data-tone={session.reason || session.name === "error-fallback" ? "warn" : "normal"}>
            <span className="overlay-en">{bargePaused ? "Listening" : statusNow.en}</span>
            <span aria-hidden="true">{bargePaused ? "聆听中" : statusNow.zh}</span>
          </p>
        ) : null}
        {["listening", "followup"].includes(session.name) ? <LevelMeter sample={sampleInput} /> : null}
        {audioNotice && !session.card ? <p className="overlay-audio-notice" role="status">{audioNotice}</p> : null}
        {captionText ? (
          <p className={`overlay-partial${captionDim ? " overlay-partial-idle" : ""}`}>{captionText}</p>
        ) : null}
      </div>

      {session.card ? (
        <AnswerCard
          card={session.card}
          audioNotice={audioNotice}
          launchAt={launchAt}
          geometry={geometry}
          foldAt={session.name === "closing" ? session.since : null}
          sentenceRef={live ? sentenceRef : undefined}
          sentenceVersion={sentenceVersion}
        />
      ) : null}

      {debug ? <p className="overlay-hint">
        {live ? "HUB LIVE · ESC EXIT — XIAOCHUAN 8C" : "F9 WAKE · ESC EXIT — XIAOCHUAN 8A"}
      </p> : null}
    </div>
  );
}
