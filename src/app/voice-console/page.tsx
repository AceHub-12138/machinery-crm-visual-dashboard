"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseWireEvent, VOICE_HUB_DEFAULT_PORT, type TurnTracePayload, type VoiceWireEvent } from "@/lib/voice/protocol";
import { resolveHubUrl, sanitizeHubParam, HUB_TOKEN_STORAGE_KEY, takeHubTokenFromHash } from "@/lib/voice/live-source";
import { DEMO_QUESTIONS } from "@/lib/voice/demo-questions";

/**
 * 「小川」文字对话台(plan §16.2 D;8b 验收入口)。
 *
 * 输入问题 → 编排服务(hub)→ 事件流广播 → 大屏 /screen/sales?voiceLive=1
 * 动效。本页显示实时事件流与各阶段打点耗时(question→prefetch→
 * llm_first_token→tool_exec→answer_full),取代 ?voiceDemo=1 的演示地位
 * (voiceDemo 保留不删)。
 */

type ConsoleEvent = {
  id: number;
  at: number;
  deltaMs: number | null;
  event: VoiceWireEvent;
};

const STAGE_LABELS: Array<[keyof TurnTracePayload["stages"], string]> = [
  ["question", "提问"],
  ["prefetch", "预取"],
  ["llmFirstToken", "首字"],
  ["toolExec", "工具轮"],
  ["answerFull", "全答"],
];

