import type { IncomingMessage, ServerResponse } from "node:http";
import { tokensMatch } from "../guard/token.ts";
import { isAllowedOrigin } from "../ws/ws-server.ts";
import type { AudioStore, BufferedSentence } from "./audio-store.ts";

export function createAudioHttpHandler(options: { store: AudioStore; consoleToken: string; screenToken: string; allowedOrigins?: string[] }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const finish = (status: number, body?: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin, options.allowedOrigins)) {
      finish(403, { error: "origin_rejected" }); return;
    }
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
      res.setHeader("access-control-expose-headers", "x-sample-rate,x-channels,x-sample-format");
    }
    // Browsers omit Bearer from OPTIONS. Preflight authorizes no data access;
    // every health/audio GET below still requires one of the two role tokens.
    if (req.method === "OPTIONS") {
      const requested = String(req.headers["access-control-request-headers"] ?? "").toLowerCase().split(",").map((v) => v.trim()).filter(Boolean);
      if (!origin || req.headers["access-control-request-method"] !== "GET" || requested.some((v) => v !== "authorization")) {
        finish(403, { error: "preflight_rejected" }); return;
      }
      res.writeHead(204, { "access-control-allow-methods": "GET", "access-control-allow-headers": "Authorization", "access-control-max-age": "600" });
      res.end(); return;
    }
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token || token.length > 256 || ![options.consoleToken, options.screenToken].some((expected) => expected && tokensMatch(token, expected))) {
      finish(401, { error: "unauthorized" }); return;
    }
    if (req.method !== "GET") { finish(405, { error: "method_not_allowed" }); return; }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/voice/health") { finish(200, { tts: options.store.status }); return; }
    if (!options.store.ready) { finish(503, { error: "tts_unavailable" }); return; }
    const fixed = /^\/voice\/audio\/fixed\/([a-z]+)$/.exec(path);
    const headers = { "content-type": "audio/pcm", "cache-control": "no-store", "x-sample-rate": "24000", "x-channels": "1", "x-sample-format": "s16le" };
    if (fixed) {
      const pcm = options.store.fixed(fixed[1]);
      if (!pcm) { finish(404, { error: "unknown_fixed_line" }); return; }
      res.writeHead(200, { ...headers, "content-length": String(pcm.length) });
      res.end(pcm); return;
    }
    const audio = /^\/voice\/audio\/([a-f0-9-]{36})\/(0|[1-9]\d*)$/.exec(path);
    if (!audio) { finish(404, { error: "unknown_audio" }); return; }
    const turn = options.store.lookup(audio[1]);
    if (!turn) { finish(options.store.isGone(audio[1]) ? 410 : 404, { error: "unknown_turn" }); return; }
    if (turn.cancelled) { finish(410, { error: "turn_cancelled" }); return; }
    const sentence = turn.sentences[Number(audio[2])];
    if (!sentence) { finish(404, { error: "unknown_sentence" }); return; }
    const consumer = new AbortController();
    const onClose = () => consumer.abort();
    res.once("close", onClose);
    let index = 0;
    try {
      for (;;) {
        if (consumer.signal.aborted) return;
        if (turn.cancelled) {
          if (res.headersSent) res.destroy();
          else finish(410, { error: "turn_cancelled" });
          return;
        }
        while (index < sentence.chunks.length) {
          if (!res.headersSent) res.writeHead(200, headers);
          if (!res.write(sentence.chunks[index++])) await drained(res, consumer.signal);
          if (consumer.signal.aborted || turn.cancelled) break;
        }
        if (turn.cancelled) continue;
        if (sentence.state !== "pending") {
          if (!res.headersSent) res.writeHead(204, { "cache-control": "no-store" });
          res.end(); return;
        }
        await changed(sentence, consumer.signal);
      }
    } finally {
      res.off("close", onClose);
    }
  };
}

function changed(sentence: BufferedSentence, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => { sentence.waiters.delete(wake); signal.removeEventListener("abort", wake); resolve(); };
    sentence.waiters.add(wake);
    signal.addEventListener("abort", wake, { once: true });
    if (signal.aborted) wake();
  });
}
function drained(res: ServerResponse, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => { res.off("drain", wake); signal.removeEventListener("abort", wake); resolve(); };
    res.once("drain", wake);
    signal.addEventListener("abort", wake, { once: true });
    if (signal.aborted) wake();
  });
}
