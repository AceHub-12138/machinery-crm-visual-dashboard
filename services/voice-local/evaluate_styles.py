"""Real production HTTP style verification: 5 probes x 3, Whisper CER + F0 + first byte.
Runs on the voice Mac using existing offline models; never changes reference files.
"""
import argparse, json, os, time, wave, re
from pathlib import Path
import httpx
import numpy as np
import cn2an
import mlx_whisper
from core import pcm_peak
TEXTS = ["我在,先生。请讲。", "先生,本月合同额一千二百八十六万元,已完成月度目标的百分之一百一十点二。", "抱歉先生,我暂时无法调取这项数据。", "先生,目前有七项物料低于安全库存,请尽快安排补货。", "为您服务是我的荣幸,先生。"]
def normalized(text):
    return re.sub(r"[^一-鿿]", "", cn2an.transform(text, "an2cn").replace("两", "二"))
def error_rate(left, right):
    left, right = normalized(left), normalized(right); row = list(range(len(right)+1))
    for i, a in enumerate(left, 1):
        nxt = [i]
        for j, b in enumerate(right, 1): nxt.append(min(row[j]+1, nxt[-1]+1, row[j-1]+(a!=b)))
        row=nxt
    return row[-1]/max(1,len(left))
def pitch_metrics(audio, sr=24000):
    win, hop = int(sr*.04), int(sr*.02); lo, hi = int(sr/300), int(sr/60)
    frames = [audio[i:i+win] for i in range(0,len(audio)-win,hop)]
    if not frames: return {"f0": None, "f0Span": None}
    rms=np.array([np.sqrt(np.mean(f*f)) for f in frames]); threshold=max(np.percentile(rms,10)*3, rms.max()*.08)
    values=[]
    for frame,r in zip(frames,rms):
        if r<=threshold: continue
        frame=frame-frame.mean(); ac=np.correlate(frame,frame,"full")[len(frame)-1:]
        if ac[0]<=0: continue
        region=ac[lo:hi+1]/ac[0]; index=int(np.argmax(region))
        if region[index]>=.3: values.append(sr/(lo+index))
    return {"f0": float(np.median(values)), "f0Span": float(12*np.log2(np.percentile(values,90)/np.percentile(values,10)))} if len(values)>=5 else {"f0": None, "f0Span": None}
if __name__ == "__main__":
    p=argparse.ArgumentParser();p.add_argument("--url",default="http://127.0.0.1:18810");p.add_argument("--whisper-model",required=True);p.add_argument("--out",required=True);p.add_argument("--reference-f0",type=float,default=104.3);p.add_argument("--samples");p.add_argument("--reps",type=int,default=3);args=p.parse_args()
    if args.reference_f0 <= 0: p.error("reference-f0 must be positive")
    os.environ["HF_HUB_OFFLINE"]="1";out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
    report={"scope":"production HTTP TTS, Whisper CER and pitch; no human listening or exhibit microphone", "health":{}, "rounds":[], "styles":{}}
    if out.exists(): report=json.loads(out.read_text())
    with httpx.Client(base_url=args.url,timeout=120) as client:
        health=client.get("/health").json()
        if report.get("health",{}).get("refHash") not in (None,health["refHash"]):
            raise ValueError("Existing report has a different decoder/reference hash; use a new output path")
        report["health"]=health
        report["generationPath"]="production HTTP /tts streaming (MlxBackend.generate stream=True)"
        for style in report["health"]["styles"]:
            rows=[r for r in report["rounds"] if r["style"]==style]
            for text in TEXTS:
                for rep in range(args.reps):
                    if any(r["text"]==text and r["rep"]==rep+1 for r in rows): continue
                    started=time.perf_counter();blocks=[];first=None
                    with client.stream("POST","/tts",json={"text":text,"style":style}) as response:
                        if not response.is_success:
                            row={"style":style,"text":text,"rep":rep+1,"recognized":"","cer":1.,"f0":None,"firstByteMs":None,"seconds":0,"silent":True,"ttsFail":1,"ttsTruncated":0,"ttsRegenerated":1,"httpStatus":response.status_code}
                            rows.append(row);report["rounds"].append(row);out.write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({"style":style,"round":len(rows),"failedHttp":response.status_code}),flush=True);continue
                        if response.headers.get("content-type","").split(";")[0] != "audio/pcm" or response.headers.get("x-sample-rate") != "24000":
                            raise ValueError("Unexpected production PCM format")
                        job=response.headers["x-voice-job-id"]
                        for block in response.iter_raw():
                            if first is None:first=(time.perf_counter()-started)*1000
                            blocks.append(block)
                    raw=b"".join(blocks);stats=client.get("/jobs/"+job).json();audio=np.frombuffer(raw,dtype="<i2").astype(np.float32)/32768
                    # Temporary PCM snapshot makes the exact HTTP result reproducible for Whisper.
                    wav=out.parent/"style-probe.wav"
                    with wave.open(str(wav),"wb") as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(raw)
                    if args.samples and text == TEXTS[1] and rep == 0:
                        sample=Path(args.samples);sample.mkdir(parents=True,exist_ok=True)
                        (sample/f"{style}_同句_修复后.wav").write_bytes(wav.read_bytes())
                    hyp=mlx_whisper.transcribe(str(wav),path_or_hf_repo=args.whisper_model,language="zh",initial_prompt="以下是普通话的句子。")["text"]
                    row={"style":style,"text":text,"rep":rep+1,"recognized":hyp,"cer":error_rate(text,hyp),**pitch_metrics(audio),"firstByteMs":round(first,2),"seconds":len(audio)/24000,"silent":pcm_peak(raw)<.001,**stats}
                    rows.append(row);report["rounds"].append(row)
                    print(json.dumps({"style":style,"round":len(rows),"cer":row["cer"],"firstByteMs":row["firstByteMs"]}),flush=True)
                    out.write_text(json.dumps(report,ensure_ascii=False,indent=2))
            pitches=[r["f0"] for r in rows if r["f0"] is not None]
            median=float(np.median(pitches)) if pitches else None
            report["referenceF0"]=args.reference_f0
            report["styles"][style]={"under10Percent":sum(r["cer"]<=.1 for r in rows),"f0Median":median,"f0SpanMedian":float(np.median([r["f0Span"] for r in rows if r.get("f0Span") is not None])),"f0MedianWithin15Percent":median is not None and abs(median-args.reference_f0)/args.reference_f0<=.15,"f0Within15Percent":sum(abs(v-args.reference_f0)/args.reference_f0<=.15 for v in pitches),"silent":sum(r["silent"] for r in rows),"failed":sum(r["ttsFail"] for r in rows),"truncated":sum(r["ttsTruncated"] for r in rows),"regenerated":sum(r["ttsRegenerated"] for r in rows),"firstByteP50":float(np.percentile([r["firstByteMs"] for r in rows if r["firstByteMs"] is not None],50)),"firstByteP95":float(np.percentile([r["firstByteMs"] for r in rows if r["firstByteMs"] is not None],95))}
            out.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    (out.parent/"style-probe.wav").unlink(missing_ok=True)
