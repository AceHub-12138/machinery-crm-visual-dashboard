#!/usr/bin/env node
/** Real single-worker priority measurement, no speakers or microphone. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const base = "http://127.0.0.1:8810";
const output = process.argv[2] ?? "docs/voice-8c-asr-priority-calibration.json";
const wav = await readFile(process.env.VOICE_ASR_TEST_WAV ?? "/tmp/voice-repair-fixtures/q1.wav");
const text = "先生，本月销售完成情况已经整理，完成率和剩余金额显示在卡片上。建议优先关注连续两周没有进展的重点客户，及时确认下一步计划。区域发货概况也已整理，主要区域的车次和设备台数分别显示，统计时间以卡片标注为准。".repeat(3);
assert(text.length <= 400);
const rows = [], errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => { if (!values.length) return null; const v = [...values].sort((a,b)=>a-b), n = (v.length - 1) * p / 100; return v[Math.floor(n)] + (v[Math.ceil(n)] - v[Math.floor(n)]) * (n - Math.floor(n)); };
const save = async () => {
  const valid = rows.filter(row => row.interleavedTts);
  await writeFile(output, JSON.stringify({ scope: "real voice-local TTS/ASR; synthetic WAV; not microphone/exhibit interaction", rows, errors, summary: { interleavedSamples: valid.length, queueP50: percentile(valid.map(row => row.asrQueueMs), 50), queueP95: percentile(valid.map(row => row.asrQueueMs), 95) } }, null, 2));
};
try {
  const h = await (await fetch(`${base}/health`)).json(); assert(h.warm && h.selfCheck === "passed" && h.styles.length === 7);
  for (let attempt = 0; attempt < 25 && rows.filter(row => row.interleavedTts).length < 10; attempt++) {
    const controller = new AbortController(); let consume;
    try {
      const response = await fetch(`${base}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, style: "default" }), signal: controller.signal });
      assert.equal(response.status, 200); assert.equal(response.headers.get("content-type")?.split(";")[0], "audio/pcm");
      const id = response.headers.get("x-voice-job-id"); assert(/^[a-f0-9]{32}$/.test(id));
      consume = (async () => { let bytes = 0; for await (const chunk of response.body) bytes += chunk.length; return bytes; })();
      await delay([0, 75, 175][attempt % 3]);
      const before = await (await fetch(`${base}/jobs/${id}`)).json();
      const started = performance.now();
      const asrResponse = await fetch(`${base}/asr`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav, signal: AbortSignal.timeout(15000) });
      assert.equal(asrResponse.status, 200); const asr = await asrResponse.json();
      assert(Number.isFinite(asr.asrQueueMs) && asr.asrQueueMs >= 0 && typeof asr.interleavedTts === "boolean" && asr.text.length > 0);
      const roundTripMs = performance.now() - started;
      const bytes = await consume;
      const tts = await (await fetch(`${base}/jobs/${id}`)).json();
      rows.push({ attempt: attempt + 1, delayMs: [0,75,175][attempt % 3], ttsFinishedBeforeRequest: before.finished, interleavedTts: asr.interleavedTts, asrQueueMs: asr.asrQueueMs, asrMs: asr.ms, asrText: asr.text, asrRoundTripMs: roundTripMs, ttsBytes: bytes, ttsFirstByteMs: tts.ttsFirstByteMs, ttsRegenerated: tts.ttsRegenerated, ttsTruncated: tts.ttsTruncated, ttsFail: tts.ttsFail });
      await save(); console.log(JSON.stringify(rows.at(-1)));
      assert(tts.finished && bytes > 0 && !tts.ttsFail && !tts.ttsTruncated);
    } finally { controller.abort(); await consume?.catch(() => {}); }
  }
  const valid = rows.filter(row => row.interleavedTts); assert(valid.length >= 10, "not enough ASR executed inside active TTS");
  assert(percentile(valid.map(row => row.asrQueueMs), 95) <= 250, "queue P95 exceeds 250ms");
} catch (error) { errors.push(error.message); await save(); throw error; }
await save(); console.log("real ASR priority measurement passed");
