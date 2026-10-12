import io
import asyncio
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
from server import create_app, decode_audio, JOB_TTL_SECONDS
from starlette.requests import ClientDisconnect

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
        if self.mode == 'silent' or (self.mode == 'retry' and self.calls == 1) or (self.mode == 'retry_twice' and self.calls <= 2):
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
    def test_two_silent_attempts_then_third_succeeds(self):
        self.backend.mode = 'retry_twice'
        parts, stats = self.audio()
        self.assertEqual(self.backend.calls, 3)
        self.assertEqual(stats['ttsRegenerated'], 1)
        self.assertEqual(stats['ttsFail'], 0)
        self.assertEqual(b''.join(parts), PCM * 2)
        self.assertTrue(all(pcm_peak(part) > .001 for part in parts))
    def test_three_silent_attempts_fail(self):
        self.backend.mode='silent'
        parts, stats=self.audio()
        self.assertEqual(parts, [])
        self.assertEqual(stats['ttsFail'], 1)
        self.assertEqual(self.backend.calls, 3)
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

    def test_stalled_connected_stream_releases_gpu_and_bounds_retained_jobs(self):
        async def exercise():
            app = create_app(self.settings, self.backend)
            async with app.router.lifespan_context(app):
                def generate(text, cancel, max_tokens):
                    for _ in range(30):
                        check_cancel(cancel)
                        yield PCM, 6
                self.backend.generate = generate
                release = asyncio.Event()
                tasks, stalled_events, received = [], [], []

                def start_stream():
                    stalled = asyncio.Event()
                    stalled_events.append(stalled)
                    request_sent = False
                    disconnect = asyncio.Event()
                    size = [0]
                    received.append(size)
                    async def receive():
                        nonlocal request_sent
                        if not request_sent:
                            request_sent = True
                            return {'type': 'http.request', 'body': b'{"text":"' + ('测'*100).encode() + b'"}', 'more_body': False}
                        await disconnect.wait()
                        return {'type': 'http.disconnect'}
                    async def send(message):
                        if message['type'] == 'http.response.start':
                            self.assertEqual(message['status'], 200)
                        elif message.get('body'):
                            stalled.set()
                            await release.wait()  # connected transport, no reading
                            size[0] += len(message['body'])
                    scope = {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.3'},
                             'http_version': '1.1', 'method': 'POST', 'scheme': 'http', 'path': '/tts',
                             'raw_path': b'/tts', 'query_string': b'', 'headers': [(b'content-type', b'application/json')],
                             'client': ('127.0.0.1', 12001), 'server': ('127.0.0.1', 8810)}
                    task = asyncio.create_task(app(scope, receive, send))
                    tasks.append(task)
                    return stalled

                try:
                    await asyncio.wait_for(start_stream().wait(), 1)
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://local') as client:
                        result = await asyncio.wait_for(client.post('/asr', content=PCM, headers={'content-type': 'audio/pcm'}), 1)
                        self.assertEqual(result.status_code, 200)
                        job = next(j for j in app.state.runtime.jobs.values() if j.streaming)
                        self.assertTrue(job.future.done())
                        self.assertGreater(job.queue.qsize(), 4)
                        self.assertLessEqual(job.stats['bytes'], (100*.4+1.5)*24000*2)
                        # Completed but undrained streams still consume admission slots.
                        for _ in range(7):
                            await asyncio.wait_for(start_stream().wait(), 1)
                        denied = await client.post('/tts', json={'text': '测试'})
                        self.assertEqual(denied.status_code, 429)
                        release.set()
                        await asyncio.wait_for(asyncio.gather(*tasks), 2)
                        self.assertTrue(all(size[0] == len(PCM)*30 for size in received))
                        self.assertTrue(all(not j.streaming and j.queue.empty() for j in app.state.runtime.jobs.values()))
                        result = await client.post('/asr', content=PCM, headers={'content-type': 'audio/pcm'})
                        self.assertEqual(result.status_code, 200)
                finally:
                    release.set()
                    await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 2)
        asyncio.run(exercise())

    def test_failed_self_check_mutes_tts_keeps_asr(self):
        self.backend.recognition='完全不同'
        with TestClient(create_app(self.settings,self.backend)) as client:
            self.assertEqual(client.get('/health').json()['selfCheck'],'failed')
            self.assertEqual(client.post('/tts',json={'text':'测试'}).status_code,503)
            self.assertEqual(client.post('/asr',content=PCM,headers={'content-type':'audio/pcm'}).status_code,200)

    def test_response_header_failure_and_cancellation_release_stream_slots(self):
        async def exercise():
            app = create_app(self.settings, self.backend)
            async with app.router.lifespan_context(app):
                original_generate = self.backend.generate
                def generate_until_cancelled(text, cancel, max_tokens):
                    yield PCM, 6
                    cancel.wait(3)  # worker is still running when headers fail
                    check_cancel(cancel)
                    yield PCM, 6
                for spec, error in [('2.4', OSError), ('2.3', asyncio.CancelledError)]:
                    self.backend.generate = generate_until_cancelled
                    for _ in range(8):
                        sent = False
                        async def receive():
                            nonlocal sent
                            if not sent:
                                sent = True
                                return {'type': 'http.request', 'body': b'{"text":"test"}', 'more_body': False}
                            await asyncio.Event().wait()
                        async def send(message):
                            if message['type'] == 'http.response.start':
                                self.assertEqual(message['status'], 200)
                                self.assertFalse(list(app.state.runtime.jobs.values())[-1].finished)
                                raise error('injected before stream iteration')
                        scope = {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': spec},
                                 'http_version': '1.1', 'method': 'POST', 'scheme': 'http', 'path': '/tts',
                                 'raw_path': b'/tts', 'query_string': b'', 'headers': [(b'content-type', b'application/json')],
                                 'client': ('127.0.0.1', 12001), 'server': ('127.0.0.1', 8810)}
                        try:
                            await asyncio.wait_for(app(scope, receive, send), 1)
                        except (ClientDisconnect, asyncio.CancelledError):
                            pass
                        job = list(app.state.runtime.jobs.values())[-1]
                        await asyncio.wait_for(job.future, 1)
                        await asyncio.sleep(0)
                        self.assertFalse(job.streaming)
                        self.assertTrue(job.cancel.is_set())
                        self.assertTrue(job.queue.empty())
                    self.backend.generate = original_generate
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://local') as client:
                        result = await client.post('/tts', json={'text': '测试'})
                        self.assertEqual(result.status_code, 200)
                        self.assertGreater(len(result.content), 0)
        asyncio.run(exercise())

    def test_ttl_reclaims_finished_abandoned_streams_but_not_running_jobs(self):
        async def exercise():
            runtime = create_app(self.settings, self.backend).state.runtime
            try:
                stale = []
                for _ in range(8):
                    job = runtime.create_job()
                    job.finished = True
                    job.streaming = True
                    job.queue.put_nowait(PCM)
                    stale.append(job)
                for job in stale:
                    job.created = time.monotonic() - JOB_TTL_SECONDS - 1
                fresh = runtime.create_job()
                self.assertEqual(list(runtime.jobs), [fresh.id])
                for job in stale:
                    self.assertTrue(job.cancel.is_set())
                    self.assertFalse(job.streaming)
                    self.assertIsNone(job.queue.get_nowait())
                    self.assertTrue(job.queue.empty())
                fresh.created = time.monotonic() - JOB_TTL_SECONDS - 1
                runtime.create_job()
                self.assertIn(fresh.id, runtime.jobs)
                self.assertFalse(fresh.cancel.is_set())
            finally:
                await runtime.close()
        asyncio.run(exercise())


