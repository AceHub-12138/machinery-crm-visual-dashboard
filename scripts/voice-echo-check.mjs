#!/usr/bin/env node
/** Local-only Step 0 harness. Real audio devices; no fake capture or cloud.
 * Start with --run only after the human confirms speaker and quiet conditions. */
import { createRequire } from "node:module";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { VoiceLocalClient } from "../services/voice-orchestrator/src/tts/voice-local-client.ts";
const root = new URL("../", import.meta.url).pathname;
const output = process.env.VOICE_ECHO_OUTPUT ?? join(root, `services/voice-orchestrator/logs/interaction-echo-step0-${Date.now()}.json`);
const priorPath = process.env.VOICE_ECHO_PRIOR_REPORT;
const prior = priorPath ? JSON.parse(await readFile(priorPath, "utf8")) : undefined;
const config = { placement: process.env.VOICE_ECHO_PLACEMENT ?? "耳机麦克风在本人面前、Mac旁边；距离未测量，非展厅摆位", displayPlacement: false, consentedQuiet: process.argv.includes("--run"), ...(prior ? { prior, priorPath, priorSha256: createHash("sha256").update(await readFile(priorPath)).digest("hex") } : {}) };
const cache = await mkdtemp(join(tmpdir(), "voice-echo-"));
const vitestRequire = createRequire(import.meta.resolve("vitest"));
const viteRequire = createRequire(vitestRequire.resolve("vite"));
const { build } = viteRequire("esbuild");
let server, browser;
try {
  await build({ entryPoints: [join(root, "scripts/voice-echo-browser.ts")], outfile: join(cache, "lab.js"), bundle: true, platform: "browser", format: "esm" });
  const texts = [
    "先生，本月销售完成情况已经整理，当前完成率为百分之八十二，距离月度目标还有一定差距。",
    "本月新增重点客户六家，待办事项十二项，均已安排专人跟进，建议关注近期的拜访进展。",
    "滕州区域表现稳定，本月发运三百八十二车次，同比增长百分之十二，发货节奏保持平稳。",
    "过去三十天共录入拜访记录二百一十四条，其中重点客户拜访四十七条，待跟进商机二十三个。",
    "今日待办已汇总，建议先处理逾期事项，再安排新客户回访，具体明细请查看屏幕上的卡片。",
    "先生，回款数据已汇总，完成率与剩余金额都显示在卡片上，您可以继续询问区域情况。",
    "本周客户跟进保持稳定，建议优先关注连续两周没有进展的重点客户，及时确认下一步计划。",
    "区域发货概况已整理，主要区域的车次和设备台数分别显示，统计时间以卡片标注为准。",
    "销售目标与实际完成金额已经对照，卡片提供完成率和差额，建议按区域继续查看进展。",
    "先生，本轮数据汇总已完成，您可以继续询问客户、拜访或回款情况，我会为您展示对应信息。",
  ];
  const client = new VoiceLocalClient("http://127.0.0.1:8810");
  const health = await client.health(); if (!health.warm || health.selfCheck !== "passed") throw new Error("voice-local not ready");
  const clips = [], audio = new Map();
  for (let index = 0; index < (prior ? 5 : texts.length); index++) {
    const chunks = []; let metrics;
    for await (const chunk of client.tts(texts[index], "default")) { if (chunk.type === "audio") chunks.push(chunk.pcm); else metrics = chunk.metrics; }
    if (!metrics || metrics.ttsFail || metrics.ttsTruncated) throw new Error(`clip ${index + 1} failed/truncated`);
    const pcm = Buffer.concat(chunks); const id = `echo-${index}`;
    audio.set(`/voice/audio/${id}/0`, pcm); clips.push({ id, seconds: pcm.length / 48000, sha256: createHash("sha256").update(pcm).digest("hex") });
    console.log(`准备真实TTS ${index + 1}/10，${clips.at(-1).seconds.toFixed(1)}s`);
  }
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost"); const path = url.pathname;
      const pcm = audio.get(path);
      if (req.method === "GET" && pcm) { res.writeHead(200, { "content-type": "audio/pcm", "x-sample-rate": "24000", "x-channels": "1", "x-sample-format": "s16le" }); res.end(pcm); return; }
      if (path === "/result" && req.method === "POST") {
        if (req.headers.origin !== `http://127.0.0.1:${server.address().port}`) { res.writeHead(403).end(); return; }
        let size = 0; const chunks = []; for await (const part of req) { size += part.length; if (size > 512000) throw new Error("report too large"); chunks.push(part); }
        const result = JSON.parse(Buffer.concat(chunks).toString());
        await writeFile(`${output}.tmp`, JSON.stringify({ ...result, at: new Date().toISOString(), clips }, null, 2));
        await (await import("node:fs/promises")).rename(`${output}.tmp`, output); res.end("ok"); return;
      }
      if (path === "/config.json") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(config)); return; }
      if (path === "/favicon.ico") { res.writeHead(204).end(); return; }
      if (path === "/clips.json") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(clips)); return; }
      if (path === "/") { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<!doctype html><meta charset="utf-8"><title>小川：Step0三组对照</title><style>body{font:22px system-ui;padding:30px}button{font:26px system-ui;padding:15px}pre{white-space:pre-wrap}</style><h1>Mac扬声器 / KZ麦克风</h1><p>先做AEC开无人声10次，再关AEC播放3次。每次先安静5秒。真人组逐次点按钮，等绿色提示再提问。仅记录能量和检测计数，不保存麦克风录音。</p><button>开始安静对照</button><pre>准备就绪</pre><script type="module" src="/lab.js"></script>'); return; }
      const asset = path === "/lab.js" ? join(cache, "lab.js") : path === "/voice/mic-worklet.js" ? join(root, "public/voice/mic-worklet.js") : /^\/voice\/vad\/[a-z0-9_.-]+$/.test(path) ? join(root, "public", path) : null;
      if (!asset || req.method !== "GET") { res.writeHead(404).end(); return; }
      res.setHeader("content-type", path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".onnx") ? "application/octet-stream" : "text/javascript"); res.end(await readFile(asset));
    } catch (error) { console.error(error.message); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`; console.log(`独立测试入口 ${url}`);
  if (!process.argv.includes("--run")) { console.log("等待点击页面开始；Ctrl+C退出。"); await new Promise(resolve => process.once("SIGINT", resolve)); }
  else {
    browser = await chromium.launch({ channel: "chrome", headless: false });
    const context = await browser.newContext({ permissions: ["microphone"] });
    const page = await context.newPage(); page.on("console", message => console.log(message.text())); page.on("pageerror", error => console.error(error.message));
    await page.goto(url); await page.waitForFunction(() => typeof window.runEchoCheck === "function");
    // A real click unlocks audio. The run remains completely native capture.
    await page.getByRole("button").click();
    let result, state; for (let count = 0; count < 1800; count++) {
      const failure = await page.evaluate(() => window.echoFailure); if (failure) throw new Error(failure);
      try {
        result = JSON.parse(await readFile(output, "utf8"));
        if (result.state !== state) { state = result.state; console.log(`state=${state} report=${output}`); if (state === "awaiting-human") await page.bringToFront(); }
        if (["blocked-controls", "completed-passed", "completed-failed", "failed"].includes(result.state)) break;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!result || !["blocked-controls", "completed-passed", "completed-failed", "failed"].includes(result.state)) throw new Error("echo experiment did not complete");
    console.log(JSON.stringify({ output, state: result.state, passed: result.passed, pickup: result.pickup, human: result.human }));
  }
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(cache, { recursive: true, force: true }); }
