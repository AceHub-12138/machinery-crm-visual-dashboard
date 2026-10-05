// 音色比稿音频生成脚本(零依赖,Node 18+)
//
// 用法:
//   export ZHIPU_API_KEY=xxx
//   node generate.mjs list --vendor zhipu                 # 拉取智谱官方音色列表
//   node generate.mjs gen  --vendor zhipu --voice xiaochen
//   export VOLC_TTS_APPID=xxx VOLC_TTS_TOKEN=xxx
//   node generate.mjs gen  --vendor volc --speaker zh_male_ruyou_720hs
//   export ELEVEN_API_KEY=xxx
//   node generate.mjs list --vendor eleven                # 列出账号音色与 voice_id
//   node generate.mjs gen  --vendor eleven --voice <voice_id> [--model eleven_v3]
//   node generate.mjs blind                               # 生成盲听副本 + 映射表
//
// 输出:out/<vendor>_<voice>_L<id>.<ext>;blind/ 为打乱编号的盲听副本。
// 统一口径:默认语速、默认音调,不加情感参数,保证比稿公平。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "out");
const LINES = JSON.parse(readFileSync(join(ROOT, "lines.json"), "utf8"));

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function save(name, buffer) {
  mkdirSync(OUT, { recursive: true });
  const p = join(OUT, name);
  writeFileSync(p, buffer);
  console.log(`✓ ${name} (${(buffer.length / 1024).toFixed(0)} KB)`);
}

async function zhipuList() {
  const key = process.env.ZHIPU_API_KEY;
  if (!key) throw new Error("缺少环境变量 ZHIPU_API_KEY");
  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/voice/list?voiceType=OFFICIAL", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.text();
  console.log(body);
}

async function zhipuGen(voice, ids) {
  const key = process.env.ZHIPU_API_KEY;
  if (!key) throw new Error("缺少环境变量 ZHIPU_API_KEY");
  for (const line of LINES.filter((l) => ids.includes(l.id))) {
    const res = await fetch("https://open.bigmodel.cn/api/paas/v4/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-tts",
        input: line.tts_text ?? line.text,
        voice,
        response_format: "wav",
      }),
    });
    if (!res.ok) throw new Error(`智谱 L${line.id} HTTP ${res.status}: ${await res.text()}`);
    save(`zhipu_${voice}_L${String(line.id).padStart(2, "0")}.wav`, Buffer.from(await res.arrayBuffer()));
  }
}

// 火山 V3 单向流式(HTTP Chunked):一次性输入全部文本,流式返回 JSON 分片,
// 音频在每片 data 字段(base64),按序拼接。协议以官方文档为准:
// https://www.volcengine.com/docs/6561/ 页内「HTTP Chunked/SSE单向流式-V3」
async function volcGen(speaker, ids) {
  const appid = process.env.VOLC_TTS_APPID;
  const token = process.env.VOLC_TTS_TOKEN;
  if (!appid || !token) throw new Error("缺少环境变量 VOLC_TTS_APPID / VOLC_TTS_TOKEN");
  for (const line of LINES.filter((l) => ids.includes(l.id))) {
    const res = await fetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
      method: "POST",
      headers: {
        // 注意:火山的 Bearer 值带分号,为官方约定格式
        Authorization: `Bearer; ${token}`,
        "X-Api-App-Key": appid,
        "X-Api-Resource-Id": "volc.service_type.10029",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user: { uid: "voice-bakeoff" },
        req_params: {
          speaker,
          text: line.tts_text ?? line.text,
          audio_params: { format: "mp3", sample_rate: 24000, speech_rate: 0, pitch_rate: 0, loudness_rate: 0 },
        },
      }),
    });
    if (!res.ok) throw new Error(`火山 L${line.id} HTTP ${res.status}: ${await res.text()}`);
    const chunks = [];
    let buffered = "";
    for await (const delta of res.body) {
      buffered += delta.toString("utf8");
      let nl;
      while ((nl = buffered.indexOf("\n")) >= 0) {
        const row = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!row) continue;
        try {
          const obj = JSON.parse(row);
          if (obj.code !== 0 && obj.code !== undefined) throw new Error(`火山 L${line.id} 业务错误: ${JSON.stringify(obj)}`);
          if (obj.data) chunks.push(Buffer.from(obj.data, "base64"));
        } catch (e) {
          if (e instanceof SyntaxError) continue; // 跨块截断的 JSON,等下一片
          throw e;
        }
      }
    }
    const audio = Buffer.concat(chunks);
    if (!audio.length) throw new Error(`火山 L${line.id} 未收到音频,请核对 V3 请求体/资源开通状态`);
    save(`volc_${speaker}_L${String(line.id).padStart(2, "0")}.mp3`, audio);
  }
}