class StyleTests(unittest.TestCase):
    def test_byte_snapshot_pair_validation_and_style_health(self):
        from core import load_style_settings
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ref = root/'external.wav'; ref.write_bytes(b'original')
            root = root/'styles'; root.mkdir()
            (root/'default.wav').write_bytes(b'original')
            (root/'default.txt').write_text('reference')
            (root/'warm.wav').write_bytes(b'warm')
            (root/'warm.txt').write_text('暖心问候。')
            settings = Settings('tts', 'asr', str(ref), 'reference', styles_dir=str(root))
            styles = load_style_settings(settings); before = styles['default'].ref_hash()
            ref.write_bytes(b'changed')
            self.assertEqual(styles['default'].ref_hash(), before)
            self.assertEqual(styles['warm'].ref_bytes, b'warm')
            with self.assertRaises(ValueError): load_style_settings(settings)
            (root/'default.txt').write_text('changed text')
            (root/'warm.txt').unlink()
            with self.assertRaises(ValueError): load_style_settings(settings)
    def test_single_style_failure_keeps_default_and_rejects_failed_style(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'default.wav').write_bytes(b'ref');(root/'default.txt').write_text('reference')
            (root/'warm.wav').write_bytes(b'warm');(root/'warm.txt').write_text('这是一句暖心问候。')
            backend=Backend()
            settings=Settings('tts','asr',str(root/'default.wav'),'reference',styles_dir=directory)
            with TestClient(create_app(settings,backend)) as client:
                health=client.get('/health').json()
                self.assertEqual(health['styles'],['default'])
                self.assertEqual(health['failedStyles'],['warm'])
                self.assertEqual(health['styleAttempts'], {'default': 1, 'warm': 3})
                self.assertEqual(health['styleFailures']['warm']['reason'], 'Self check CER exceeds 20%')
                self.assertEqual(health['selfCheck'],'passed')
                self.assertEqual(client.post('/tts',json={'text':'你好','style':'warm'}).status_code,400)
    def test_style_self_check_recovers_on_third_attempt(self):
        class RecoveringBackend(Backend):
            def recognize(self, audio, cancel):
                self.checks += 1
                return '识别失败' if self.checks <= 2 else SELF_CHECK_TEXT
        with tempfile.TemporaryDirectory() as directory:
            ref = Path(directory) / 'ref.wav'; ref.write_bytes(b'ref')
            backend = RecoveringBackend(); backend.checks = 0
            with TestClient(create_app(Settings('tts', 'asr', str(ref), 'reference'), backend)) as client:
                health = client.get('/health').json()
                self.assertEqual(health['styleAttempts'], {'default': 3})
                self.assertEqual(health['failedStyles'], [])
                self.assertEqual(health['styleFailures'], {})
                self.assertEqual(health['selfCheck'], 'passed')
                self.assertEqual(backend.checks, 3)
                self.assertEqual(client.post('/tts', json={'text': '你好'}).status_code, 200)
    def test_missing_style_directory_configuration_retains_default(self):
        from core import load_style_settings
        with tempfile.TemporaryDirectory() as directory:
            ref=Path(directory)/'ref.wav';ref.write_bytes(b'ref')
            self.assertEqual(list(load_style_settings(Settings('tts','asr',str(ref),'reference'))),['default'])

if __name__=='__main__': unittest.main()
