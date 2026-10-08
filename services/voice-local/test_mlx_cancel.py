"""Exercise actual backend cancellation hooks with fake models, never GPU."""
import sys
import threading
import types
import unittest
from unittest.mock import patch
import numpy as np
from core import MlxBackend, Settings, GenerationCancelled
from gpu_queue import CooperativeGpuExecutor


class CancellationTests(unittest.TestCase):
    def backend(self):
        backend = MlxBackend(Settings("tts", "asr", "unused", "reference"))
        decoder = types.SimpleNamespace(reset_streaming_state=lambda: None)
        class Tts:
            sample_rate = 24000
            speech_tokenizer = types.SimpleNamespace(decoder=decoder)
            def _sample_token(self): return 1
            def generate(self, **kwargs):
                self._sample_token()
                yield types.SimpleNamespace(sample_rate=24000, audio=np.ones(12000) * .1, token_count=6)
        class Asr:
            def _generate_single_chunk(self, **kwargs):
                for processor in kwargs["logits_processors"]: processor([], None)
            def generate(self, audio, **kwargs):
                self._generate_single_chunk()
                return types.SimpleNamespace(text="测试")
        tts, asr = Tts(), Asr()
        modules = {}
        for name in ["mlx", "mlx.core", "mlx_audio.tts.utils", "mlx_audio.stt.utils"]:
            modules[name] = types.ModuleType(name)
        modules["mlx"].core = modules["mlx.core"]
        modules["mlx.core"].synchronize = lambda: None
        modules["mlx_audio.tts.utils"].load_model = lambda _: tts
        modules["mlx_audio.stt.utils"].load_model = lambda _: asr
        with patch.dict(sys.modules, modules): backend.load()
        backend.reference = None; backend.reference_text = "reference"
        return backend

    def test_cancelled_asr_does_not_cancel_suspended_tts(self):
        backend = self.backend(); executor = CooperativeGpuExecutor(); backend.cooperate = executor.checkpoint
        ready, proceed = threading.Event(), threading.Event()
        tts_cancel, asr_cancel = threading.Event(), threading.Event(); asr_cancel.set()
        def tts():
            ready.set(); self.assertTrue(proceed.wait(2))
            return list(backend.generate("测试", tts_cancel, 20))
        running = executor.submit(tts); self.assertTrue(ready.wait(2))
        asr = executor.submit_priority(backend.recognize, np.zeros(1600), asr_cancel)
        proceed.set()
        self.assertEqual(len(running.result(2)), 1)
        with self.assertRaises(GenerationCancelled): asr.result(2)
        executor.shutdown()

    def test_tts_cancel_during_asr_is_still_observed_on_return(self):
        backend = self.backend(); executor = CooperativeGpuExecutor(); backend.cooperate = executor.checkpoint
        ready, proceed = threading.Event(), threading.Event(); tts_cancel = threading.Event()
        def tts():
            ready.set(); self.assertTrue(proceed.wait(2)); return list(backend.generate("测试", tts_cancel, 20))
        running = executor.submit(tts); self.assertTrue(ready.wait(2))
        def asr():
            result = backend.recognize(np.zeros(1600), threading.Event()); tts_cancel.set(); return result
        priority = executor.submit_priority(asr); proceed.set()
        self.assertEqual(priority.result(2), "测试")
        with self.assertRaises(GenerationCancelled): running.result(2)
        executor.shutdown()
