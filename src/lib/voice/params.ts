/**
 * 粒子参数纯函数层(docs/jarvis-voice-mode-plan.md §6/§7)。
 *
 * 「状态 + 振幅 + 时钟 → 渲染参数」的全部映射都收在这里,
 * JarvisCore/AnswerCard 只消费结果,不做任何数学。
 * 每个函数都可独立单测;规格数字(±12% 呼吸、3 倍自转、8% 内收、
 * 8s/5s 倒计时、约 700ms 发射)以常量+断言固定,防止视觉回退。
 */

import type { VoiceStateName } from "./session-machine.ts";
import { VOICE_TIMING } from "./session-machine.ts";
/* ---------------------------------------------------------------- 素材预算 */

/** plan §6:核心系统合计约 2200 粒 + 氛围场约 3000 粒。
 * 核心系统的构成(参照 Iron Man JARVIS 陀螺环系,用户 2026-09-27 定向):
 * 轨道环 930 + 核球 550 + 虹膜环 210 + 彗尾游丝 34×6 + 外缘散粒 90 ≈ 1990,
 * 与「核心约 2200」同量级;氛围场照旧。 */
export const PARTICLE_BUDGET = {
  core: 2200,
  ambient: 3000,
  sparks: 64,
  beam: 120, // §7 第 2 步:约 120 粒子沿弧线流向卡片
} as const;

/** DPR 封顶 1.5(§6)。 */
export const DPR_CAP = 1.5;
/** 渲染分辨率缩放:canvas 背衬按此系数降采样、CSS 拉伸回满屏。
 * 辉光粒子对轻微模糊不敏感,软件渲染环境下可省 ~44% 光栅像素,
 * 是 60fps 预算(§6)的主要余量来源。 */
export const RESOLUTION_SCALE = 0.75;
/** 粒子场底色(§2 场底近黑)。 */
export const FIELD_BG = "#0A0806";
/** 帧预算(§6:覆盖层开启时帧增量 ≤8ms),超标的降级采样阈值。 */
export const FRAME_BUDGET_MS = 8;

/* ---------------------------------------------------------------- 色板(§2) */

export const PALETTE = {
  core: [255, 182, 92], // --ov-core #FFB65C
  copper: [201, 127, 61], // --ov-copper #C97F3D
  ember: [138, 75, 31], // --ov-ember #8A4B1F
  ink: [255, 232, 199], // --ov-ink #FFE8C7
} as const;

export function rgba(channel: readonly number[], alpha: number): string {
  return `rgba(${channel[0]},${channel[1]},${channel[2]},${alpha})`;
}

/* ---------------------------------------------------------------- 缓动 */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
export const easeInCubic = (t: number): number => clamp01(t) ** 3;
export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/**
 * 指数趋近:帧率无关的平滑追随,消除状态切换的参数硬切(衔接卡顿的根治点)。
 * tauMs 是到达差距 63% 的时间常数;dtMs 为本帧时长。tau<=0 时直达目标。
 */
export function approach(current: number, target: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return target;
  const t = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return current + (target - current) * t;
}

/* ---------------------------------------------------------------- 几何 */

/** 核心落位 (960, 470) @1920×1080(plan §5),按视口比例换算。 */
export const CORE_RATIO = { x: 0.5, y: 470 / 1080 };
/** Task 12: card top at y=400, height at most 620, standard/wide widths 880/1040. */
export const CARD_ANCHOR_Y_RATIO = 400 / 1080;
export const CARD_WIDTH = 880;

export type OverlayGeometry = {
  width: number;
  height: number;
  scale: number;
  core: { x: number; y: number };
  cardAnchor: { x: number; y: number; width: number };
};

/** 纯函数:视口尺寸 → 覆盖层几何(核心/卡片锚点)。 */
export function overlayGeometry(width: number, height: number, phase: VoiceStateName = "ambient", wide = false): OverlayGeometry {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const scale = Math.min(w / 1920, h / 1080);
  const hasCard = phase === "answering" || phase === "followup";
  return {
    width: w,
    height: h,
    scale,
    core: { x: w * CORE_RATIO.x, y: h * (hasCard ? 225 / 1080 : CORE_RATIO.y) },
    cardAnchor: { x: w * CORE_RATIO.x, y: h * CARD_ANCHOR_Y_RATIO, width: (wide ? 1040 : CARD_WIDTH) * scale },
  };
}

