import { describe, expect, it } from "vitest";
import {
  approach,
  beamArcPoint,
  beamParticleProgress,
  buildIris,
  buildNucleus,
  buildRingSystem,
  clamp01,
  coreRadiusFor,
  coreVisual,
  easeOutCubic,
  foldProgress,
  heartbeat,
  LAUNCH,
  launchPhase,
  lerp,
  overlayGeometry,
  PARTICLE_BUDGET,
  project3,
  rgba,
  rotate3,
  synthAmplitude,
  synthSpeechAmplitude,
  typedChars,
  waveFactor,
  type LaunchConfig,
  type Vec3,
} from "./params";
import { VOICE_TIMING } from "./session-machine";

describe("缓动基础", () => {
  it("clamp01 有界;lerp 线性;easeOutCubic 端点正确且单调", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // 先快后慢
  });

  it("rgba 按 §2 色板通道拼装", () => {
    expect(rgba([201, 127, 61], 0.5)).toBe("rgba(201,127,61,0.5)");
  });

  it("approach:指数趋近,τ 处到达 63%,收敛且帧率无关", () => {
    expect(approach(0, 1, 0, 250)).toBe(0); // 零时长不动
    expect(approach(5, 1, 100, 0)).toBe(1); // τ=0 直达目标
    const atTau = approach(0, 1, 250, 250);
    expect(atTau).toBeGreaterThan(0.63);
    expect(atTau).toBeLessThan(0.635);
    // 两个半 τ 等效于一次全 τ,证明指数性
    expect(approach(approach(0, 1, 125, 250), 1, 125, 250)).toBeCloseTo(atTau, 10);
    // 单调逼近且不过冲
    let x = 0;
    let prev = 0;
    for (let t = 0; t < 2000; t += 16) {
      x = approach(x, 1, 16, 220);
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(x).toBeLessThanOrEqual(1);
      prev = x;
    }
    expect(prev).toBeGreaterThan(0.999);
  });

  it("foldProgress:卡片吸回 200ms 线性有界,规格常量生效", () => {
    expect(foldProgress(-1)).toBe(0);
    expect(foldProgress(0)).toBe(0);
    expect(foldProgress(VOICE_TIMING.foldMs)).toBe(1);
    expect(foldProgress(9999)).toBe(1);
    expect(foldProgress(100, 0)).toBe(1); // foldMs<=0 视为立即完成
  });
});

describe("overlayGeometry(§5 落位)", () => {
  it("1080p 下核心落在 (960,470),卡片锚点在核心正下方、宽 720", () => {
    const g = overlayGeometry(1920, 1080);
    expect(g.core).toEqual({ x: 960, y: 470 });
    expect(g.cardAnchor.x).toBe(960);
    expect(g.cardAnchor.y).toBeCloseTo(685.8, 1); // 0.635 × 1080,卡体 ~360px 全卡可见
    expect(g.cardAnchor.width).toBe(720);
    expect(coreRadiusFor(1920, 1080)).toBeCloseTo(150.12, 1);
  });

  it("小视口收窄卡片宽度并保持比例落位", () => {
    const g = overlayGeometry(800, 600);
    expect(g.cardAnchor.width).toBe(720); // 800×0.9=720,恰好等于上限
    const g2 = overlayGeometry(600, 500);
    expect(g2.cardAnchor.width).toBe(540); // 600×0.9
    expect(g2.core).toEqual({ x: 300, y: 500 * (470 / 1080) });
  });
});

