/* sherpa-onnx inference is isolated from the UI and microphone worklet. */
/* global importScripts, createKws, Module */
let spotter, stream, ready = false, epoch = 0, energy = [], minEnergy = .01;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      minEnergy = data.kwsEnergy;
      const response = await fetch("/voice/kws/keywords.txt");
      if (!response.ok) throw new Error("keywords_missing");
      const keywords = await response.text();
      const phrase = data.wakePhrase.replace(/[\s，,]/g, "");
      if (!keywords.includes(`@${phrase}`)) throw new Error("keywords_phrase_mismatch");
      importScripts("/voice/kws/sherpa-onnx-kws.js");
      self.Module = {
        locateFile: (name) => `/voice/kws/${name}`,
        onAbort: () => self.postMessage({ type: "error" }),
        onRuntimeInitialized: () => {
          try {
            spotter = createKws(Module, {
              featConfig: { samplingRate: 16000, featureDim: 80 },
              modelConfig: { transducer: {
                encoder: "./encoder-epoch-12-avg-2-chunk-16-left-64.onnx",
                decoder: "./decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
                joiner: "./joiner-epoch-12-avg-2-chunk-16-left-64.onnx",
              }, tokens: "./tokens.txt", provider: "cpu", modelType: "zipformer2", numThreads: 1, debug: 0, modelingUnit: "ppinyin", bpeVocab: "" },
              maxActivePaths: 4, numTrailingBlanks: 1, keywordsScore: data.kwsScore, keywordsThreshold: data.kwsThreshold, keywords,
            });
            if (!spotter.handle) throw new Error("kws_model_unavailable");
            stream = spotter.createStream(); ready = true; self.postMessage({ type: "ready" });
          } catch { self.postMessage({ type: "error" }); }
        },
      };
      importScripts("/voice/kws/sherpa-onnx-wasm-kws-main.js");
    } catch { self.postMessage({ type: "error" }); }
  } else if (data.type === "flush") { self.postMessage({ type: "flushed", epoch: data.epoch });
  } else if (data.type === "reset") {
    epoch = data.epoch; energy = [];
    if (ready) { stream.free(); stream = spotter.createStream(); }
  } else if (data.type === "audio" && ready) {
    if (data.epoch !== epoch) return;
    let sum = 0; for (const sample of data.samples) sum += sample * sample;
    energy.push(Math.sqrt(sum / data.samples.length)); if (energy.length > 32) energy.shift();
    stream.acceptWaveform(16000, data.samples);
    while (spotter.isReady(stream)) spotter.decode(stream);
    const result = spotter.getResult(stream);
    if (result.keyword) {
      if (Math.max(...energy) >= minEnergy) self.postMessage({ type: "keyword", keyword: result.keyword, epoch });
      spotter.reset(stream); energy = [];
    }
  }
};