/** 核心的基准半径:随视口短边缩放,1080p 下约 150px。 */
export function coreRadiusFor(width: number, height: number): number {
  return Math.min(width, height) * 0.139;
}

/* ---------------------------------------------------------------- 发射编排(§7) */

/** §7 五步时序,全部参数化(验收项:「发射编排各步时序参数可调」)。
 * ① 核心亮度脉冲 120ms → ② 粒子束 350ms → ③ 细线纵向展开+描边 250ms,
 * 相邻步轻微重叠,总编排 ≈650ms,打字机接续 → 与「约 700ms」一致。 */
export type LaunchConfig = {
  pulseMs: number;
  streamStartMs: number;
  streamMs: number;
  unfoldStartMs: number;
  unfoldMs: number;
  /** 打字机字/秒(第 4 步)。 */
  typeCps: number;
  /** 进度条填充时长(卡片内容动画)。 */
  barMs: number;
};

export const LAUNCH: LaunchConfig = {
  pulseMs: 120,
  streamStartMs: 100,
  streamMs: 350,
  unfoldStartMs: 400,
  unfoldMs: 250,
  typeCps: 26,
  barMs: 700,
};

export type LaunchPhase = {
  /** ① 亮度脉冲 0→1 */
  pulse: number;
  /** ② 粒子束整体进度 0→1(120 粒各自错峰内插) */
  stream: number;
  /** ③ 细线→纵向展开+SVG 描边 0→1 */
  unfold: number;
  /** 打字机已过去的时间(ms;未开始为负) */
  typingMs: number;
  /** 展开完成、打字开始的绝对时刻(ms) */
  typeStartMs: number;
};

export function launchPhase(elapsedMs: number, cfg: LaunchConfig = LAUNCH): LaunchPhase {
  return {
    pulse: clamp01(elapsedMs / cfg.pulseMs),
    stream: clamp01((elapsedMs - cfg.streamStartMs) / cfg.streamMs),
    unfold: clamp01((elapsedMs - cfg.unfoldStartMs) / cfg.unfoldMs),
    typingMs: elapsedMs - (cfg.unfoldStartMs + cfg.unfoldMs),
    typeStartMs: cfg.unfoldStartMs + cfg.unfoldMs,
  };
}

/** 第 4 步打字机:按字/秒取可见字符数(单调、有界)。 */
export function typedChars(text: string, typingMs: number, typeCps: number = LAUNCH.typeCps): number {
  if (typingMs <= 0) return 0;
  return Math.min(text.length, Math.floor((typingMs / 1000) * typeCps));
}

/** §5 退场第一步:卡片折叠吸回核心(VOICE_TIMING.foldMs=200)。
 * 返回 0→1 的折叠进度;foldMs<=0 视为立即完成。 */
export function foldProgress(elapsedMs: number, foldMs: number = VOICE_TIMING.foldMs): number {
  if (foldMs <= 0) return 1;
  return clamp01(elapsedMs / foldMs);
}

/** 粒子束第 i 粒的个体进度:整体进度上错峰 60%,每粒占 40% 航程。 */
export function beamParticleProgress(stream: number, i: number, total: number): number {
  const start = (i / total) * 0.6;
  return clamp01((stream - start) / 0.4);
}

/** 二次贝塞尔:核心 →(弧线)→ 卡片锚点;ctrl 为弓高偏移。 */
export function beamArcPoint(
  t: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  bow: number,
): { x: number; y: number } {
  const narrowBow = from.x === to.x ? Math.max(-12, Math.min(12, bow)) : bow;
  const mx = (from.x + to.x) / 2 + narrowBow;
  const my = (from.y + to.y) / 2;
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * mx + t * t * to.x,
    y: u * u * from.y + 2 * u * t * my + t * t * to.y,
  };
}