describe("发射编排时序(§7,验收:各步参数可调)", () => {
  it("默认配置:①脉冲 120ms → ②粒子束 350ms → ③展开 250ms,总编排 <700ms 接打字机", () => {
    const p0 = launchPhase(0);
    expect(p0.pulse).toBe(0);
    expect(p0.stream).toBe(0);
    expect(p0.unfold).toBe(0);
    expect(p0.typingMs).toBeLessThan(0);

    const afterPulse = launchPhase(LAUNCH.pulseMs);
    expect(afterPulse.pulse).toBe(1);
    expect(afterPulse.stream).toBeGreaterThan(0); // 与脉冲轻微重叠
    expect(afterPulse.unfold).toBe(0);

    const midStream = launchPhase(LAUNCH.streamStartMs + LAUNCH.streamMs / 2);
    expect(midStream.stream).toBeCloseTo(0.5, 5);

    const afterStream = launchPhase(LAUNCH.streamStartMs + LAUNCH.streamMs);
    expect(afterStream.stream).toBe(1);

    const unfoldDone = launchPhase(LAUNCH.unfoldStartMs + LAUNCH.unfoldMs);
    expect(unfoldDone.unfold).toBe(1);
    expect(unfoldDone.typingMs).toBe(0); // 打字机恰在展开完成时接续
    expect(LAUNCH.unfoldStartMs + LAUNCH.unfoldMs).toBeLessThan(700);
  });

  it("自定义配置即改即生效(时序参数化)", () => {
    const cfg: LaunchConfig = {
      pulseMs: 60,
      streamStartMs: 0,
      streamMs: 200,
      unfoldStartMs: 150,
      unfoldMs: 100,
      typeCps: 100,
      barMs: 300,
    };
    expect(launchPhase(60, cfg).pulse).toBe(1);
    expect(launchPhase(100, cfg).stream).toBe(0.5);
    expect(launchPhase(250, cfg).unfold).toBe(1);
    expect(launchPhase(251, cfg).typingMs).toBe(1);
  });

  it("typedChars 按字/秒单调推进且有界", () => {
    const text = "先生,本月合同额 ¥1,286.0万,完成月度目标的百分之八十五点七。".repeat(2);
    expect(typedChars(text, -1)).toBe(0);
    expect(typedChars(text, 0)).toBe(0);
    const at1s = typedChars(text, 1000);
    const at2s = typedChars(text, 2000);
    expect(at2s).toBeGreaterThan(at1s); // 未到截断前随时间推进
    expect(typedChars(text, 100_000)).toBe(text.length);
    expect(typedChars(text, 1000, 50)).toBe(Math.min(text.length, 50));
  });

  it("粒子束:120 粒错峰出发,每粒走完整航程;弧线中点带弓高", () => {
    expect(beamParticleProgress(0, 0, PARTICLE_BUDGET.beam)).toBe(0);
    // 第 0 粒最先出发
    expect(beamParticleProgress(0.3, 0, 120)).toBeGreaterThan(
      beamParticleProgress(0.3, 119, 120),
    );
    // 整体进度 1 时所有粒子到站
    for (let i = 0; i < 120; i += 17) {
      expect(beamParticleProgress(1, i, 120)).toBe(1);
    }
    // 整体进度 0 时所有粒子未出发
    for (let i = 0; i < 120; i += 17) {
      expect(beamParticleProgress(0, i, 120)).toBe(0);
    }

    const from = { x: 960, y: 470 };
    const to = { x: 960, y: 777 };
    const mid = beamArcPoint(0.5, from, to, 120);
    // 二次贝塞尔中点弓高为 bow/2:960 + 60 = 1020
    expect(mid.x).toBeCloseTo(1020, 5);
    expect(mid.y).toBeCloseTo(623.5, 5);
    expect(beamArcPoint(0, from, to, 120)).toEqual(from);
    expect(beamArcPoint(1, from, to, 120)).toEqual(to);
  });
});

