"""One GPU thread with cooperative ASR priority checkpoints inside TTS.

Priority futures are independent from queued drain tasks: a running TTS task
can execute them in-place, avoiding a second model/GPU thread or deadlock.
"""
from collections import deque
from concurrent.futures import Executor, Future, ThreadPoolExecutor
import threading


class CooperativeGpuExecutor(Executor):
    def __init__(self, max_priority=8):
        self._worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="speech-gpu")
        self._lock = threading.Lock()
        self._priority = deque()
        self._closed = False
        self._owner = None
        self._draining = False
        self._max_priority = max_priority

    def submit(self, fn, /, *args, **kwargs):
        def run():
            self._owner = threading.get_ident()
            try:
                self.checkpoint()
                return fn(*args, **kwargs)
            finally:
                self.checkpoint()
        with self._lock:
            if self._closed:
                raise RuntimeError("GPU executor is closed")
            return self._worker.submit(run)

    def submit_priority(self, fn, /, *args, **kwargs):
        future = Future()
        with self._lock:
            if self._closed:
                raise RuntimeError("GPU executor is closed")
            if len(self._priority) >= self._max_priority:
                raise RuntimeError("ASR priority queue is full")
            self._priority.append((future, fn, args, kwargs))
            # Runs when idle or after pending ordinary work; a TTS checkpoint
            # may consume this future before the drain task itself is reached.
            self._worker.submit(self._drain)
        return future

    def _drain(self):
        self._owner = threading.get_ident()
        self.checkpoint()

    def checkpoint(self):
        if self._draining:
            return
        if self._owner != threading.get_ident():
            raise RuntimeError("ASR checkpoint must run on the GPU worker")
        self._draining = True
        try:
            while True:
                with self._lock:
                    if not self._priority:
                        return
                    future, fn, args, kwargs = self._priority.popleft()
                if not future.set_running_or_notify_cancel():
                    continue
                try:
                    future.set_result(fn(*args, **kwargs))
                except BaseException as error:
                    future.set_exception(error)
        finally:
            self._draining = False

    def shutdown(self, wait=True, *, cancel_futures=False):
        with self._lock:
            self._closed = True
            if cancel_futures:
                while self._priority:
                    self._priority.popleft()[0].cancel()
        self._worker.shutdown(wait=wait, cancel_futures=cancel_futures)