/* ---------------------------------------------------------------- 振幅 */

/**
 * 8a 演示振幅合成(确定性,可单测)。8c 换 Web Audio AnalyserNode 数值,
 * 粒子层只吃 [0,1] 标量——本函数届时仅作回退。
 */
export function synthAmplitude(tMs: number, seed = 0): number {
  const t = tMs / 1000;
  const v =
    0.5 +
    0.22 * Math.sin(t * 2.1 + seed * 1.7) +
    0.16 * Math.sin(t * 3.7 + seed * 4.1) +
    0.12 * Math.sin(t * 6.3 + seed * 2.3);
  return clamp01(v);
}

/** TTS 播报感的包络:语句节奏(约 2.8s 一句)调制的振幅。 */
export function synthSpeechAmplitude(tMs: number, seed = 7): number {
  const t = tMs / 1000;
  const phrase = Math.max(0, Math.sin((t % 2.8) * Math.PI)); // 句内起伏
  return clamp01(phrase * (0.35 + 0.65 * synthAmplitude(tMs, seed)));
}

/* ---------------------------------------------------------------- 伪 3D 轨道核心(参照 Iron Man JARVIS 陀螺环系) */

/** 确定性 PRNG:环系/核球生成用,固定种子即可复现同一套视觉。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Vec3 = { x: number; y: number; z: number };

export function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** 先绕 Y 轴 yaw、再绕 X 轴 pitch 旋转(弧度)。整球慢翻滚用。 */
export function rotate3(v: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = v.x * cy + v.z * sy;
  const z1 = -v.x * sy + v.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return { x: x1, y: v.y * cp - z1 * sp, z: v.y * sp + z1 * cp };
}

/** 弱透视投影到画布偏移(×scale):z 越大越远,越远越略小;depth∈[0,1],1=最近。 */
export function project3(v: Vec3, scale: number): { x: number; y: number; depth: number } {
  const zPersp = Math.max(-0.6, Math.min(0.6, v.z)); // 透视只在近范围收放,避免畸变
  const persp = 1 / (1 + zPersp * 0.22);
  const zNorm = Math.max(-1, Math.min(1, v.z));
  return { x: v.x * scale * persp, y: v.y * scale * persp, depth: (1 - zNorm) / 2 };
}

/** 轨道环:倾斜平面(正交基 u/v)上的一圈采样点。 */
export type OrbitRing = {
  radius: number; // ×核心基准半径
  u: Vec3;
  v: Vec3;
  spin: number; // 自转角速系数(×全局 spinSpeed)
  phase: number; // 初始相位(rad)
  dots: number; // 采样密度
};

/** 参考图的主环系:7 圈不同倾角/半径的轨道环,半径与圈数固定、倾角随机。 */
export function buildRingSystem(seed: number): OrbitRing[] {
  const rand = mulberry32(seed);
  const defs = [
    { radius: 1.0, dots: 160 },
    { radius: 0.9, dots: 150 },
    { radius: 0.78, dots: 140 },
    { radius: 0.62, dots: 125 },
    { radius: 0.45, dots: 115 },
    { radius: 1.06, dots: 130 },
    { radius: 0.3, dots: 110 },
  ];
  return defs.map((def) => {
    const n = normalize3({ x: rand() * 2 - 1, y: rand() * 2 - 1, z: rand() * 2 - 1 });
    const u = normalize3(cross3(n, { x: 0.31, y: 1, z: 0.13 }));
    const v = cross3(n, u);
    return {
      radius: def.radius,
      u,
      v,
      spin: 0.6 + rand() * 0.9,
      phase: rand() * Math.PI * 2,
      dots: def.dots,
    };
  });
}

