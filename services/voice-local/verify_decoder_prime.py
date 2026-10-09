"""True-model same-code comparison: snapshot vs live prime vs offline decode."""
import argparse
import json
import os
import threading
import time
import wave
from pathlib import Path
import numpy as np
from core import MlxBackend, Settings, load_style_settings, max_tokens_for

TEXTS = [
    "先生,本月合同额一千二百八十六万元,已完成月度目标的百分之一百一十点二。",
    "先生,目前完成率百分之八十二,距离目标还差两千七百一十六万元。",
    "近期有三笔发货安排,最近一笔在十月十二日发往山东滕州。",
    "有事您再叫我,先生。",
    "先生,今天有十二项跟进待办,其中三项已经逾期。",
]


def f0_span(audio):
    win, hop, lo, hi = 960, 480, 80, 400
    frames = [audio[i:i+win] for i in range(0, len(audio)-win, hop)]
    rms = np.array([np.sqrt(np.mean(frame ** 2)) for frame in frames])
    threshold = max(np.percentile(rms, 10)*3, rms.max()*.08)
    pitches = []
    for frame, energy in zip(frames, rms):
        if energy <= threshold:
            continue
        frame = frame-frame.mean()
        ac = np.correlate(frame, frame, "full")[len(frame)-1:]
        if ac[0] <= 0:
            continue
        region = ac[lo:hi+1]/ac[0]
        peak = int(np.argmax(region))
        if region[peak] >= .3:
            pitches.append(24000/(lo+peak))
    return float(12*np.log2(np.percentile(pitches, 90)/np.percentile(pitches, 10)))


def save_wav(path, audio):
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000)
        output.writeframes((np.clip(audio, -1, 1)*32767).astype("<i2").tobytes())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--samples", required=True)
    args = parser.parse_args()
    for line in Path(args.env_file).read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
    settings = load_style_settings(Settings.from_env())["default"]
    backend = MlxBackend(settings); backend.load(); backend.set_reference(settings)
    mx, primer = backend.mx, backend.primer
    decoder = primer.decoder
    step = decoder.streaming_step
    captured = []
    def capture(codes):
        captured.append(codes)
        return step(codes)
    object.__setattr__(decoder, "streaming_step", capture)
    reference = backend.reference_codes["default"]
    out, samples = Path(args.out), Path(args.samples)
    out.parent.mkdir(parents=True, exist_ok=True); samples.mkdir(parents=True, exist_ok=True)
    report = {"frames":settings.decoder_prime_frames,"rows":[],"scope":"same-code true model, no physical listening"}
    for index, text in enumerate(TEXTS):
        mx.random.seed(1000+index); captured.clear()
        list(backend.generate(text, threading.Event(), max_tokens_for(text)))
        chunks = list(captured)
        codes = mx.concatenate(chunks, axis=-1)
        full_codes = mx.transpose(mx.concatenate([reference, codes], axis=-1), (0, 2, 1))
        audio, lengths = backend.tts.speech_tokenizer.decode(full_codes)
        offline = np.asarray(audio[0], dtype=np.float32).reshape(-1)[:int(lengths[0])]
        offline = offline[reference.shape[-1]*backend.tts.speech_tokenizer.decode_upsample_rate:]
        def decode(mode):
            primer.reset()
            started = time.perf_counter()
            if mode == "snapshot": primer.restore(primer.snapshots["default"])
            elif mode == "live": mx.eval(step(reference[..., -settings.decoder_prime_frames:]))
            elapsed = (time.perf_counter()-started)*1000
            output = np.concatenate([np.asarray(step(chunk).squeeze(1)[0], dtype=np.float32) for chunk in chunks])
            primer.reset()
            return output, elapsed
        before, _ = decode("zero")
        live, live_ms = decode("live")
        restored, restore_ms = decode("snapshot")
        repeated, _ = decode("snapshot")
        n = min(len(offline), len(restored))
        snr = float(10*np.log10(np.sum(offline[:n]**2)/max(np.sum((restored[:n]-offline[:n])**2), 1e-12)))
        row = {"index":index+1,"snapshotSampleIdentical":bool(np.array_equal(live, restored)),"repeatSampleIdentical":bool(np.array_equal(restored,repeated)),"restoreMs":restore_ms,"livePrimeMs":live_ms,"snrDb":snr,"offlineSpan":f0_span(offline),"streamSpan":f0_span(restored)}
        row["spanDelta"] = abs(row["offlineSpan"]-row["streamSpan"])
        report["rows"].append(row)
        save_wav(samples/f"default_{index+1}_修复前.wav", before)
        save_wav(samples/f"default_{index+1}_修复后.wav", restored)
        report["passed"] = all(r["snapshotSampleIdentical"] and r["repeatSampleIdentical"] and r["snrDb"] >= 11 and r["spanDelta"] <= .5 for r in report["rows"])
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n")
        print(json.dumps(row), flush=True)
    object.__setattr__(decoder, "streaming_step", step)


if __name__ == "__main__":
    main()
