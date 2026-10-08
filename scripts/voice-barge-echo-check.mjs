#!/usr/bin/env node
/** Real local TTS -> three PCM crops per answer -> ASR -> fragment echo gate.
 * This is an injected audio benchmark, not physical speaker/microphone acceptance.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { VoiceLocalClient } from '../services/voice-orchestrator/src/tts/voice-local-client.ts';
import { echoSimilarity } from '../src/lib/voice/echo-similarity.ts';
const client=new VoiceLocalClient(process.env.VOICE_LOCAL_URL??'http://127.0.0.1:8810');
const output=process.argv[2]??'docs/voice-8c-barge-fix-echo-calibration.json';
const health=await client.health();assert(health.warm&&health.selfCheck==='passed','voice-local must be ready');
const answers=[
 '先生，本月累计销售额一千二百万元，完成年度目标的百分之六十二。销售进度已经整理，具体金额请看屏幕上的卡片。',
 '本月销售额环比增长百分之五，年度目标完成百分之六十二。目标金额和当前完成金额，已经显示在进度卡片上。',
 '本月新增客户六家，待办事项十二项。客户汇总和待办数量均已整理，可以继续询问销售和回款情况。',
 '本月发运总计三十八台，主要区域的车次和设备台数分别显示。统计时间以卡片标注为准，区域之间不重复相加。',
 '未来七天计划发运十二台设备，涉及四个区域。具体发运日期和各区域的台数，已经显示在发运安排卡片上。',
 '本月回款金额为六百万元，尚有三百万元待回款。已回款和待回款分别展示，具体统计口径请看屏幕上的标注。',
 '今天待办事项共十二项，其中逾期事项三项。系统已经汇总当前待办，可以查看卡片上的分类数量。',
 '年度销售目标为两千万元，当前完成率为百分之六十二。剩余目标金额已经显示，所有数值均为演示测试数据。',
 '本月拜访记录共四十七条，新增商机共二十三个。相关数量已经按当前月份整理，统计范围以卡片说明为准。',
 '先生，本轮经营数据已经整理完毕。销售进度、客户数量和回款情况均已显示，可以继续询问支持的汇总信息。',
];
const questions=[
 ['本月销售额环比呢','本月销售额环比增长百分之五'],
 ['今年目标完成多少了','今年目标完成百分之六十二'],
 ['本月新增客户有几家','本月新增客户六家'],
 ['销售目标是怎么计算的','销售目标金额为两千万元'],
 ['本月回款金额是多少','本月回款金额为六百万元'],
 ['今天还有什么待办','今天待办事项共十二项'],
 ['哪个区域发货最多','主要区域的设备台数已经显示'],
 ['今年是不是已经完成目标了','今年目标完成百分之六十二'],
 ['本月销售额达到目标了吗','本月销售额为一千二百万元'],
 ['下周发货安排呢','未来七天计划发运十二台设备'],
];
const report={startedAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),echoSourceSha256:createHash('sha256').update(await readFile(new URL('../src/lib/voice/echo-similarity.ts',import.meta.url))).digest('hex'),scope:'local true-model synthesized benchmark; no physical capture; synthetic CRM test values',models:{tts:'qwen3-tts-1.7b-base',asr:'qwen3-asr-0.6b'},refHash:health.refHash,styleHashes:health.styleHashes,echo:[],questions:[],passed:false};
async function synth(text){const chunks=[];let metrics;for await(const part of client.tts(text,'default')){if(part.type==='audio')chunks.push(part.pcm);else metrics=part.metrics;}assert(metrics&&!metrics.ttsFail&&!metrics.ttsTruncated,'synthesis failed or truncated');return Buffer.concat(chunks);}
function resample(pcm){
 // Windowed sinc low-pass before 24k -> 16k decimation. PCM is mono s16le.
 const n=pcm.length/2,count=Math.floor(n*2/3),out=Buffer.alloc(count*2),cutoff=2/3,radius=16;
 for(let i=0;i<count;i++){const position=i*1.5;let sum=0,weight=0;for(let j=Math.max(0,Math.ceil(position-radius));j<=Math.min(n-1,Math.floor(position+radius));j++){const d=position-j,x=Math.PI*d*cutoff;const w=(x===0?1:Math.sin(x)/x)*(.5+.5*Math.cos(Math.PI*d/radius));sum+=pcm.readInt16LE(j*2)*w;weight+=w;}out.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(sum/weight))),i*2);}return out;
}
const questionPattern=/吗|呢|多少|几|怎么|什么|哪|是不是|[?？]/;
try{
 for(let i=0;i<answers.length;i++){
  const full=await synth(answers[i]);const samples=full.length/2;
  for(const [start,end] of [[.08,.36],[.35,.63],[.62,.9]]){
   const clip=full.subarray(Math.floor(samples*start)*2,Math.floor(samples*end)*2),asr=await client.asr(resample(clip)),score=echoSimilarity(asr.text,answers[i]);
   report.echo.push({answerIndex:i,reference:answers[i],crop:[start,end],seconds:clip.length/48000,sha256:createHash('sha256').update(clip).digest('hex'),text:asr.text,score,echo:score>=.5});
  }
  console.log(`answer ${i+1}/10: ${report.echo.filter(r=>r.echo).length}/${report.echo.length} echo`);
 }
 for(const [text,reference] of questions){const asr=await client.asr(resample(await synth(text))),score=echoSimilarity(asr.text,reference);report.questions.push({question:text,reference,text:asr.text,hasInterrogative:questionPattern.test(asr.text),score,echo:score>=.5});console.log(`question ${report.questions.length}/10: echo=${score>=.5}`);}
 report.summary={echoRecognized:report.echo.filter(r=>r.echo).length,echoTotal:report.echo.length,questionFalseEcho:report.questions.filter(r=>r.echo).length,validQuestions:report.questions.filter(r=>r.hasInterrogative).length};
 report.passed=report.summary.echoRecognized>=28&&report.summary.echoTotal===30&&report.summary.questionFalseEcho===0&&report.summary.validQuestions===10;
 assert(report.passed,`benchmark failed: ${JSON.stringify(report.summary)}`);
}finally{report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,passed:report.passed,summary:report.summary}));}
