import threading
import unittest
from gpu_queue import CooperativeGpuExecutor


class QueueTests(unittest.TestCase):
    def test_in_place_priority_before_tts_finishes_and_same_thread(self):
        executor = CooperativeGpuExecutor()
        ready, proceed = threading.Event(), threading.Event()
        events, threads = [], []
        def tts():
            threads.append(threading.get_ident()); events.append("tts-start"); ready.set()
            self.assertTrue(proceed.wait(2))
            executor.checkpoint(); events.append("tts-end")
        running = executor.submit(tts)
        self.assertTrue(ready.wait(2))
        priority = executor.submit_priority(lambda: (threads.append(threading.get_ident()), events.append("asr")))
        ordinary = executor.submit(lambda: events.append("ordinary"))
        proceed.set(); running.result(2); priority.result(2); ordinary.result(2)
        executor.shutdown()
        self.assertEqual(events, ["tts-start", "asr", "tts-end", "ordinary"])
        self.assertEqual(len(set(threads)), 1)

    def test_idle_priority_and_exception_do_not_poison_worker(self):
        executor = CooperativeGpuExecutor()
        def fail(): raise ValueError("ASR error")
        with self.assertRaises(ValueError): executor.submit_priority(fail).result(2)
        self.assertEqual(executor.submit_priority(lambda: 42).result(2), 42)
        self.assertEqual(executor.submit(lambda: 7).result(2), 7)
        executor.shutdown()

    def test_cancelled_queued_asr_is_skipped(self):
        executor = CooperativeGpuExecutor()
        ready, proceed = threading.Event(), threading.Event()
        running = executor.submit(lambda: (ready.set(), proceed.wait(2), executor.checkpoint()))
        self.assertTrue(ready.wait(2)); called = []
        priority = executor.submit_priority(lambda: called.append(True)); self.assertTrue(priority.cancel())
        proceed.set(); running.result(2); executor.shutdown()
        self.assertEqual(called, [])

    def test_shutdown_cancels_pending_priority_and_rejects_new_tasks(self):
        executor = CooperativeGpuExecutor()
        ready, proceed = threading.Event(), threading.Event()
        running = executor.submit(lambda: (ready.set(), proceed.wait(2)))
        self.assertTrue(ready.wait(2)); priority = executor.submit_priority(lambda: 42)
        executor.shutdown(wait=False, cancel_futures=True)
        self.assertTrue(priority.cancelled())
        with self.assertRaises(RuntimeError): executor.submit_priority(lambda: 1)
        proceed.set(); running.result(2); executor.shutdown()

    def test_wrong_thread_checkpoint_is_rejected(self):
        executor = CooperativeGpuExecutor()
        with self.assertRaises(RuntimeError): executor.checkpoint()
        executor.shutdown()
