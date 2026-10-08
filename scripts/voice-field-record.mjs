/** Read-only field recorder. Observes authenticated console events; never sends
 * wake/close/questions and never stores tokens or question/answer text. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadEnvFileExplicit } from '../services/voice-orchestrator/src/config.ts';
loadEnvFileExplicit(fileURLToPath(new URL('../services/voice-orchestrator',import.meta.url)));
const args=process.argv.slice(2), value=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const mode=value('--mode','positive'),seconds=Number(value('--seconds',mode==='noise'?'3600':'240'));
if(!['positive','negative','noise','conversation'].includes(mode)||!Number.isFinite(seconds)||seconds<1||seconds>7200)throw new Error('mode: positive/negative/noise/conversation；seconds: 1–7200');
const cfg=loadConfig(),out=value('--out',`services/voice-orchestrator/logs/field-${mode}-${Date.now()}.json`);
if(!cfg.hubConsoleToken)throw new Error('先运行一键启动，配置本机 console token。');
await mkdir(dirname(out),{recursive:true});
const data={scope:'human field observer; success/latency/distance require manual record form',mode,requestedSeconds:seconds,started:null,ended:null,complete:false,wakes:[],ends:[],turns:[]};
const socket=new WebSocket(`ws://127.0.0.1:${cfg.port}`);
let timer,started=0,finished=false;
async function finish(complete=false){
  if(finished)return;finished=true;clearTimeout(timer);socket.close();data.ended=new Date().toISOString();data.complete=complete;data.elapsedSeconds=started?(Date.now()-started)/1000:0;
  data.wakeCount=data.wakes.length;
  // A short observation is not extrapolated into a one-hour acceptance result.
  data.noiseOneHourPass=mode==='noise'&&complete&&data.elapsedSeconds>=3600?data.wakeCount<=1:null;
  await writeFile(out,JSON.stringify(data,null,2),{mode:0o600});console.log(`已保存 ${out}；实际 ${Math.round(data.elapsedSeconds)} 秒，唤醒 ${data.wakeCount} 次。请补填真人记录表。`);
}
socket.addEventListener('open',()=>socket.send(JSON.stringify({type:'hub.auth',at:Date.now(),token:cfg.hubConsoleToken})));
socket.addEventListener('message',async message=>{
  const event=JSON.parse(String(message.data));
  if(event.type==='hub.hello'&&!started){clearTimeout(timer);started=Date.now();data.started=new Date(started).toISOString();timer=setTimeout(()=>void finish(true),seconds*1000);console.log(`开始 ${mode} 观察，共 ${seconds} 秒。仅观察；Ctrl+C 保存提前结束。`);}
  if(!started||finished)return;
  if(event.type==='session.start')data.wakes.push({at:new Date().toISOString(),sessionId:event.sessionId});
  if(event.type==='session.end')data.ends.push({at:new Date().toISOString(),reason:event.reason});
  if(event.type==='trace.turn'&&event.trace.playbackOutcome){const t=event.trace;const row={at:event.at,turn:event.turn,speculative:t.speculative??'none',playbackOutcome:t.playbackOutcome,playbackStartMs:t.playbackStartMs,asrMs:t.asrMs,classifyMs:t.classifyMs,ttsFirstByteMs:t.ttsFirstByteMs,style:t.style,styleFallback:t.styleFallback};if(!data.turns.some(r=>r.turn===row.turn&&r.at===row.at))data.turns.push(row);}
});
socket.addEventListener('error',()=>{console.error('编排服务连接失败，记录未完成。');process.exitCode=1;void finish();});
socket.addEventListener('close',()=>{if(!finished){console.error('编排连接已断开，记录未完成。');process.exitCode=1;void finish();}});
process.once('SIGINT',()=>void finish());
timer=setTimeout(()=>{if(!started){console.error('鉴权未就绪。');process.exitCode=1;void finish();}},5000);
