"use client";

import type { XiaochuanTimeline } from "./motion/XiaochuanTimeline";
import { memo, useEffect, useRef } from "react";
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
  DPR_CAP,
  easeInOutCubic,
  easeOutCubic,
  FIELD_BG,
  FRAME_BUDGET_MS,
  foldProgress,
  heartbeat,
  lerp,
  mulberry32,
  normalize3,
  PALETTE,
  PARTICLE_BUDGET,
  project3,
  RESOLUTION_SCALE,
  rgba,
  rotate3,
  waveFactor,
  type CoreVisual,
  type Vec3,
  type VoiceFrame,
} from "@/lib/voice/params";

/**
 * 贾维斯核心(Canvas 2D 粒子系统,plan §6;视觉参照 Iron Man JARVIS 陀螺环系)。
 *
 * 结构:一个全屏 canvas,四组粒子池——
 *   core    约 2000 粒的 3D 轨道系统:7 圈不同倾角的轨道环(各向同性旋转、
 *           深度明暗、沿环行波)+ 核球 + 中心高速「虹膜」小环 + 辐条 +
 *           彗尾游丝 + 外缘散粒;整球随状态呼吸/自转/内收/收拢;
 *   ambient 约 3000 粒:全屏氛围场,waking 从中心扩散、closing 收回;
 *   sparks  64 粒小池:thinking 琥珀火花上飘;
 *   beam   120 粒:§7 第 2 步,沿弧线从核心流向答案卡锚点。
 *
 * 3D 是投影意义上的(Canvas 2D):每帧对单位球上的点做 yaw/pitch 旋转
 * 后弱透视投影,近亮远暗、近大远小;加色混合下无需 z 排序。数学全部在
 * params.ts(单测覆盖);这里只做积分与绘制。
 *
 * 性能红线(§6):DPR 封顶 1.5;独立 rAF,本组件卸载即全部停止,
 * 覆盖层关闭时连 canvas 节点都不存在——基线零开销;实测帧增量超 8ms
 * 时氛围场隔点降采样、核心隔点采样。粒子渲染用预渲染光点 sprite。
 */

/** 光点 tone 索引:0=copper 1=core 2=ember。 */
type Tone = 0 | 1 | 2;

type Mote = {
  u: number; // 屏幕单位坐标 0..1
  v: number;
  vu: number; // 漂移速度(单位/秒)
  vv: number;
  size: number;
  alpha: number;
  tone: 0 | 1 | 2;
};

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 剩余寿命(秒)
  maxLife: number;
  size: number;
};