/** 中心「虹膜」:3 圈小半径高转速的 steep 环(参考图核心的眼睛)。 */
export function buildIris(seed: number): OrbitRing[] {
  const rand = mulberry32(seed);
  const defs = [
    { radius: 0.13, dots: 70 },
    { radius: 0.17, dots: 70 },
    { radius: 0.22, dots: 70 },
  ];
  return defs.map((def) => {
    const n = normalize3({ x: rand() * 2 - 1, y: rand() * 2 - 1, z: rand() * 2 - 1 });
    const u = normalize3(cross3(n, { x: 1, y: 0.2, z: 0.4 }));
    const v = cross3(n, u);
    return {
      radius: def.radius,
      u,
      v,
      spin: 2.2 + rand() * 1.2,
      phase: rand() * Math.PI * 2,
      dots: def.dots,
    };
  });
}

/** 核球:单位球内的随机点(√rand 保证体积均匀)。 */
export function buildNucleus(seed: number, count: number): Vec3[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const dir = normalize3({ x: rand() * 2 - 1, y: rand() * 2 - 1, z: rand() * 2 - 1 });
    const r = Math.cbrt(rand());
    return { x: dir.x * r, y: dir.y * r, z: dir.z * r };
  });
}

/** 心跳亮度包络:「咚-哒」双峰后间歇,约 1.4s 一周期;0.35 为舒张基线。 */
export function heartbeat(tMs: number): number {
  const period = 1400;
  const t = ((tMs % period) + period) % period / period;
  const beat = (center: number, width: number) =>
    Math.exp(-((t - center) ** 2) / (2 * width * width));
  return clamp01(0.35 + 0.4 * beat(0.1, 0.035) + 0.25 * beat(0.24, 0.045));
}

/** 沿环行波:密度波以 3 个波长绕环流动,叠加在每粒的半径上。 */
export function waveFactor(angle: number, tMs: number, amp = 0.025): number {
  return 1 + amp * Math.sin(angle * 3 - tMs * 0.0022);
}

/* ---------------------------------------------------------------- 状态 → 粒子参数 */

/** 核心基础自转(rad/s);listening 基准,thinking ×3(§6)。 */
const SPIN_BASE = 0.5;

export type CoreVisual = {
  /** waking 成型 0→1 */
  formation: number;
  /** closing 收拢消散 0→1 */
  collapse: number;
  /** 氛围场铺满 0→1(waking 从中心扩散;closing 反向收回) */
  ambientSpread: number;
  /** 氛围漂移速度系数 */
  ambientDrift: number;
  /** 核心半径系数:listening ±12% 呼吸;thinking 内收 8% */
  coreRadius: number;
  /** 自转角速度(rad/s) */
  spinSpeed: number;
  /** 全局亮度(加色混合的总闸) */
  brightness: number;
  /** listening 外圈细环透明度 */
  ringAlpha: number;
  /** followup 能量环剩余比例 1→0;其余状态 null */
  countdown: number | null;
  /** 琥珀火花生成速率(粒/秒;thinking 上飘) */
  sparkRate: number;
  /** 发射脉冲亮度(§7 ①) */
  pulse: number;
  /** 粒子束整体进度(§7 ②);未发射为 0 */
  stream: number;
  /** 发射能量环扩散 0→1(§7 ① 的外圈) */
  pulseRing: number;
};

export type ListenClock = { receivedAt: number; remainingMs: number; timeoutMs: number; paused: boolean };
export type CoreVisualInput = {
  listenClock?: ListenClock | null;
  name: VoiceStateName;
  /** 当前状态进入时刻(ms,performance.now 域) */
  since: number;
  now: number;
  /** 0..1(麦克风/TTS 振幅;demo 为合成值) */
  amplitude: number;
  /** 发射经过 ms;非 answering 传 null */
  launchElapsedMs: number | null;
};

