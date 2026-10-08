/** One-click local microphone test stack. Reuse healthy local services; do not
 * unload models, kill occupied ports, download models or print credentials. */
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadConfig, loadEnvFileExplicit } from "../services/voice-orchestrator/src/config.ts";
const root=fileURLToPath(new URL("..",import.meta.url)), service=join(root,"services/voice-orchestrator"), logs=join(service,"logs");
mkdirSync(logs,{recursive:true,mode:0o700});loadEnvFileExplicit(service);
const lms=process.env.VOICE_LMS_BIN??join(homedir(),".lmstudio/bin/lms");
const created=[];
const run=(file,args)=>execFileSync(file,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:120000}).trim();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function health(url,headers={}){try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(2000)});return r.ok?await r.json():null;}catch{return null;}}
function launch(file,args,name,env={}){
  const log=openSync(join(logs,`${name}.log`),"a",0o600);
  const child=spawn(file,args,{cwd:root,env:{...process.env,...env},detached:true,stdio:["ignore",log,log]});
  closeSync(log);
  child.on("error",error=>console.error(`${name} 启动失败：${error.message}`));child.unref();created.push({pid:child.pid,name});return child;
}
async function awaitHealth(check,name,ms=120000){const end=Date.now()+ms;while(Date.now()<end){const h=await check();if(h)return h;await wait(500);}throw new Error(`${name} 未就绪；查看 services/voice-orchestrator/logs 中的本机日志。`);}
function defaults(values){
  const path=join(service,".env.local");let text=existsSync(path)?readFileSync(path,"utf8"):"";
  for(const [key,value] of Object.entries(values)){
    if(process.env[key])continue;
    process.env[key]=value;
    const line=new RegExp(`^${key}=.*$`,"m");text=line.test(text)?text.replace(line,`${key}=${value}`):`${text}\n${key}=${value}\n`;
  }
  writeFileSync(path,text,{mode:0o600});
  chmodSync(path,0o600);
}
try{
  if(!existsSync(lms))throw new Error("未找到 LM Studio CLI；通过 VOICE_LMS_BIN 指定本机 lms。");
  const initial=loadConfig(), llmUrl=new URL(initial.llmBaseUrl);
  if(!['localhost','127.0.0.1','[::1]'].includes(llmUrl.hostname))throw new Error("一键测试仅支持本机 LM Studio。");
  console.log("1/4 检查 LM Studio 服务与分类模型…");
  if(!await health(`${initial.llmBaseUrl}/models`))run(lms,["server","start","--bind","127.0.0.1","--port",llmUrl.port||"1234"]);
  await awaitHealth(()=>health(`${initial.llmBaseUrl}/models`),"LM Studio");
  const loaded=JSON.parse(run(lms,["ps","--json"])).filter(m=>m.type==='llm');
  const model=initial.llmModel||(loaded.length===1?loaded[0].identifier:"");
  if(!model)throw new Error("请在 services/voice-orchestrator/.env.local 设置 VOICE_LLM_MODEL；不会擅自选择或下载模型。");
  if(!loaded.some(m=>m.identifier===model))run(lms,["load",model,"--identifier",model,"--context-length",process.env.VOICE_LLM_CONTEXT_LENGTH||"8192","--gpu","max","--yes"]);
  defaults({VOICE_LLM_MODEL:model,VOICE_LLM_API_KEY:"local-placeholder",VOICE_HUB_SCREEN_TOKEN:randomBytes(24).toString('hex'),VOICE_HUB_CONSOLE_TOKEN:randomBytes(24).toString('hex')});
  process.env.VOICE_TTS_ENABLED="1";
  const cfg=loadConfig(), local=new URL(cfg.voiceLocalUrl);
  if(!['localhost','127.0.0.1','[::1]'].includes(local.hostname)||!['localhost','127.0.0.1'].includes(cfg.host))throw new Error("一键测试仅支持回环服务地址。");
  const python=process.env.VOICE_PYTHON??[join(homedir(),"voxlab/.venv/bin/python"),join(root,"services/voice-local/.venv/bin/python")].find(existsSync);
  if(!python||!existsSync(join(root,"services/voice-local/.env.local")))throw new Error("请先配置 voice-local 的本机 Python 环境和参考对；启动脚本不安装模型。");
  console.log("2/4 检查本地 ASR/TTS 和参考自检…");
  if(!await health(`${cfg.voiceLocalUrl}/health`))launch(python,[join(root,"services/voice-local/run.py")],"voice-local",{VOICE_LOCAL_PORT:local.port||"8810"});
  const speech=await awaitHealth(()=>health(`${cfg.voiceLocalUrl}/health`),"voice-local");
  if(!speech.warm||speech.selfCheck!=="passed")throw new Error("default 参考自检失败，暂停真人语音测试。");
  if(speech.failedStyles?.length)console.log(`参考自检未通过：${speech.failedStyles.join(', ')}；对应话术将回退 default，失败记录见 voice-local /health。`);
  console.log("3/4 启动编排服务并准备固定话术…");
  const hub=`http://127.0.0.1:${cfg.port}`, headers={authorization:`Bearer ${cfg.hubScreenToken}`};
  if(!await health(`${hub}/voice/health`,headers))launch(process.execPath,["--experimental-strip-types",join(service,"src/main.ts")],"voice-orchestrator");
  await awaitHealth(async()=>{const h=await health(`${hub}/voice/health`,headers);return h?.tts?.ready?h:null;},"语音编排");
  console.log("4/4 启动大屏并打开本机 Chrome…");
  let page=false;try{page=(await fetch('http://localhost:3015/screen/sales',{signal:AbortSignal.timeout(2000)})).ok;}catch{}
  if(!page){run("pnpm",["build"]);launch(process.execPath,[join(root,'node_modules/next/dist/bin/next'),"start","--hostname","127.0.0.1","--port","3015"],"next");}
  await awaitHealth(async()=>{try{return (await fetch('http://localhost:3015/screen/sales',{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}},"大屏");
  writeFileSync(join(logs,'test-stack-processes.json'),JSON.stringify({created,at:new Date().toISOString()},null,2),{mode:0o600});
  // Token is delivered once in a fragment, removed by the page and kept in
  // sessionStorage; it never appears in console logs or HTTP request URLs.
  const url=`http://localhost:3015/screen/sales?voiceLive=1&hub=${encodeURIComponent(`ws://127.0.0.1:${cfg.port}`)}#hubToken=${cfg.hubScreenToken}`;
  if(!process.argv.includes('--no-open'))run('/usr/bin/open',['-a','Google Chrome',url]);
  console.log("已就绪：允许麦克风后说「你好，小川」，或按 F9。真人测试完成前保持开机。");
}catch(error){for(const p of created)if(p.pid)try{process.kill(p.pid,'SIGTERM');}catch{}console.error(error.message);process.exitCode=1;}