/* memo:回放器每 130ms 的 PARTIAL 自环不应触发画布组件重渲染 */
export const JarvisCore = memo(function JarvisCore({
  frameRef,
  motion: choreography = null,
  reduced = false,
  stateKey,
  quality = "high",
}: {
  frameRef: React.RefObject<VoiceFrame>;
  motion?: XiaochuanTimeline | null;
  reduced?: boolean;
  stateKey?: string;
  /** lite=强制降级档(&lite=1,软件渲染环境预览演示用) */
  quality?: "high" | "lite";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const staticState = reduced ? stateKey : undefined;
  useEffect(() => {
    void staticState;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;


    /* ---- 背景缓存:渐隐拖尾用的近黑,预解析成 rgba 字符串 ---- */
    const bgFade = (() => {
      const n = 10; // #0A0806
      return `rgba(${n},${8},${6},${reduced ? 1 : 0.5})`;
    })();

    /* ---- 光点 sprite:三种色相各一张(径向渐变,中心实、边缘散) ---- */
    const makeDot = (channel: readonly number[]) => {
      const s = 24;
      const c = document.createElement("canvas");
      c.width = s;
      c.height = s;
      const g = c.getContext("2d");
      if (g) {
        const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grad.addColorStop(0, rgba(channel, 1));
        grad.addColorStop(0.35, rgba(channel, 0.55));
        grad.addColorStop(1, rgba(channel, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
      }
      return c;
    };
    const sprites = [makeDot(PALETTE.copper), makeDot(PALETTE.core), makeDot(PALETTE.ember)];

    /* ---- 粒子池(固定预算,一次性生成;种子固定,粒感可复现) ---- */
    const rand = mulberry32(0xc97f3d);
    const ringSystem = buildRingSystem(0x51a2);
    const ringDots = ringSystem.map((ring) =>
      Array.from({ length: ring.dots }, (_, i) => ({
        a: (i / ring.dots) * Math.PI * 2,
        jr: 1 + (rand() - 0.5) * 0.06, // 径向抖动:不规则但不散
        size: 1.1 + rand() * 1.9,
        alpha: 0.3 + rand() * 0.45,
        tone: (rand() < 0.66 ? 0 : rand() < 0.55 ? 1 : 2) as Tone,
        tw: rand() * Math.PI * 2,
      })),
    );
    const nucleus = buildNucleus(0x9e37, 550).map((p) => ({
      p,
      size: 1.4 + rand() * 2.2,
      alpha: 0.25 + rand() * 0.5,
      tone: (rand() < 0.5 ? 1 : 0) as Tone,
      tw: rand() * Math.PI * 2,
    }));
    const iris = buildIris(0x777);
    const strays = Array.from({ length: 90 }, () => ({
      dir: normalize3({ x: rand() * 2 - 1, y: rand() * 2 - 1, z: rand() * 2 - 1 }),
      r: 1.02 + rand() * 0.26,
      size: 1 + rand() * 1.8,
      alpha: 0.05 + rand() * 0.1,
    }));
    const orbiters = Array.from({ length: 34 }, (_, i) => ({
      ri: i % ringSystem.length,
      a: rand() * Math.PI * 2,
      speed: 1.3 + rand() * 1.6,
      rj: 0.96 + rand() * 0.08,
      size: 1.6 + rand() * 1.6,
      trail: [] as Array<{ x: number; y: number }>,
    }));
    const ambient: Mote[] = Array.from({ length: PARTICLE_BUDGET.ambient }, () => {
      const r = rand();
      return {
        u: rand(),
        v: rand(),
        vu: (rand() - 0.5) * 0.012,
        vv: (rand() - 0.5) * 0.008,
        size: 1 + rand() * 2.6,
        alpha: 0.08 + rand() * 0.3,
        tone: r < 0.6 ? 2 : r < 0.92 ? 0 : 1, // 氛围场以暗铜为主
      };
    });
    const sparks: Spark[] = Array.from({ length: PARTICLE_BUDGET.sparks }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 2,
    }));
    const beamSeeds = Array.from({ length: PARTICLE_BUDGET.beam }, (_, i) => ({
      bowSign: i % 2 === 0 ? 1 : -1,
      bow: 70 + ((i * 37) % 90),
      size: 2 + ((i * 13) % 17) / 10,
    }));

    /* ---- 画布尺寸(DPR 封顶 1.5,渲染分辨率按降采样系数收;lite 再收一档) ---- */
    let dpr = 1;
    const qualityScale = quality === "lite" ? 0.6 : 1;
    /* 辉光垫底离屏缓存:两个大面积径向渐变每帧重建是最大的单帧开销,
       改为只在 resize 时绘制一次,帧内按亮度 drawImage。 */
    let glowCache: HTMLCanvasElement | null = null;
    let glowSize = 0; // 缓存覆盖的 CSS 尺寸(R*5.8 见下)
    const buildGlow = (radius: number) => {
      glowSize = radius * 5.8;
      const c = document.createElement("canvas");
      // 辉光是纯模糊,烘焙分辨率减半肉眼不可辨,省一半采样
      c.width = Math.max(2, Math.round(glowSize * dpr * 0.5));
      c.height = c.width;
      const g = c.getContext("2d");
      if (g) {
        const half = c.width / 2;
        const glow = g.createRadialGradient(half, half, 0, half, half, half);
        glow.addColorStop(0, rgba(PALETTE.copper, 0.13));
        glow.addColorStop(0.5, rgba(PALETTE.ember, 0.07));
        glow.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = glow;
        g.fillRect(0, 0, c.width, c.height);
        const hot = g.createRadialGradient(half, half, 0, half, half, half * 0.31);
        hot.addColorStop(0, rgba(PALETTE.core, 0.2));
        hot.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = hot;
        g.fillRect(0, 0, c.width, c.height);
      }
      glowCache = c;
    };

    /* 氛围场烘焙层:稳态下 3000 粒逐粒 drawImage 的调用开销(~5µs/次)
       远超像素开销,先把各半的 motes 烘成两张全屏贴图,帧内平铺滚动
       (4 次 drawImage);waking/closing 扩散期才回退到逐粒路径。 */
    let ambientTiles: Array<{ canvas: HTMLCanvasElement; speedX: number; speedY: number; alpha: number }> = [];
    const buildAmbientTiles = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const speeds = [
        { speedX: 11, speedY: 4.5, alpha: 1 },
        { speedX: -7, speedY: 6, alpha: 0.85 },
      ];
      ambientTiles = speeds.map((speed, layerIndex) => {
        const c = document.createElement("canvas");
        // 氛围贴图是低对比暗部,烘焙分辨率再收 40%,drawImage 负责放大
        const tileDpr = dpr * 0.6;
        c.width = Math.max(2, Math.round(w * tileDpr));
        c.height = Math.max(2, Math.round(h * tileDpr));
        const g = c.getContext("2d");
        if (g) {
          g.setTransform(tileDpr, 0, 0, tileDpr, 0, 0);
          for (let i = layerIndex; i < ambient.length; i += 2) {
            const m = ambient[i];
            const s = m.size;
            g.globalAlpha = m.alpha;
            g.drawImage(sprites[m.tone], m.u * w - s, m.v * h - s, s * 2, s * 2);
          }
        }
        return { canvas: c, ...speed };
      });
    };

    let repaintStatic = () => {};
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP) * RESOLUTION_SCALE * qualityScale;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = FIELD_BG;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      buildGlow(coreRadiusFor(window.innerWidth, window.innerHeight));
      buildAmbientTiles();
      if (reduced) repaintStatic();
    };
    resize();
    window.addEventListener("resize", resize);

    /* ---- 主循环 ---- */
    let raf = 0;
    let disposed = false;
    let spin = 0;
    let yaw = 0.6;
    let irisSpin = 0;
    let last = performance.now();
    let sparkAcc = 0;
    let costEma = 0;
    let ambientStride = 1;
    let coreHalf = false;
    let corePhase = 0;

    /* A1 平滑层:状态切换时参数滑行而非跳变(画布在 waking 挂载,初值取成形起点) */
    const smooth = {
      coreRadius: 0.2,
      brightness: 0,
      ringAlpha: 0,
      spinSpeed: 0.5,
      ambientDrift: 0.6,
      sparkRate: 0,
      ambientSpread: 0,
      formation: 0,
      countdownAlpha: 0,
    };

    const loop = (now: number) => {
      if (disposed) return;
      if (!reduced) raf = requestAnimationFrame(loop);

      const frame = frameRef.current;
      const dt = reduced ? 1 : Math.min(0.064, (now - last) / 1000);
      last = now;

      const g = frame.geometry;
      const cx = g.core.x;
      const cy = g.core.y;
      const R = coreRadiusFor(g.width, g.height);
      const target = coreVisual({
        listenClock: frame.listenClock,
        name: frame.name,
        since: frame.since,
        now,
        amplitude: clamp01(frame.amplitude(now)),
        launchElapsedMs: frame.launchAt == null ? null : now - frame.launchAt,
      });

      if (choreography) {
        const visual = choreography.visual;
        Object.assign(choreography.canvasSample, { at: now, pulse: visual.pulse, stream: visual.stream, unfold: visual.unfold, fold: visual.fold });
        target.pulse = frame.name === "answering" ? visual.pulse : 0;
        target.stream = frame.name === "answering" ? visual.stream : 0;
        if (frame.name === "waking") { target.formation = visual.formation; target.ambientSpread = visual.formation; }
        if (frame.name === "closing") target.collapse = visual.collapse;
        if (frame.name === "answering") target.brightness = .85 + .15 * clamp01(frame.amplitude(now));
      }
      /* A1:标量滑行(τ 按感知调);发射时序与倒计时数值保持精确不平滑 */
      const dtMs = dt * 1000;
      if (reduced) Object.assign(smooth, target, { formation: 1, brightness: 1 });
      smooth.coreRadius = approach(smooth.coreRadius, target.coreRadius, dtMs, 220);
      smooth.brightness = approach(smooth.brightness, target.brightness, dtMs, 260);
      smooth.ringAlpha = approach(smooth.ringAlpha, target.ringAlpha, dtMs, 320);
      smooth.spinSpeed = approach(smooth.spinSpeed, target.spinSpeed, dtMs, 450);
      smooth.ambientDrift = approach(smooth.ambientDrift, target.ambientDrift, dtMs, 420);
      smooth.sparkRate = approach(smooth.sparkRate, target.sparkRate, dtMs, 300);
      smooth.ambientSpread = approach(smooth.ambientSpread, target.ambientSpread, dtMs, 280);
      smooth.formation = approach(smooth.formation, target.formation, dtMs, 240);
      smooth.countdownAlpha = approach(
        smooth.countdownAlpha,
        target.countdown != null ? 1 : 0,
        dtMs,
        240,
      );
      const v: CoreVisual = {
        ...target,
        coreRadius: smooth.coreRadius,
        brightness: smooth.brightness,
        ringAlpha: smooth.ringAlpha,
        spinSpeed: smooth.spinSpeed,
        ambientDrift: smooth.ambientDrift,
        sparkRate: smooth.sparkRate,
        ambientSpread: smooth.ambientSpread,
        formation: smooth.formation,
      };

      const motion = reduced ? 0 : 1;
      spin += v.spinSpeed * motion * dt;
      yaw += (0.1 + v.spinSpeed * 0.06) * motion * dt; // 整球慢翻滚:3D 深度的来源
      irisSpin += (0.6 + v.spinSpeed * 0.5) * motion * dt;
      // 心跳亮度:「咚-哒」双峰后间歇,核心有可见的活体节律
      const bright = v.brightness * (0.72 + 0.38 * heartbeat(now)) * (1 + 0.55 * v.pulse);
      const w = g.width;
      const h = g.height;

      /* 底:半透明近黑盖出拖尾(reduced-motion 直接盖死) */
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = bgFade;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";

      /* 中心辉光垫底:离屏缓存,帧内按亮度一次 drawImage */
      if (bright > 0.01 && glowCache) {
        ctx.globalAlpha = clamp01(bright);
        ctx.drawImage(glowCache, cx - glowSize / 2, cy - glowSize / 2, glowSize, glowSize);
        ctx.globalAlpha = 1;
      }

      /* 氛围场:稳态走烘焙贴图平铺(4 次调用);waking 扩散/closing 收拢
         (spread≠1)回退逐粒路径,配合自适应步进护住帧预算 */
      const spread = easeOutCubic(v.ambientSpread);
      if (spread >= 0.999 && ambientTiles.length > 0) {
        const flicker = reduced ? 1 : 0.92 + 0.08 * Math.sin(now * 0.0009);
        for (const layer of ambientTiles) {
          const ox = (((motion * now * 0.001 * layer.speedX) % w) + w) % w;
          const oy = (((motion * now * 0.001 * layer.speedY) % h) + h) % h;
          ctx.globalAlpha = v.brightness * layer.alpha * flicker;
          for (const dx of [ox - w, ox]) {
            for (const dy of [oy - h, oy]) {
              ctx.drawImage(layer.canvas, dx, dy, w, h);
            }
          }
        }
        ctx.globalAlpha = 1;
      } else {
        const alphaFloor = spread * spread; // 中心聚合期压暗,避免热点
        for (let i = 0; i < ambient.length; i += ambientStride) {
          const m = ambient[i];
          m.u += m.vu * v.ambientDrift * motion * dt;
          m.v += m.vv * v.ambientDrift * motion * dt;
          if (m.u < 0) m.u += 1;
          if (m.u > 1) m.u -= 1;
          if (m.v < 0) m.v += 1;
          if (m.v > 1) m.v -= 1;
          const px = cx + (m.u * w - cx) * spread;
          const py = cy + (m.v * h - cy) * spread;
          const twinkle = reduced ? 1 : 0.75 + 0.25 * Math.sin(now * 0.0012 + m.u * 90);
          const a = m.alpha * v.brightness * (alphaFloor + (1 - alphaFloor) * 0.9) * twinkle;
          if (a < 0.012) continue;
          const s = m.size * (0.7 + spread * 0.6);
          ctx.globalAlpha = a;
          ctx.drawImage(sprites[m.tone], px - s, py - s, s * 2, s * 2);
        }
      }

      /* 核心:JARVIS 陀螺环系(3D 投影;加色混合下无需 z 排序)。
         超预算时奇偶帧交替隔点采样(corePhase 提供起始偏移) */
      const radius = R * v.coreRadius;
      corePhase = coreHalf ? corePhase ^ 1 : 0;
      const dotPhase = coreHalf ? corePhase : 0;
      const degrade = coreHalf ? 2 : 1;
      // 整球俯仰缓慢摆动(与 yaw 一起构成翻滚)
      const pitch = 0.34 * Math.sin(now * 0.00019 + 1.2) + 0.18;
      const depthAlpha = (depth: number) => 0.4 + 0.6 * depth;

      // 主环系:7 圈不同倾角的轨道环,深度明暗 + 沿环行波 + 径向微抖
      for (let ri = 0; ri < ringSystem.length; ri++) {
        const ring = ringSystem[ri];
        const dots = ringDots[ri];
        const ringAngle = ring.phase + spin * ring.spin;
        for (let i = dotPhase; i < dots.length; i += degrade) {
          const d = dots[i];
          const a = d.a + ringAngle;
          const rr = ring.radius * radius * waveFactor(d.a, now) * d.jr;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const pr = project3(
            rotate3(
              {
                x: (ring.u.x * ca + ring.v.x * sa) * rr,
                y: (ring.u.y * ca + ring.v.y * sa) * rr,
                z: (ring.u.z * ca + ring.v.z * sa) * rr,
              },
              yaw,
              pitch,
            ),
            1,
          );
          const twinkle = reduced ? 1 : 0.7 + 0.3 * Math.sin(now * 0.0021 + d.tw);
          const alpha = d.alpha * bright * v.formation * depthAlpha(pr.depth) * twinkle;
          if (alpha < 0.012) continue;
          const s = d.size * (0.8 + 0.4 * pr.depth);
          ctx.globalAlpha = alpha;
          ctx.drawImage(sprites[d.tone], cx + pr.x - s, cy + pr.y - s, s * 2, s * 2);
        }
      }

      // 核球:亮核团,跟随整球翻滚
      for (let i = dotPhase; i < nucleus.length; i += degrade) {
        const n = nucleus[i];
        const pr = project3(
          rotate3(
            { x: n.p.x * radius * 0.32, y: n.p.y * radius * 0.32, z: n.p.z * radius * 0.32 },
            yaw,
            pitch,
          ),
          1,
        );
        const twinkle = reduced ? 1 : 0.75 + 0.25 * Math.sin(now * 0.0018 + n.tw);
        const alpha = n.alpha * bright * v.formation * (0.55 + 0.45 * pr.depth) * twinkle;
        if (alpha < 0.012) continue;
        const s = n.size * (0.85 + 0.3 * pr.depth);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[n.tone], cx + pr.x - s, cy + pr.y - s, s * 2, s * 2);
      }

      // 中心虹膜:小半径高转速的三圈「眼睛」
      for (const ring of iris) {
        const ringAngle = ring.phase + irisSpin * ring.spin;
        for (let i = 0; i < ring.dots; i++) {
          const a = (i / ring.dots) * Math.PI * 2 + ringAngle;
          const rr = ring.radius * radius;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const pr = project3(
            rotate3(
              {
                x: (ring.u.x * ca + ring.v.x * sa) * rr,
                y: (ring.u.y * ca + ring.v.y * sa) * rr,
                z: (ring.u.z * ca + ring.v.z * sa) * rr,
              },
              yaw,
              pitch,
            ),
            1,
          );
          const alpha = (0.45 + 0.35 * pr.depth) * bright * v.formation;
          const s = 1.3 + pr.depth * 1.2;
          ctx.globalAlpha = alpha;
          ctx.drawImage(sprites[1], cx + pr.x - s, cy + pr.y - s, s * 2, s * 2);
        }
      }

      // 辐条:两圈轨道平面上的放射细线(参考图里的「经线」感)
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(PALETTE.copper, 1);
      for (let k = 0; k < 10; k++) {
        const ring = ringSystem[k % 2];
        const a = (k / 10) * Math.PI * 2 + spin * 0.4;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const dir: Vec3 = {
          x: ring.u.x * ca + ring.v.x * sa,
          y: ring.u.y * ca + ring.v.y * sa,
          z: ring.u.z * ca + ring.v.z * sa,
        };
        const inner = project3(
          rotate3({ x: dir.x * radius * 0.18, y: dir.y * radius * 0.18, z: dir.z * radius * 0.18 }, yaw, pitch),
          1,
        );
        const outer = project3(
          rotate3({ x: dir.x * radius * 0.92, y: dir.y * radius * 0.92, z: dir.z * radius * 0.92 }, yaw, pitch),
          1,
        );
        ctx.globalAlpha = (0.05 + 0.05 * Math.sin(now * 0.001 + k * 2.1)) * v.formation;
        ctx.beginPath();
        ctx.moveTo(cx + inner.x, cy + inner.y);
        ctx.lineTo(cx + outer.x, cy + outer.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 彗尾游丝:沿轨道快速流动、拖 5 格尾迹的亮粒子(参考图的弧线「笔触」)
      for (const orb of orbiters) {
        const ring = ringSystem[orb.ri];
        orb.a += orb.speed * (0.5 + v.spinSpeed) * motion * dt;
        const rr = ring.radius * radius * orb.rj;
        const ca = Math.cos(orb.a);
        const sa = Math.sin(orb.a);
        const pr = project3(
          rotate3(
            {
              x: (ring.u.x * ca + ring.v.x * sa) * rr,
              y: (ring.u.y * ca + ring.v.y * sa) * rr,
              z: (ring.u.z * ca + ring.v.z * sa) * rr,
            },
            yaw,
            pitch,
          ),
          1,
        );
        orb.trail.unshift({ x: cx + pr.x, y: cy + pr.y });
        if (orb.trail.length > 6) orb.trail.pop();
        for (let ti = 1; ti < orb.trail.length; ti++) {
          const tp = orb.trail[ti];
          const ta = (1 - ti / orb.trail.length) * 0.26 * bright * v.formation;
          if (ta < 0.012) continue;
          const s = orb.size * (1 - ti * 0.12);
          ctx.globalAlpha = ta;
          ctx.drawImage(sprites[0], tp.x - s, tp.y - s, s * 2, s * 2);
        }
        ctx.globalAlpha = 0.5 * bright * v.formation;
        const s = orb.size;
        ctx.drawImage(sprites[1], cx + pr.x - s, cy + pr.y - s, s * 2, s * 2);
      }

      // 外缘散粒:贴着球外缘的暗色杂粒(参考图的松散「笔毛」),慢半拍视差
      for (const st of strays) {
        const pr = project3(
          rotate3(
            { x: st.dir.x * st.r * radius, y: st.dir.y * st.r * radius, z: st.dir.z * st.r * radius },
            yaw * 0.7,
            pitch,
          ),
          1,
        );
        const alpha = st.alpha * bright * v.formation * (0.4 + 0.4 * pr.depth);
        if (alpha < 0.01) continue;
        const s = st.size;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[2], cx + pr.x - s, cy + pr.y - s, s * 2, s * 2);
      }

      /* thinking 琥珀火花上飘 */
      if (v.sparkRate > 0 && !reduced) {
        sparkAcc += (v.sparkRate * dt);
        while (sparkAcc >= 1) {
          sparkAcc -= 1;
          const slot = sparks.find((s) => s.life <= 0);
          if (!slot) break;
          const a = rand() * Math.PI * 2;
          slot.x = cx + Math.cos(a) * radius * (0.5 + rand() * 0.6);
          slot.y = cy + Math.sin(a) * radius * 0.9;
          slot.vx = (rand() - 0.5) * 26;
          slot.vy = -(46 + rand() * 80);
          slot.maxLife = 0.8 + rand() * 0.9;
          slot.life = slot.maxLife;
          slot.size = 1.6 + rand() * 2.2;
        }
      }
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.x += s.vx * motion * dt;
        s.y += s.vy * motion * dt;
        const k = Math.max(0, s.life / s.maxLife);
        ctx.globalAlpha = k * k * 0.9;
        ctx.drawImage(sprites[1], s.x - s.size, s.y - s.size, s.size * 2, s.size * 2);
      }

      /* §7 第 2 步:120 粒沿弧线从核心流向卡片锚点 */
      if (frame.launchAt != null && v.stream > 0 && v.stream < 1.0001) {
        const edge = { x: cx, y: cy + radius * 0.9 };
        const anchor = g.cardAnchor;
        for (let i = 0; i < PARTICLE_BUDGET.beam; i++) {
          const p = beamParticleProgress(v.stream, i, PARTICLE_BUDGET.beam);
          if (p <= 0 || p >= 1) continue;
          const seed = beamSeeds[i];
          const to = { x: anchor.x, y: anchor.y };
          const pos = beamArcPoint(easeInOutCubic(p), edge, to, seed.bowSign * seed.bow);
          const fade = Math.sin(Math.PI * p); // 出发/到站两端渐弱
          ctx.globalAlpha = 0.75 * fade * v.brightness;
          const s = seed.size;
          ctx.drawImage(sprites[1], pos.x - s, pos.y - s, s * 2, s * 2);
          if (!reduced) {
            const tail = beamArcPoint(easeInOutCubic(Math.max(0, p - 0.05)), edge, to, seed.bowSign * seed.bow);
            ctx.globalAlpha = 0.3 * fade * v.brightness;
            ctx.drawImage(sprites[0], tail.x - s * 0.8, tail.y - s * 0.8, s * 1.6, s * 1.6);
          }
        }
        /* 到站微光:束程尾声在锚点亮一小簇,衔接卡片展开 */
        const arrival = clamp01((v.stream - 0.9) / 0.1);
        if (arrival > 0) {
          ctx.globalAlpha = arrival * 0.5;
          ctx.drawImage(sprites[1], anchor.x - 14, anchor.y - 14, 28, 28);
        }
      }

      /* §5 退场:卡片折叠吸回时,一束粒子沿弧线从锚点倒流回核心 */
      if (frame.foldAt != null || (choreography && choreography.visual.fold > 0 && choreography.visual.fold < 1)) {
        const fp = choreography ? choreography.visual.fold : foldProgress(now - frame.foldAt!);
        if (fp > 0 && fp < 1) {
          const anchor = { x: g.cardAnchor.x, y: g.cardAnchor.y };
          const edge = { x: cx, y: cy + radius * 0.9 };
          for (let i = 0; i < PARTICLE_BUDGET.beam; i++) {
            const p = beamParticleProgress(fp, i, PARTICLE_BUDGET.beam);
            if (p <= 0 || p >= 1) continue;
            const seed = beamSeeds[i];
            const pos = beamArcPoint(easeInOutCubic(p), anchor, edge, -seed.bowSign * seed.bow);
            const fade = Math.sin(Math.PI * p);
            ctx.globalAlpha = 0.7 * fade;
            const s = seed.size;
            ctx.drawImage(sprites[1], pos.x - s, pos.y - s, s * 2, s * 2);
          }
        }
      }

      /* 环:listening 细环 / 发射能量环 / followup 3s 倒计时环 */
      ctx.globalAlpha = 1;
      if (v.ringAlpha > 0) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(PALETTE.core, v.ringAlpha * 0.55);
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.32, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(PALETTE.copper, v.ringAlpha * 0.24);
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.74, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (v.pulseRing > 0 && v.pulseRing < 1) {
        const pr = lerp(radius * 1.15, Math.hypot(g.cardAnchor.x - cx, g.cardAnchor.y - cy) * 0.8, easeOutCubic(v.pulseRing));
        const pa = (1 - v.pulseRing) * 0.65;
        ctx.lineWidth = 5;
        ctx.strokeStyle = rgba(PALETTE.copper, pa * 0.35);
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgba(PALETTE.core, pa);
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (v.countdown != null && smooth.countdownAlpha > 0.01) {
        const cr = radius * 1.55;
        const ca = smooth.countdownAlpha;
        ctx.lineWidth = 3;
        ctx.strokeStyle = rgba(PALETTE.ember, 0.35 * ca);
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 7;
        ctx.strokeStyle = rgba(PALETTE.core, 0.16 * ca);
        ctx.beginPath();
        ctx.arc(cx, cy, cr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(v.countdown, 0.004));
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = rgba(PALETTE.core, 0.8 * ca);
        ctx.beginPath();
        ctx.arc(cx, cy, cr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(v.countdown, 0.004));
        ctx.stroke();
      }

      /* 帧预算:EMA 超 8ms → 氛围场隔点采样;超 12ms → 核心减半(§6 红线);
         lite 档强制降级,保证软件渲染环境下的预览流畅 */
      const cost = performance.now() - now;
      costEma = costEma === 0 ? cost : costEma * 0.92 + cost * 0.08;
      ambientStride = quality === "lite" || costEma > FRAME_BUDGET_MS ? 2 : 1;
      coreHalf = quality === "lite" || costEma > FRAME_BUDGET_MS * 1.5;
    };

    repaintStatic = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [frameRef, quality, reduced, staticState, choreography]);

  return <canvas ref={canvasRef} className="overlay-canvas" aria-hidden="true" />;
});