/** §6 表:六状态行为映射的唯一实现。 */
export function coreVisual(input: CoreVisualInput): CoreVisual {
  const visual = stateVisual(input);
  if (input.listenClock !== undefined) {
    const clock = input.listenClock;
    visual.countdown = clock ? clamp01((clock.remainingMs - (clock.paused ? 0 : input.now - clock.receivedAt)) / clock.timeoutMs) : null;
  }
  return visual;
}
function stateVisual(input: CoreVisualInput): CoreVisual {
  const { name, since, now, amplitude } = input;
  const base: CoreVisual = {
    formation: name === "ambient" ? 0 : 1,
    collapse: 0,
    ambientSpread: 1,
    ambientDrift: 1,
    coreRadius: 1,
    spinSpeed: SPIN_BASE,
    brightness: 0.9,
    ringAlpha: 0,
    countdown: null,
    sparkRate: 0,
    pulse: 0,
    stream: 0,
    pulseRing: 0,
  };

  switch (name) {
    case "ambient":
      return { ...base, formation: 0, ambientSpread: 0, brightness: 0 };

    case "waking": {
      // 氛围场从中心扩散铺满,同时汇聚出核心(§6)
      const p = clamp01((now - since) / VOICE_TIMING.wakingMs);
      const formation = easeOutCubic(p);
      return {
        ...base,
        formation,
        ambientSpread: formation,
        ambientDrift: 0.6,
        coreRadius: lerp(0.2, 1, formation) * (1 + 0.06 * amplitude),
        brightness: lerp(0.25, 1, p),
        spinSpeed: 0.6,
      };
    }

    case "listening":
      // 核心振幅驱动半径呼吸(±12%),外圈细环常亮;氛围场缓慢漂移(§6)
      return {
        ...base,
        coreRadius: 1 + 0.12 * amplitude,
        ringAlpha: 0.85,
        brightness: 0.85 + 0.15 * amplitude,
        ambientDrift: 1,
      };

    case "thinking":
      // 自转 3 倍速,核心内收 8%,琥珀火花上飘(§6)
      return {
        ...base,
        spinSpeed: SPIN_BASE * 3,
        coreRadius: 0.92,
        brightness: 1,
        sparkRate: 26,
        ambientDrift: 0.7,
      };

    case "answering": {
      // 发射脉冲 + 粒子束;播报期核心随振幅微幅律动(§6/§7)
      const ph = input.launchElapsedMs == null ? null : launchPhase(input.launchElapsedMs);
      return {
        ...base,
        coreRadius: 0.75 * (1 + 0.04 * amplitude),
        brightness: 1,
        pulse: ph ? ph.pulse : 0,
        stream: ph ? ph.stream : 0,
        pulseRing: ph ? clamp01(input.launchElapsedMs! / 600) : 0,
      };
    }

    case "followup": {
      // 回落缓慢呼吸;外圈能量环随真实聆听窗口递减(§6)
      const countdown = clamp01(
        1 - (now - since) / VOICE_TIMING.longListenMs,
      );
      const slow = 0.5 + 0.5 * Math.sin((now - since) / 1000 * 1.6);
      return {
        ...base,
        coreRadius: 0.75 * (1 + 0.05 * slow * (0.4 + 0.6 * amplitude)),
        brightness: 0.85,
        ringAlpha: 0.4,
        countdown,
        ambientDrift: 0.8,
      };
    }

    case "closing": {
      // 核心与氛围场向中心收拢消散(§6;收拢 600ms ⊂ closing 800ms)
      const q = clamp01((now - since) / 600);
      return {
        ...base,
        collapse: easeInCubic(q),
        ambientSpread: 1 - q,
        coreRadius: lerp(1, 0.1, easeInOutCubic(q)),
        brightness: 1 - q,
        ambientDrift: 0.4,
      };
    }

    case "error-fallback":
      // 降级:暗、慢、无火花——读得出「不对劲」但不吓人
      return {
        ...base,
        brightness: 0.7,
        ringAlpha: 0.5,
        spinSpeed: SPIN_BASE * 0.6,
        ambientDrift: 0.5,
      };
  }
}

/** 会话快照:回放器每帧喂给画布的最小状态(避免画布感知 reducer 细节)。 */
export type VoiceFrame = {
  listenClock?: ListenClock | null;
  name: VoiceStateName;
  since: number;
  /** 返回当前振幅(0..1) */
  amplitude: (nowMs: number) => number;
  /** 答案卡发射起点(performance.now 域);未发射为 null */
  launchAt: number | null;
  /** 卡片折叠吸回起点(closing 进入时刻);非 closing 为 null(§5) */
  foldAt: number | null;
  geometry: OverlayGeometry;
};
