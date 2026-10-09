import types
import unittest
import numpy as np
from decoder_prime import DecoderPrimer
from core import Settings


class Decoder:
    def __init__(self):
        self._buffer = None
        self._overflow = None
        self._transformer_cache = None
    def reset_streaming_state(self):
        self._buffer = self._overflow = self._transformer_cache = None
    def named_modules(self):
        return [("", self)]
    def streaming_step(self, codes):
        self._buffer = codes.copy()
        self._overflow = codes.copy() + 1
        self._transformer_cache = [types.SimpleNamespace(keys=codes.copy(), values=codes.copy(), offset=codes.shape[-1])]
        return codes


class PrimerTests(unittest.TestCase):
    def primer(self):
        decoder = Decoder()
        mx = types.SimpleNamespace(array=lambda a: np.array(a, copy=True), eval=lambda *a: None)
        return DecoderPrimer(types.SimpleNamespace(decoder=decoder), mx)
    def test_reset_primes_only_first_stream_reset_and_cleanup_clears_state(self):
        p = self.primer(); p.prepare("warm", np.arange(70)[None, None, :], 50)
        self.assertIsNone(p.decoder._buffer)
        p.begin("warm"); p.decoder.reset_streaming_state()
        np.testing.assert_array_equal(p.decoder._buffer, np.arange(20, 70)[None, None, :])
        self.assertEqual(p.decoder._transformer_cache[0].offset, 50)
        p.decoder.reset_streaming_state()
        self.assertIsNone(p.decoder._buffer)
        p.begin("warm"); p.end(); p.decoder.reset_streaming_state()
        self.assertIsNone(p.decoder._buffer)
    def test_snapshots_are_style_specific_and_kv_mutation_cannot_change_saved_state(self):
        p = self.primer(); p.prepare("default", np.ones((1, 1, 60)), 50)
        p.prepare("warm", np.ones((1, 1, 60))*2, 50)
        for style, value in [("default", 1), ("warm", 2), ("default", 1)]:
            p.begin(style); p.decoder.reset_streaming_state()
            self.assertEqual(p.decoder._transformer_cache[0].keys[0, 0, 0], value)
            p.decoder._transformer_cache[0].keys[:] = 999
            p.decoder._transformer_cache[0].offset = 999
        p.end()
        with self.assertRaises(ValueError): p.begin("missing")
    def test_different_instances_do_not_share_reset_hooks(self):
        first, second = self.primer(), self.primer()
        first.prepare("default", np.ones((1, 1, 50)), 50)
        first.begin("default"); second.decoder.reset_streaming_state()
        self.assertIsNone(second.decoder._buffer)
        first.decoder.reset_streaming_state(); self.assertIsNotNone(first.decoder._buffer)
    def test_hash_changes_when_priming_is_disabled(self):
        common = dict(tts_model="tts", asr_model="asr", ref_audio="unused", ref_text="reference", ref_bytes=b"pcm")
        self.assertNotEqual(Settings(**common).ref_hash(), Settings(**common, decoder_prime_frames=0).ref_hash())


if __name__ == "__main__": unittest.main()
