// Copy pinned installed Silero/ORT runtime into the Site, never fetch at runtime.
import { createRequire } from "node:module";
import { mkdir, readdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const vad = dirname(require.resolve("@ricky0123/vad-web"));
const ort = dirname(require.resolve("onnxruntime-web/wasm"));
const target = new URL("../public/voice/vad/", import.meta.url);
await mkdir(target, { recursive: true });
for (const source of [vad, ort]) for (const name of await readdir(source)) {
  if (name === "silero_vad_v5.onnx" || /^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(name)) await copyFile(join(source, name), new URL(name, target));
}