describe("振幅合成", () => {
  it("确定、有界 [0,1]", () => {
    for (let t = 0; t < 5000; t += 37) {
      const v = synthAmplitude(t, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBe(synthAmplitude(t, 3)); // 确定性
    }
  });

  it("播报包络同样有界,且随句内相位起伏", () => {
    for (let t = 0; t < 6000; t += 41) {
      const v = synthSpeechAmplitude(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("coreVisual — §6 六状态行为映射", () => {
  const at = (name: Parameters<typeof coreVisual>[0]["name"], since: number, now: number, amplitude = 0.5, launch: number | null = null) =>
    coreVisual({ name, since, now, amplitude, launchElapsedMs: launch });

  it("waking:900ms 内从中心成型铺满,亮度爬升", () => {
    const early = at("waking", 1000, 1000 + 200);
    const mid = at("waking", 1000, 1000 + 450);
    const done = at("waking", 1000, 1000 + VOICE_TIMING.wakingMs);
    expect(early.formation).toBeLessThan(mid.formation);
    expect(done.formation).toBe(1);
    expect(done.ambientSpread).toBe(1);
    expect(done.brightness).toBe(1);
    expect(early.brightness).toBeGreaterThan(0.25);
  });

  it("listening:振幅驱动 ±12% 半径呼吸,外圈细环常亮", () => {
    expect(at("listening", 0, 100, 0).coreRadius).toBe(1);
    expect(at("listening", 0, 100, 1).coreRadius).toBeCloseTo(1.12, 5);
    expect(at("listening", 0, 100, 0.5).ringAlpha).toBeGreaterThan(0);
    expect(at("listening", 0, 100, 0.5).sparkRate).toBe(0);
  });

  it("thinking:自转 3 倍速、内收 8%、火花上飘", () => {
    const listen = at("listening", 0, 100, 0.5);
    const think = at("thinking", 0, 100, 0.5);
    expect(think.spinSpeed).toBeCloseTo(listen.spinSpeed * 3, 10);
    expect(think.coreRadius).toBeCloseTo(0.92, 10);
    expect(think.sparkRate).toBeGreaterThan(0);
  });

  it("answering:脉冲→粒子束随发射时序推进,核心微幅律动", () => {
    const early = at("answering", 0, 100, 0.5, 0);
    expect(early.pulse).toBe(0);
    const mid = at("answering", 0, 100, 0.5, 275); // 束程中点(100+350/2)
    expect(mid.stream).toBeCloseTo(0.5, 5);
    const done = at("answering", 0, 100, 0.5, 700);
    expect(done.stream).toBe(1);
    expect(done.pulseRing).toBe(1);
    // 振幅只动 ±4%(微幅律动)
    expect(at("answering", 0, 100, 1, 0).coreRadius).toBeCloseTo(1.04, 5);
  });

  it("followup:能量环 8s 线性递减,8s 整归零", () => {
    const start = at("followup", 5000, 5000);
    expect(start.countdown).toBe(1);
    expect(at("followup", 5000, 5000 + VOICE_TIMING.longListenMs / 2).countdown).toBeCloseTo(0.5, 5);
    expect(at("followup", 5000, 5000 + VOICE_TIMING.longListenMs).countdown).toBe(0);
    expect(at("followup", 5000, 15000).countdown).toBe(0); // 不为负
    expect(start.ringAlpha).toBeGreaterThan(0);
  });

  it("closing:600ms 收拢消散,亮度与铺满度归零", () => {
    const early = at("closing", 1000, 1000 + 100);
    const done = at("closing", 1000, 1000 + 600);
    expect(early.collapse).toBeLessThan(done.collapse);
    expect(done.collapse).toBe(1);
    expect(done.ambientSpread).toBe(0);
    expect(done.brightness).toBe(0);
    expect(done.coreRadius).toBeCloseTo(0.1, 5);
  });

  it("error-fallback:降级态暗速慢转、无火花;ambient 全零(画布不该被挂载)", () => {
    const err = at("error-fallback", 0, 100, 0.5);
    expect(err.brightness).toBeLessThan(0.9);
    expect(err.spinSpeed).toBeLessThan(at("listening", 0, 100, 0.5).spinSpeed);
    expect(err.sparkRate).toBe(0);

    const amb = at("ambient", 0, 100, 0.5);
    expect(amb).toMatchObject({ formation: 0, ambientSpread: 0, brightness: 0 });
  });
});

describe("伪 3D 轨道核心(参照 Iron Man JARVIS)", () => {
  const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

  it("rotate3:绕 Y 轴 90° 把 +x 转到 -z;模长不变;2π 周期", () => {
    const r = rotate3({ x: 1, y: 0.5, z: 0 }, Math.PI / 2, 0);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.y).toBeCloseTo(0.5, 10);
    expect(r.z).toBeCloseTo(-1, 10);
    const v = { x: 0.3, y: -0.8, z: 0.52 };
    expect(len(rotate3(v, 1.2, -0.7))).toBeCloseTo(len(v), 10);
    for (const k of [0, 1, 2.5]) {
      const a = rotate3(v, k, k / 2);
      const b = rotate3(v, k + Math.PI * 2, k / 2);
      expect(a.x).toBeCloseTo(b.x, 10);
      expect(a.y).toBeCloseTo(b.y, 10);
      expect(a.z).toBeCloseTo(b.z, 10);
    }
  });

  it("project3:depth∈[0,1],近大远小,z 超界被钳制", () => {
    const near = project3({ x: 0.5, y: 0, z: -1 }, 100);
    const far = project3({ x: 0.5, y: 0, z: 1 }, 100);
    expect(near.depth).toBe(1);
    expect(far.depth).toBe(0);
    expect(Math.hypot(near.x, near.y)).toBeGreaterThan(Math.hypot(far.x, far.y));
    const beyond = project3({ x: 1, y: 0, z: 5 }, 100); // z 远超 1 → depth 到底
    expect(beyond.depth).toBe(0);
  });

  it("buildRingSystem:确定性、7 圈、正交基、半径带内、点数合计≈930", () => {
    const a = buildRingSystem(0x51a2);
    const b = buildRingSystem(0x51a2);
    expect(a).toEqual(b);
    expect(a).toHaveLength(7);
    let dots = 0;
    for (const ring of a) {
      expect(ring.radius).toBeGreaterThanOrEqual(0.25);
      expect(ring.radius).toBeLessThanOrEqual(1.1);
      expect(Math.hypot(ring.u.x, ring.u.y, ring.u.z)).toBeCloseTo(1, 6);
      expect(Math.hypot(ring.v.x, ring.v.y, ring.v.z)).toBeCloseTo(1, 6);
      expect(ring.u.x * ring.v.x + ring.u.y * ring.v.y + ring.u.z * ring.v.z).toBeCloseTo(0, 6);
      dots += ring.dots;
    }
    expect(dots).toBe(930);
  });

  it("buildIris / buildNucleus:确定性且有界", () => {
    const iris = buildIris(0x777);
    expect(iris).toEqual(buildIris(0x777));
    expect(iris).toHaveLength(3);
    for (const ring of iris) {
      expect(ring.radius).toBeLessThan(0.25);
      expect(ring.spin).toBeGreaterThan(2); // 高转速
    }
    const n1 = buildNucleus(0x9e37, 550);
    const n2 = buildNucleus(0x9e37, 550);
    expect(n1).toEqual(n2);
    expect(n1).toHaveLength(550);
    for (const p of n1) {
      expect(len(p)).toBeLessThanOrEqual(1);
    }
  });

  it("heartbeat:「咚-哒」双峰,间歇回落基线,周期 1.4s,有界", () => {
    const peak1 = heartbeat(140); // 第一峰(0.10 × 1400)
    const peak2 = heartbeat(336); // 第二峰(0.24 × 1400)
    const rest = heartbeat(800); // 间歇期
    expect(peak1).toBeGreaterThan(0.7);
    expect(peak2).toBeGreaterThan(0.55);
    expect(peak1).toBeGreaterThan(rest);
    expect(rest).toBeCloseTo(0.35, 1);
    expect(heartbeat(140)).toBe(heartbeat(140 + 1400));
    for (let t = 0; t < 2800; t += 17) {
      const v = heartbeat(t);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("waveFactor:幅度 1±amp,沿环 2π/3 周期", () => {
    expect(waveFactor(0, 1000)).toBeCloseTo(waveFactor(Math.PI * 2 / 3, 1000), 10);
    expect(waveFactor(0, 1000)).toBeCloseTo(1 + 0.025 * Math.sin(-2.2), 10);
    for (let a = 0; a < 6.28; a += 0.13) {
      const v = waveFactor(a, 4321);
      expect(v).toBeGreaterThanOrEqual(1 - 0.025);
      expect(v).toBeLessThanOrEqual(1 + 0.025);
    }
  });
});

describe("lerp/边界", () => {
  it("lerp 外插仍线性(供 waking 半径爬坡等使用)", () => {
    expect(lerp(0.2, 1, 0)).toBeCloseTo(0.2, 10);
    expect(lerp(0.2, 1, 1)).toBeCloseTo(1, 10);
  });
});
