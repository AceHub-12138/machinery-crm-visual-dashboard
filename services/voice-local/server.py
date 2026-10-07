"""Loopback-only ASR/TTS HTTP service with a single GPU worker and bounded streams."""
from __future__ import annotations

import asyncio
import concurrent.futures
import io
import logging
import threading
import time
import uuid
import wave
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from core import Settings, MlxBackend, GenerationCancelled, SAMPLE_RATE, SELF_CHECK_TEXT, cer, guarded_audio, pcm_peak

LOG = logging.getLogger("voice-local")
MAX_BODY = 524288
MAX_TEXT = 400


@dataclass
class Job:
    id: str
    cancel: threading.Event = field(default_factory=threading.Event)
    stats: dict = field(default_factory=dict)
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=4))
    ready: asyncio.Future | None = None
    future: asyncio.Future | None = None
    finished: bool = False
    created: float = field(default_factory=time.monotonic)


class Runtime:
    def __init__(self, settings, backend):
        self.settings, self.backend = settings, backend
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="speech-gpu")
        self.jobs = {}
        self.warm = False
        self.self_check = "pending"
        self.self_check_cer = None
        self.ref_hash = ""
        self.counts = {"ttsRequests": 0, "asrRequests": 0, "ttsRegenerated": 0, "ttsTruncated": 0, "ttsFail": 0, "cancelled": 0}

    def initialize(self):
        self.backend.load()
        self.ref_hash = self.settings.ref_hash()
        cancel = threading.Event()
        stats = {}
        try:
            pcm = b"".join(guarded_audio(self.backend, self.settings, SELF_CHECK_TEXT, cancel, stats))
            self.warm = True
            if stats.get("ttsFail") or stats.get("ttsTruncated") or len(pcm) < SAMPLE_RATE * 2 * 0.3 or pcm_peak(pcm) < self.settings.silence_peak:
                raise ValueError("Silent self check")
            audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
            resampled = np.interp(np.arange(round(len(audio) * 16000 / SAMPLE_RATE)) * SAMPLE_RATE / 16000, np.arange(len(audio)), audio).astype(np.float32)
            recognized = self.backend.recognize(resampled, cancel)
            self.self_check_cer = cer(SELF_CHECK_TEXT, recognized)
            self.self_check = "passed" if self.self_check_cer <= 0.2 else "failed"
        except Exception:
            # Keep ASR warm even when synthesis or its reference pair fails.
            try:
                self.backend.recognize(np.zeros(1600, dtype=np.float32), cancel)
            except Exception:
                LOG.error("ASR warmup failed")
            self.warm = True
            self.self_check = "failed"
        if self.self_check == "failed":
            LOG.error("TTS self-check failed; ASR remains available and TTS is muted")

    def create_job(self):
        # Keep completed job metrics briefly, never retain text or audio in this ledger.
        now = time.monotonic()
        for key in list(self.jobs):
            if self.jobs[key].finished and now - self.jobs[key].created > 120:
                del self.jobs[key]
        if sum(not job.finished for job in self.jobs.values()) >= 8:
            raise HTTPException(429, "Speech queue is full")
        if len(self.jobs) >= 256:
            for key, job in list(self.jobs.items()):
                if job.finished:
                    del self.jobs[key]
                    break
        job = Job(uuid.uuid4().hex)
        self.jobs[job.id] = job
        return job

    async def close(self):
        for job in self.jobs.values():
            job.cancel.set()
        await asyncio.to_thread(self.executor.shutdown, wait=True, cancel_futures=True)

    def health(self):
        return {"warm": self.warm, "selfCheck": self.self_check, "selfCheckCer": self.self_check_cer,
                "models": {"tts": self.settings.tts_model.rsplit("/", 1)[-1], "asr": self.settings.asr_model.rsplit("/", 1)[-1]},
                "refHash": self.ref_hash, "styles": [self.settings.style], "metrics": self.counts,
                "activeJobs": sum(not job.finished for job in self.jobs.values())}


def decode_audio(raw: bytes):
    if raw[:4] == b"RIFF":
        try:
            with wave.open(io.BytesIO(raw)) as wav:
                if wav.getframerate() != 16000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getcomptype() != "NONE":
                    raise ValueError("WAV must be 16kHz/mono/int16 PCM")
                raw = wav.readframes(wav.getnframes())
        except (wave.Error, EOFError) as error:
            raise ValueError("Invalid WAV") from error
    if not raw or len(raw) % 2 or len(raw) > 16000 * 2 * 15:
        raise ValueError("Audio must be aligned 16kHz mono int16 PCM, between 1 sample and 15s")
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768


async def limited_body(request: Request, limit: int):
    length = request.headers.get("content-length")
    if length is not None:
        try:
            if int(length) < 0 or int(length) > limit:
                raise HTTPException(413, "Request too large")
        except ValueError:
            raise HTTPException(400, "Invalid content length")
    parts, size = [], 0
    async for part in request.stream():
        size += len(part)
        if size > limit:
            raise HTTPException(413, "Request too large")
        parts.append(part)
    return b"".join(parts)


async def until_disconnected(request: Request, job: Job):
    while not job.finished:
        if await request.is_disconnected():
            job.cancel.set()
            return
        await asyncio.sleep(0.01)