// ElevenLabs:v3 模型支持 [serious] 等音频标签;v2 系模型不支持,标签会被念出来,文本里必须去掉。
async function elevenList() {
  const key = process.env.ELEVEN_API_KEY;
  if (!key) throw new Error("缺少环境变量 ELEVEN_API_KEY");
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  for (const v of body.voices ?? []) console.log(`${v.voice_id}  ${v.name}${v.category ? `  (${v.category})` : ""}`);
}

async function elevenGen(voiceId, ids, model, stability) {
  const key = process.env.ELEVEN_API_KEY;
  if (!key) throw new Error("缺少环境变量 ELEVEN_API_KEY");
  const isV3 = model.startsWith("eleven_v3");
  for (const line of LINES.filter((l) => ids.includes(l.id))) {
    const payload = { text: line.tts_text ?? line.text, model_id: model };
    if (isV3) {
      // v3:调高 stability 抑制同文案多次生成的音色漂移(表现力随之略降)
      if (stability !== undefined) payload.voice_settings = { stability };
    } else {
      payload.voice_settings = { stability: stability ?? 0.5, similarity_boost: 0.75 };
    }
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`ElevenLabs L${line.id} HTTP ${res.status}: ${await res.text()}`);
    save(`eleven_${voiceId.slice(0, 8)}_L${String(line.id).padStart(2, "0")}.mp3`, Buffer.from(await res.arrayBuffer()));
  }
}

function blind() {
  const files = readdirSync(OUT).filter((f) => /\.(mp3|wav)$/.test(f));
  const blindDir = join(OUT, "blind");
  mkdirSync(blindDir, { recursive: true });
  const shuffled = files.toSorted(() => Math.random() - 0.5);
  const mapping = shuffled.map((f, i) => {
    const code = String.fromCharCode(65 + (i % 26)) + Math.ceil((i + 1) / 26);
    copyFileSync(join(OUT, f), join(blindDir, `${code}.${f.split(".").pop()}`));
    return `${code},${f}`;
  });
  writeFileSync(join(OUT, "blind_mapping.csv"), "code,file\n" + mapping.join("\n"));
  console.log(`已生成 ${shuffled.length} 个盲听副本到 out/blind/,映射表 out/blind_mapping.csv(评分完成前勿看)`);
}

const ids = (opt("lines") ?? "all") === "all" ? LINES.map((l) => l.id) : opt("lines").split(",").map(Number);

if (cmd === "list" && opt("vendor") === "zhipu") await zhipuList();
else if (cmd === "gen" && opt("vendor") === "zhipu") await zhipuGen(opt("voice"), ids);
else if (cmd === "gen" && opt("vendor") === "volc") await volcGen(opt("speaker"), ids);
else if (cmd === "list" && opt("vendor") === "eleven") await elevenList();
else if (cmd === "gen" && opt("vendor") === "eleven") await elevenGen(opt("voice"), ids, opt("model") ?? "eleven_multilingual_v2", opt("stability") !== undefined ? Number(opt("stability")) : undefined);
else if (cmd === "blind") blind();
else {
  console.log("用法见文件头注释");
  process.exit(1);
}
