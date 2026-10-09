"""Instance-only streaming decoder priming for pinned mlx-audio 0.5.8."""
from copy import copy


class DecoderPrimer:
    def __init__(self, tokenizer, mx):
        # post_load_hook wraps __call__ in mlx.gc_func; bound reset retains the real instance.
        self.decoder = tokenizer.decoder.reset_streaming_state.__self__
        self.mx = mx
        self.reset = self.decoder.reset_streaming_state
        self.snapshots = {}
        self.pending = None

        def reset_for_stream():
            self.reset()
            style, self.pending = self.pending, None
            if style is not None:
                self.restore(self.snapshots[style])
        object.__setattr__(self.decoder, "reset_streaming_state", reset_for_stream)

    def capture(self):
        buffers = []
        for _, module in self.decoder.named_modules():
            for name in ("_buffer", "_overflow"):
                if hasattr(module, name):
                    buffers.append((module, name, getattr(module, name)))
        caches = []
        for cache in self.decoder._transformer_cache or []:
            saved = copy(cache)
            # KVCache updates arrays with indexed assignment. Never share mutable arrays.
            saved.keys = self.mx.array(cache.keys)
            saved.values = self.mx.array(cache.values)
            caches.append(saved)
        self.mx.eval([value for _, _, value in buffers if value is not None],
                     [(cache.keys, cache.values) for cache in caches])
        return buffers, caches

    def restore(self, snapshot):
        buffers, caches = snapshot
        for module, name, value in buffers:
            setattr(module, name, value)
        restored = []
        for cache in caches:
            current = copy(cache)
            current.keys = self.mx.array(cache.keys)
            current.values = self.mx.array(cache.values)
            restored.append(current)
        self.decoder._transformer_cache = restored or None

    def prepare(self, style, codes, frames):
        self.pending = None
        self.reset()
        self.mx.eval(self.decoder.streaming_step(codes[..., -frames:]))
        self.snapshots[style] = self.capture()
        self.reset()

    def begin(self, style):
        if style not in self.snapshots:
            raise ValueError("Decoder prime snapshot missing for style")
        self.pending = style

    def end(self):
        self.pending = None
        self.reset()
