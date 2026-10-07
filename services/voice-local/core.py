"""Local speech policy and pinned MLX backend. No reference material is embedded here."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SAMPLE_RATE = 24000
SELF_CHECK_TEXT = "我在,先生。请讲。"


class GenerationCancelled(Exception):
    pass


def check_cancel(cancel: threading.Event):
    if cancel.is_set():
        raise GenerationCancelled()


@dataclass(frozen=True)
class Settings:
    tts_model: str
    asr_model: str
    ref_audio: str
    ref_text: str
    temperature: float = 0.6
    style: str = "default"
    silence_peak: float = 0.001
    seconds_per_char: float = 0.4
    hotwords: tuple[str, ...] = ()

    @classmethod
    def from_env(cls):
        required = ["VOICE_TTS_MODEL", "VOICE_ASR_MODEL", "VOICE_TTS_REF_AUDIO", "VOICE_TTS_REF_TEXT"]
        missing = [name for name in required if not os.environ.get(name, "").strip()]
        if missing:
            raise ValueError("Required paired configuration missing: " + ", ".join(missing))
        settings = cls(
            tts_model=str(Path(os.environ[required[0]]).expanduser().resolve()),
            asr_model=str(Path(os.environ[required[1]]).expanduser().resolve()),
            ref_audio=str(Path(os.environ[required[2]]).expanduser().resolve()),
            ref_text=os.environ[required[3]].strip(),
            temperature=float(os.environ.get("VOICE_TTS_TEMPERATURE", "0.6")),
            style=os.environ.get("VOICE_TTS_STYLE", "default"),
            silence_peak=float(os.environ.get("VOICE_TTS_SILENCE_PEAK", "0.001")),
            seconds_per_char=float(os.environ.get("VOICE_TTS_SECONDS_PER_CHAR", "0.4")),
            hotwords=tuple(word.strip() for word in os.environ.get("VOICE_ASR_HOTWORDS", "回款,跟进待办,成品仓,原材料仓,半成品仓,物料,库存预警,发货,完成率,合同额").split(",") if word.strip()),
        )
        if not 0 <= settings.temperature <= 2 or not 0 < settings.silence_peak < 1 or not 0.1 <= settings.seconds_per_char <= 1:
            raise ValueError("Invalid TTS generation settings")
        if not settings.style or len(settings.style) > 64:
            raise ValueError("Invalid style name")
        return settings

    def ref_hash(self):
        digest = hashlib.sha256()
        digest.update(json.dumps({"model": self.tts_model, "refText": self.ref_text,
                                  "temperature": self.temperature, "style": self.style,
                                  "silencePeak": self.silence_peak, "secondsPerChar": self.seconds_per_char,
                                  "format": "s16le/24000/mono", "version": 1}, ensure_ascii=False, sort_keys=True).encode())
        digest.update(Path(self.ref_audio).read_bytes())
        return digest.hexdigest()


def max_tokens_for(text: str, seconds_per_char=0.4):
    return math.ceil((len(text) * seconds_per_char + 1.5) * 12)


def pcm_peak(pcm: bytes):
    if not pcm or len(pcm) % 2:
        return 0.0
    return float(np.max(np.abs(np.frombuffer(pcm, dtype="<i2").astype(np.int32)))) / 32768


def canonical_text(text: str):
    return "".join(char.lower() for char in text if unicodedata.category(char)[0] in "LN")


def cer(reference: str, recognized: str):
    expected, actual = canonical_text(reference), canonical_text(recognized)
    row = list(range(len(actual) + 1))
    for i, left in enumerate(expected, 1):
        next_row = [i]
        for j, right in enumerate(actual, 1):
            next_row.append(min(row[j] + 1, next_row[j - 1] + 1, row[j - 1] + (left != right)))
        row = next_row
    return row[-1] / max(1, len(expected))


class MlxBackend:
    """All methods run on one dedicated worker. Cancellation is checked per codec sample.

    The two instance-local hooks are tied to mlx-audio 0.5.8; do not patch installed files.
    Atomic GPU kernels/prefill cannot be interrupted; abort stops at the next checkpoint.
    """
    def __init__(self, settings: Settings):
        self.settings = settings
        self.cancel = threading.Event()

    def load(self):
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        import mlx.core as mx
        from mlx_audio.tts.utils import load_model as load_tts
        from mlx_audio.stt.utils import load_model as load_asr
        self.mx = mx
        self.tts = load_tts(self.settings.tts_model)
        self.asr = load_asr(self.settings.asr_model)
        if self.tts.sample_rate != SAMPLE_RATE or self.tts.speech_tokenizer is None:
            raise ValueError("TTS requires a complete 24kHz model with speech tokenizer")
        sampler = self.tts._sample_token
        def checked_sampler(*args, **kwargs):
            check_cancel(self.cancel)
            return sampler(*args, **kwargs)
        object.__setattr__(self.tts, "_sample_token", checked_sampler)
        single_chunk = self.asr._generate_single_chunk
        def checked_asr(*args, **kwargs):
            def processor(_tokens, logits):
                check_cancel(self.cancel)
                return logits
            kwargs["logits_processors"] = [*(kwargs.get("logits_processors") or []), processor]
            return single_chunk(*args, **kwargs)
        object.__setattr__(self.asr, "_generate_single_chunk", checked_asr)

    def generate(self, text: str, cancel: threading.Event, max_tokens: int):
        self.cancel = cancel
        check_cancel(cancel)
        generator = self.tts.generate(
            text=text, ref_audio=self.settings.ref_audio, ref_text=self.settings.ref_text,
            lang_code="Chinese", temperature=self.settings.temperature, max_tokens=max_tokens,
            stream=True, streaming_interval=0.5, verbose=False,
        )
        try:
            for part in generator:
                check_cancel(cancel)
                if part.sample_rate != SAMPLE_RATE:
                    raise ValueError("Unexpected sample rate")
                audio = np.asarray(part.audio, dtype=np.float32).reshape(-1)
                if not np.all(np.isfinite(audio)):
                    raise ValueError("Non-finite audio")
                yield (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes(), part.token_count
        finally:
            generator.close()
            self.tts.speech_tokenizer.decoder.reset_streaming_state()
            self.mx.synchronize()

    def recognize(self, audio: np.ndarray, cancel: threading.Event):
        self.cancel = cancel
        check_cancel(cancel)
        output = self.asr.generate(audio, language="Chinese", hotwords=list(self.settings.hotwords), max_tokens=256)
        check_cancel(cancel)
        self.mx.synchronize()
        return output.text.strip()


def guarded_audio(backend, settings: Settings, text: str, cancel: threading.Event, stats: dict):
    """Retry only before the first audible bytes; stop at both frame and sample budgets."""
    limit = max_tokens_for(text, settings.seconds_per_char)
    max_bytes = math.ceil((len(text) * settings.seconds_per_char + 1.5) * SAMPLE_RATE) * 2
    stats.update(ttsRegenerated=0, ttsTruncated=0, ttsFail=0, tokens=0, bytes=0)
    for attempt in range(2):
        sent = False
        generator = backend.generate(text, cancel, limit)
        try:
            for pcm, tokens in generator:
                check_cancel(cancel)
                if len(pcm) % 2:
                    raise ValueError("Unaligned backend PCM")
                if not sent:
                    peak = pcm_peak(pcm)
                    if peak < settings.silence_peak:
                        stats["rejectedFirstPeak"] = peak
                        break
                    stats["firstPeak"] = peak
                if not pcm:
                    continue
                remaining = max_bytes - stats["bytes"]
                output = pcm[:remaining]
                stats["tokens"] += tokens
                stats["bytes"] += len(output)
                if stats["tokens"] >= limit or len(output) < len(pcm) or stats["bytes"] >= max_bytes:
                    stats["ttsTruncated"] = 1
                if output:
                    sent = True
                    yield output
                if stats["ttsTruncated"]:
                    return
            if sent:
                return
        except GenerationCancelled:
            raise
        except Exception:
            if sent:
                stats["ttsFail"] = 1
                return
        finally:
            generator.close()
        if attempt == 0:
            stats["ttsRegenerated"] = 1
    stats["ttsFail"] = 1