export default function VoiceConsolePage() {
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "unauthorized">("connecting");
  const [counts, setCounts] = useState({ screens: 0, consoles: 0 });
  const [events, setEvents] = useState<ConsoleEvent[]>([]);
  const [trace, setTrace] = useState<TurnTracePayload | null>(null);
  const [question, setQuestion] = useState("");
  const [hubToken, setHubToken] = useState<string>("");

  const socketRef = useRef<WebSocket | null>(null);
  const eventIdRef = useRef(0);
  const turnStartRef = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);

  const send = useCallback((payload: Record<string, unknown>) => {
    socketRef.current?.send(JSON.stringify({ ...payload, at: Date.now() }));
    if (payload.type === "question.submit") {
      turnStartRef.current = Date.now();
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // ?hub= 只接受本机地址(安全审核:防止对话台被引到任意服务器)
    const hubParam = sanitizeHubParam(params.get("hub"));
    const url = resolveHubUrl(hubParam, window.location.host || `localhost:${VOICE_HUB_DEFAULT_PORT}`);
    // 令牌:#hubToken= 优先(读后写入 sessionStorage 并从地址栏抹掉),否则取 sessionStorage
    let hubToken: string | null = null;
    try {
      const fromHash = takeHubTokenFromHash(window.location.hash);
      if (fromHash) {
        window.sessionStorage.setItem(HUB_TOKEN_STORAGE_KEY, fromHash);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      hubToken = fromHash ?? window.sessionStorage.getItem(HUB_TOKEN_STORAGE_KEY);
      if (hubToken && tokenInputRef.current && !tokenInputRef.current.value) {
        tokenInputRef.current.value = hubToken; // 回填输入框(effect 内不做 setState,react-hooks 规则)
      }
    } catch {
      hubToken = null;
    }
    let socket: WebSocket;
    let cancelled = false;
    let retryTimer = 0;
    let retryDelay = 800;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        retryDelay = 800;
        setStatus("open");
        if (hubToken) socket.send(JSON.stringify({ type: "hub.auth", at: Date.now(), token: hubToken }));
        socket.send(JSON.stringify({ type: "console.hello", at: Date.now(), role: "console" }));
      };
      socket.onmessage = (e) => {
        try {
          const event = parseWireEvent(String(e.data));
          if (!event) return;
          if (event.type === "hub.hello") {
            setCounts({ screens: event.screens, consoles: event.consoles });
            return;
          }
          if (event.type === "trace.turn") {
            setTrace(event.trace);
            return;
          }
          eventIdRef.current += 1;
          const entry: ConsoleEvent = {
            id: eventIdRef.current,
            at: event.at,
            deltaMs: turnStartRef.current == null ? null : Math.max(0, event.at - turnStartRef.current),
            event,
          };
          setEvents((prev) => [entry, ...prev].slice(0, 120));
        } catch (err) {
          console.error("[voice-console] wire event dropped:", (err as Error).message);
        }
      };
      socket.onclose = (e) => {
        if (cancelled) return;
        if (e.code === 4401) {
          setStatus("unauthorized"); // 令牌错误:不重连,等用户改令牌后「保存并重连」
          return;
        }
        setStatus("closed");
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 5000);
      };
      socket.onerror = () => socket.close();
    };
    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      socket?.close();
      socketRef.current = null;
    };
  }, [hubToken]);

  const saveTokenAndReconnect = () => {
    const value = tokenInputRef.current?.value.trim() ?? "";
    try {
      if (value) window.sessionStorage.setItem(HUB_TOKEN_STORAGE_KEY, value);
      else window.sessionStorage.removeItem(HUB_TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setHubToken(value); // 连接 useEffect 依赖 hubToken,变化即重连
  };

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || status !== "open") return;
    send({ type: "question.submit", text: trimmed });
    setQuestion("");
  };

  const statusText = {
    connecting: "连接中…",
    open: "已连接",
    closed: "已断开(重连中)",
    unauthorized: "令牌错误",
  }[status];
  const statusColor =
    status === "open"
      ? "text-emerald-400"
      : status === "connecting"
        ? "text-amber-300"
        : "text-rose-400";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 bg-[#0a0a0c] px-6 py-8 text-[#e8e8ec]">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/10 pb-4">
        <h1 className="text-xl font-bold tracking-wide">小川 · 文字对话台 <span className="text-white/40">8B</span></h1>
        <p className={`text-sm ${statusColor}`}>● {statusText}</p>
        <p className="text-sm text-white/50">
          hub: <span className="tabular-nums">{counts.screens}</span> 屏 · <span className="tabular-nums">{counts.consoles}</span> 台
        </p>
        <input
          ref={tokenInputRef}
          type="password"
          placeholder="Hub 令牌(跨机模式必填)"
          className="w-56 rounded border border-white/15 bg-black/40 px-3 py-1.5 text-sm outline-none focus:border-amber-500/60"
        />
        <button
          type="button"
          onClick={saveTokenAndReconnect}
          className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5"
        >
          保存并重连
        </button>
        <a
          href="/screen/sales?voiceLive=1"
          target="_blank"
          rel="noreferrer"
          className="ml-auto rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/20"
        >
          打开大屏 voiceLive ↗
        </a>
      </header>

      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => send({ type: "session.wake" })}
          disabled={status !== "open"}
          className="rounded bg-amber-500/90 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          唤醒(开始会话)
        </button>
        <button
          type="button"
          onClick={() => send({ type: "session.close" })}
          disabled={status !== "open"}
          className="rounded border border-white/20 px-4 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
        >
          退场
        </button>
        <form
          className="flex flex-1 min-w-[320px] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="向小川提问,例如:本月销售情况怎么样?"
            className="flex-1 rounded border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-amber-500/60"
          />
          <button
            type="submit"
            disabled={status !== "open" || !question.trim()}
            className="rounded bg-white/90 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            提问
          </button>
        </form>
      </section>

      <section className="flex flex-wrap gap-2">
        {DEMO_QUESTIONS.map((demo) => (
          <button
            key={demo.id}
            type="button"
            title={demo.note}
            disabled={status !== "open"}
            onClick={() => submit(demo.question)}
            className={`rounded-full border px-3 py-1.5 text-xs disabled:opacity-40 ${
              demo.expectCard === "unanswerable"
                ? "border-rose-400/40 text-rose-300 hover:bg-rose-400/10"
                : "border-amber-500/30 text-amber-200/90 hover:bg-amber-500/10"
            }`}
          >
            #{demo.id} {demo.question}
          </button>
        ))}
      </section>

      {trace ? (
        <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-2 flex items-center gap-3 text-sm text-white/60">
            <span className="font-semibold text-white/80">第 {trace.turn + 1} 轮打点</span>
            <span className={trace.degraded ? "text-rose-300" : "text-emerald-300"}>
              {trace.degraded ? "降级应答" : trace.source === "mcp" ? "MCP 长尾" : "预取主路径"}
            </span>
            <span>卡片:{trace.card ?? "—"}</span>
            {trace.totalMs != null ? <span>全程 <b className="tabular-nums text-amber-300">{trace.totalMs}ms</b></span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {trace.classifyMs != null ? (
              <span className="rounded bg-amber-500/10 px-2 py-1 text-xs tabular-nums text-amber-200">
                意图分类 {trace.classifyMs.toFixed(1)}ms
              </span>
            ) : null}
            {trace.numberGuardViolations?.length ? (
              <span className="rounded bg-rose-500/10 px-2 py-1 text-xs text-rose-300">数字模板校验告警</span>
            ) : null}
            {STAGE_LABELS.map(([key, label]) => {
              const value = trace.stages[key];
              return (
                <span
                  key={key}
                  className={`rounded px-2 py-1 text-xs tabular-nums ${
                    value == null ? "bg-white/5 text-white/30" : "bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {label} {value == null ? "—" : `${value}ms`}
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="min-h-0 flex-1">
        <h2 className="mb-2 text-sm font-semibold text-white/60">事件流(新到旧)</h2>
        <div ref={logRef} className="max-h-[46vh] overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs leading-6">
          {events.length === 0 ? (
            <p className="text-white/30">等待事件…先「唤醒」,再提问。大屏用 ?voiceLive=1 打开。</p>
          ) : (
            events.map((entry) => (
              <ConsoleEventRow key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function ConsoleEventRow({ entry }: { entry: ConsoleEvent }) {
  const { event } = entry;
  const tone =
    event.type === "error"
      ? "text-rose-300"
      : event.type === "state.change"
        ? "text-sky-300"
        : event.type === "answer.delta"
          ? "text-amber-200"
          : "text-white/60";
  let detail = "";
  switch (event.type) {
    case "state.change":
      detail = `${event.from} → ${event.to}${event.question ? ` · "${event.question}"` : ""}`;
      break;
    case "asr.partial":
      detail = `"${event.text}"${event.final ? "(final)" : ""}`;
      break;
    case "tool.invoke":
      detail = `card=${event.card ?? "—"} · source=${event.source} · ${event.latencyMs ?? "?"}ms`;
      break;
    case "answer.delta":
      detail = `seq=${event.seq}${event.full ? " [FULL+CARD]" : ""} "${event.text}"`;
      break;
    case "session.start":
      detail = event.sessionId;
      break;
    case "session.end":
      detail = event.reason;
      break;
    case "error":
      detail = `${event.code} · ${event.message}`;
      break;
    default:
      detail = "";
  }
  return (
    <p className="whitespace-pre-wrap break-all">
      <span className="text-white/35">+{entry.deltaMs == null ? "—" : String(entry.deltaMs).padStart(5)}ms</span>{" "}
      <span className={tone}>{event.type.padEnd(13)}</span>{" "}
      <span className="text-white/50">{detail}</span>
    </p>
  );
}
