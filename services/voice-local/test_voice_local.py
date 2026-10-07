import io
import tempfile
import threading
import unittest
import socket
import time
import httpx
import uvicorn
import wave
from pathlib import Path
from dataclasses import replace

import numpy as np
from fastapi.testclient import TestClient
from core import Settings, SELF_CHECK_TEXT, GenerationCancelled, check_cancel, cer, pcm_peak, guarded_audio, max_tokens_for
from server import create_app, decode_audio

PCM = np.full(12000, 2000, dtype='<i2').tobytes()

class Backend:
    def __init__(self):
        self.calls = 0
        self.mode = 'normal'
        self.recognition = SELF_CHECK_TEXT
    def load(self): pass
    def recognize(self, audio, cancel):
        check_cancel(cancel)
        return self.recognition
    def generate(self, text, cancel, max_tokens):
        self.calls += 1
        if self.mode == 'silent' or (self.mode == 'retry' and self.calls == 1):
            yield bytes(len(PCM)), 6
            return
        for _ in range(100 if self.mode == 'runaway' else 2):
            check_cancel(cancel)
            yield PCM, 6
            if self.mode == 'error': raise ValueError('Injected decoder error')

class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        ref = Path(self.temp.name)/'ref.wav'
        ref.write_bytes(b'fixture')
        self.settings = Settings('tts', 'asr', str(ref), 'reference')
        self.backend = Backend()
    def tearDown(self): self.temp.cleanup()
    def audio(self, text='测试。'):
        stats = {}
        parts = list(guarded_audio(self.backend, self.settings, text, threading.Event(), stats))
        return parts, stats
    def test_silent_retry_before_bytes(self):
        self.backend.mode='retry'
        parts, stats=self.audio()
        self.assertEqual(stats['ttsRegenerated'], 1)
        self.assertEqual(self.backend.calls, 2)
        self.assertTrue(all(pcm_peak(p) > .001 for p in parts))
    def test_two_silent_attempts_fail(self):
        self.backend.mode='silent'
        parts, stats=self.audio()
        self.assertEqual(parts, [])
        self.assertEqual(stats['ttsFail'], 1)
        self.assertEqual(self.backend.calls, 2)
    def test_after_bytes_error_never_retries(self):
        self.backend.mode='error'
        parts, stats=self.audio()
        self.assertEqual(len(parts), 1)
        self.assertEqual(stats['ttsFail'], 1)
        self.assertEqual(self.backend.calls, 1)
    def test_ceiling(self):
        self.backend.mode='runaway'
        parts, stats=self.audio('字')
        self.assertEqual(stats['ttsTruncated'], 1)
        self.assertLessEqual(sum(map(len, parts)), 1.9*24000*2)
        self.assertEqual(max_tokens_for('字'), 23)
    def test_cancel(self):
        cancel=threading.Event(); cancel.set()
        with self.assertRaises(GenerationCancelled):
            list(guarded_audio(self.backend, self.settings, '测试', cancel, {}))
    def test_hash_tracks_pair_and_parameters(self):
        initial=self.settings.ref_hash()
        for field,value in [('ref_text','changed'),('tts_model','changed'),('temperature',.7),('silence_peak',.002)]:
            self.assertNotEqual(initial, replace(self.settings, **{field:value}).ref_hash())
        Path(self.settings.ref_audio).write_bytes(b'changed')
        self.assertNotEqual(initial, self.settings.ref_hash())
    def test_cer_and_negative_peak(self):
        self.assertEqual(cer('我在,先生。请讲。','我在先生请讲'),0)
        self.assertEqual(pcm_peak(np.array([-32768],dtype='<i2').tobytes()),1)
    def test_pcm_wav_and_limits(self):
        self.assertEqual(len(decode_audio(PCM)),12000)
        for raw in [b'',b'x',bytes(480002)]:
            with self.assertRaises(ValueError): decode_audio(raw)
        buf=io.BytesIO()
        with wave.open(buf,'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(24000);wav.writeframes(PCM)
        with self.assertRaises(ValueError):decode_audio(buf.getvalue())
    def test_service_contract_and_faults(self):
        with TestClient(create_app(self.settings,self.backend)) as client:
            self.assertEqual(client.get('/health').json()['selfCheck'],'passed')
            self.assertEqual(client.post('/asr',content=PCM,headers={'content-type':'audio/pcm'}).json()['text'],SELF_CHECK_TEXT)
            self.assertEqual(client.post('/asr',content=b'x',headers={'content-type':'audio/pcm'}).status_code,400)
            self.assertEqual(client.post('/asr',content=bytes(524289),headers={'content-type':'audio/pcm'}).status_code,413)
            self.assertEqual(client.post('/tts',json={'text':'测试','style':'unknown'}).status_code,400)
            self.backend.mode='retry'; self.backend.calls=0
            response=client.post('/tts',json={'text':'测试'})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.headers['x-tts-regenerated'],'1')
            metrics=client.get('/jobs/'+response.headers['x-voice-job-id']).json()
            self.assertEqual(metrics['ttsRegenerated'],1)
            self.backend.mode='silent'
            self.assertEqual(client.post('/tts',json={'text':'测试'}).status_code,503)
    def test_disconnect_releases_blocked_worker_and_audio_queue(self):
        app = create_app(self.settings, self.backend)
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='critical', access_log=False))
        thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 3
            while not server.started:
                if time.monotonic() > deadline: self.fail('Server did not start')
                time.sleep(.005)
            def slow(text, cancel, max_tokens):
                for _ in range(300):
                    check_cancel(cancel)
                    time.sleep(.001)
                    yield PCM, 6
            self.backend.generate = slow
            with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=2) as client:
                with client.stream('POST','/tts',json={'text':'测'*400}) as response:
                    self.assertEqual(response.status_code,200)
                    job_id=response.headers['x-voice-job-id']
                    next(response.iter_raw())
                    time.sleep(.15)  # consumer stalls while the bounded producer fills
                    started=time.monotonic()
                job=app.state.runtime.jobs[job_id]
                while not job.future.done():
                    if time.monotonic()-started>.2: self.fail('Worker did not release within 200ms')
                    time.sleep(.005)
                self.assertTrue(job.cancel.is_set())
                time.sleep(.01)
                self.assertEqual(job.queue.qsize(),0)
                result=client.post('/asr',content=PCM,headers={'content-type':'audio/pcm'})
                self.assertEqual(result.status_code,200)  # next GPU task can run
        finally:
            server.should_exit=True
            thread.join(timeout=3)
            listener.close()
            self.assertFalse(thread.is_alive())

    def test_failed_self_check_mutes_tts_keeps_asr(self):
        self.backend.recognition='完全不同'
        with TestClient(create_app(self.settings,self.backend)) as client:
            self.assertEqual(client.get('/health').json()['selfCheck'],'failed')
            self.assertEqual(client.post('/tts',json={'text':'测试'}).status_code,503)
            self.assertEqual(client.post('/asr',content=PCM,headers={'content-type':'audio/pcm'}).status_code,200)

if __name__=='__main__': unittest.main()