def create_app(settings=None, backend=None):
    settings = settings or Settings.from_env()
    runtime = Runtime(settings, backend or MlxBackend(settings))

    @asynccontextmanager
    async def lifespan(_app):
        await asyncio.get_running_loop().run_in_executor(runtime.executor, runtime.initialize)
        try:
            yield
        finally:
            await runtime.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.runtime = runtime

    @app.get("/health")
    async def health():
        return runtime.health()

    @app.get("/jobs/{job_id}")
    async def metrics(job_id: str):
        job = runtime.jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Unknown job")
        return {**job.stats, "finished": job.finished, "cancelled": job.cancel.is_set()}

    @app.post("/asr")
    async def asr(request: Request):
        if request.headers.get("content-type", "").split(";")[0] not in ("audio/pcm", "audio/wav", "application/octet-stream"):
            raise HTTPException(415, "Expected PCM or WAV")
        try:
            audio = decode_audio(await limited_body(request, MAX_BODY))
        except ValueError as error:
            raise HTTPException(400, str(error))
        if len(audio) < 1600:
            return {"text": "", "ms": 0}
        job = runtime.create_job()
        runtime.counts["asrRequests"] += 1
        def recognize():
            started = time.perf_counter()
            try:
                return {"text": runtime.backend.recognize(audio, job.cancel), "ms": round((time.perf_counter() - started) * 1000, 1)}
            finally:
                job.finished = True
        watcher = asyncio.create_task(until_disconnected(request, job))
        try:
            job.future = asyncio.get_running_loop().run_in_executor(runtime.executor, recognize)
            return await asyncio.shield(job.future)
        except GenerationCancelled:
            raise HTTPException(499, "Recognition cancelled")
        except asyncio.CancelledError:
            job.cancel.set()
            raise
        finally:
            watcher.cancel()

    @app.post("/tts")
    async def tts(request: Request):
        if runtime.self_check != "passed":
            raise HTTPException(503, "TTS self-check failed")
        import json
        try:
            body = json.loads(await limited_body(request, 8192))
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(400, "Invalid JSON")
        if not isinstance(body, dict) or set(body) - {"text", "style"}:
            raise HTTPException(400, "Expected text and optional style")
        text = body.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            raise HTTPException(400, "Text must contain 1–400 characters")
        if body.get("style", settings.style) != settings.style:
            raise HTTPException(400, "Unknown style")
        job = runtime.create_job()
        runtime.counts["ttsRequests"] += 1
        loop = asyncio.get_running_loop()
        job.ready = loop.create_future()
        def clear_output():
            while not job.queue.empty():
                job.queue.get_nowait()
        def resolve_ready(value):
            if not job.ready.done():
                job.ready.set_result(value)
        def put(event):
            pending = asyncio.run_coroutine_threadsafe(job.queue.put(event), loop)
            while True:
                try:
                    pending.result(timeout=0.02)
                    return
                except concurrent.futures.TimeoutError:
                    if job.cancel.is_set():
                        pending.cancel()
                        raise GenerationCancelled()
        def produce():
            started = time.perf_counter()
            sent = False
            try:
                for pcm in guarded_audio(runtime.backend, settings, text.strip(), job.cancel, job.stats):
                    if not sent:
                        sent = True
                        job.stats["ttsFirstByteMs"] = round((time.perf_counter() - started) * 1000, 1)
                        loop.call_soon_threadsafe(resolve_ready, True)
                    put(pcm)
            except GenerationCancelled:
                runtime.counts["cancelled"] += 1
            except Exception:
                job.stats["ttsFail"] = 1
            finally:
                job.finished = True
                job.stats["durationMs"] = round((time.perf_counter() - started) * 1000, 1)
                for key in ("ttsRegenerated", "ttsTruncated", "ttsFail"):
                    runtime.counts[key] += job.stats.get(key, 0)
                loop.call_soon_threadsafe(resolve_ready, sent)
                if not job.cancel.is_set():
                    try:
                        put(None)
                    except GenerationCancelled:
                        pass
                if job.cancel.is_set():
                    loop.call_soon_threadsafe(clear_output)
        job.future = loop.run_in_executor(runtime.executor, produce)
        watcher = asyncio.create_task(until_disconnected(request, job))
        try:
            audible = await asyncio.shield(job.ready)
        except asyncio.CancelledError:
            job.cancel.set()
            raise
        finally:
            watcher.cancel()
        if not audible:
            raise HTTPException(503, "Synthesis produced no valid audio")
        async def stream():
            drained = False
            try:
                while True:
                    pcm = await job.queue.get()
                    if pcm is None:
                        drained = True
                        break
                    yield pcm
            finally:
                if not drained:
                    job.cancel.set()
                    clear_output()
        return StreamingResponse(stream(), media_type="audio/pcm", headers={
            "X-Sample-Rate": "24000", "X-Channels": "1", "X-Sample-Format": "s16le",
            "X-Voice-Job-Id": job.id, "X-TTS-Regenerated": str(job.stats.get("ttsRegenerated", 0)),
            "Cache-Control": "no-store",
        })

    return app
