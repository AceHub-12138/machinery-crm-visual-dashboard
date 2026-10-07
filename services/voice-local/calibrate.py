"""Thirty sequential real-model rounds, cancellation, and PCM/CER calibration.
Run with the service warm; writes measurements only (no reference material).
"""
import argparse
import json
import time
from pathlib import Path

import httpx
import numpy as np
from core import SAMPLE_RATE, cer, pcm_peak

LINES = [
    '我在,先生。请讲。',
    '先生,本月销售额一点二四亿元,完成月度目标的百分之八十二。',
    '距离目标还差两千七百一十六万元。',
    '本月新增重点客户六家,待办事项十二项,均已安排专人跟进。',
    '滕州区域表现稳定,本月发运三百八十二车次,同比增长百分之十二。',
    '先生,还有其他问题需要我帮您处理吗?',
    '为您服务是我的荣幸,先生。',
    '抱歉先生,数据暂时无法调取,请稍后再试。',
    '抱歉先生,我没有听清。',
    '先生,过去三十天平台共录入拜访记录二百一十四条,其中重点客户拜访四十七条。',
]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8810');parser.add_argument('--out',default='logs/calibration.json');args=parser.parse_args()
    report={'health':None,'rounds':[],'cancellations':[]}
    with httpx.Client(base_url=args.url,timeout=90) as client:
        report['health']=client.get('/health').json()
        if report['health']['selfCheck']!='passed':raise RuntimeError('Warm self-check required')
        for index in range(30):
            text=LINES[index%len(LINES)]; start=time.perf_counter(); data=[];first=None;peak=None
            with client.stream('POST','/tts',json={'text':text}) as response:
                response.raise_for_status();job=response.headers['x-voice-job-id']
                for block in response.iter_raw():
                    if first is None:first=(time.perf_counter()-start)*1000;peak=pcm_peak(block[:len(block)//2*2])
                    data.append(block)
            duration=len(b''.join(data))/(SAMPLE_RATE*2)
            stats=client.get('/jobs/'+job).json()
            pcm=np.frombuffer(b''.join(data),dtype='<i2').astype(np.float32)/32768
            down=np.interp(np.arange(round(len(pcm)*16000/SAMPLE_RATE))*SAMPLE_RATE/16000,np.arange(len(pcm)),pcm)
            if len(down)<=240000:
                asr=client.post('/asr',content=(np.clip(down,-1,1)*32767).astype('<i2').tobytes(),headers={'content-type':'audio/pcm'}).json()
                error=cer(text,asr['text']);asr_ms=asr['ms']
            else:error=None;asr_ms=None
            record={'round':index+1,'characters':len(text),'firstByteMs':round(first,1),'networkFirstPeak':peak,'audioSeconds':round(duration,3),'secondsPerCharacter':round(duration/len(text),4),'asrMs':asr_ms,'cer':error,**stats}
            report['rounds'].append(record)
            output=Path(args.out);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
            print(json.dumps({'round':index+1,'firstByteMs':record['firstByteMs'],'secondsPerCharacter':record['secondsPerCharacter'],'cer':error,'regenerated':stats['ttsRegenerated'],'truncated':stats['ttsTruncated']}),flush=True)
        # Cancellation after the first packet and during prefill, measured until GPU worker finishes.
        for phase in ['stream','prefill','stream','prefill']:
            known=set()
            # Request has no ID until headers. Track health's active jobs for prefill cancellation.
            if phase=='stream':
                with client.stream('POST','/tts',json={'text':LINES[-1]*3}) as response:
                    response.raise_for_status();job=response.headers['x-voice-job-id']; next(response.iter_raw());start=time.perf_counter()
                while not client.get('/jobs/'+job).json()['finished']:
                    if time.perf_counter()-start>3:break
                    time.sleep(.005)
            else:
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    def early_abort():
                        try:
                            with httpx.Client(base_url=args.url,timeout=.08) as early:
                                early.post('/tts',json={'text':LINES[-1]*3})
                        except httpx.TimeoutException:pass
                    pending=executor.submit(early_abort);pending.result();start=time.perf_counter()
                    while client.get('/health').json()['activeJobs']:
                        if time.perf_counter()-start>3:break
                        time.sleep(.005)
            stopped=(time.perf_counter()-start)*1000
            report['cancellations'].append({'phase':phase,'stopMs':round(stopped,1)})
            output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
            print(json.dumps(report['cancellations'][-1]),flush=True)
    clean={k:v for k,v in report['health'].items() if k not in ('models','refHash')};report['health']=clean
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
