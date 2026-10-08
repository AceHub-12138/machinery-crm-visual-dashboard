import type { InputLease, ListenAction } from "./listen-window.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tokensMatch } from "./guard/token.ts";
import { isAllowedOrigin } from "./ws/ws-server.ts";
export class InputError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export function createInputHttpHandler(options: {
  screenToken: string; allowedOrigins?: string[];
  wake: (followup: boolean) => boolean | void;
  activity?: (lease: InputLease, action: ListenAction) => void;
  utterance: (pcm: Uint8Array, signal: AbortSignal, uploadMs: number, lease: InputLease) => Promise<void>;
  config: () => unknown;
}) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const finish = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin, options.allowedOrigins)) { finish(403, { error: "origin_rejected" }); return; }
    if (origin) { res.setHeader("access-control-allow-origin", origin); res.setHeader("vary", "Origin"); }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "OPTIONS") {
      const method = req.headers["access-control-request-method"];
      const headers = String(req.headers["access-control-request-headers"] ?? "").toLowerCase().split(",").map(h => h.trim()).filter(Boolean);
      if (!origin || method !== (path === "/voice/input-config" ? "GET" : "POST") || headers.some(h => !["authorization", "content-type", "x-voice-session", "x-voice-listen"].includes(h))) { finish(403, { error: "preflight_rejected" }); return; }
      res.writeHead(204, { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "Authorization, Content-Type, X-Voice-Session, X-Voice-Listen", "access-control-max-age": "600" }); res.end(); return;
    }
    const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!options.screenToken || !token || token.length > 256 || !tokensMatch(token, options.screenToken)) { finish(401, { error: "unauthorized" }); return; }
    if (path === "/voice/input-config" && req.method === "GET") { finish(200, options.config()); return; }
    if (req.method !== "POST") { finish(405, { error: "method_not_allowed" }); return; }
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", abort);
    const timer = setTimeout(() => { controller.abort(); if (!res.headersSent) finish(408, { error: "request_timeout" }); }, 20000);
    try {
      const expected = path === "/voice/wake" || path === "/voice/listen" ? 0 : 480000;
      if (req.headers["content-length"] && (!/^\d+$/.test(req.headers["content-length"]) || Number(req.headers["content-length"]) > expected)) throw new InputError(413, "request_too_large");
      if (path === "/voice/utterance" && req.headers["content-type"]?.split(";")[0] !== "audio/pcm") throw new InputError(415, "expected_pcm");
      const started = performance.now();
      const parts: Buffer[] = []; let size = 0;
      for await (const part of req) { controller.signal.throwIfAborted(); size += part.length; if (size > expected) throw new InputError(413, "request_too_large"); parts.push(part); }
      controller.signal.throwIfAborted();
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      const lease = () => {
        const sessionId = req.headers["x-voice-session"], listenId = req.headers["x-voice-listen"];
        if (typeof sessionId !== "string" || !/^sess-[a-f0-9-]{1,40}$/.test(sessionId) || typeof listenId !== "string" || !/^[a-f0-9-]{36}$/.test(listenId)) throw new InputError(400, "listen_identity_required");
        return { sessionId, listenId };
      };
      if (path === "/voice/wake") { if (options.wake(query.get("followup") === "1") === false) throw new InputError(409, "wake_not_accepted"); }
      else if (path === "/voice/listen") {
        const action = query.get("action");
        if (!["ready", "speech_start", "misfire"].includes(action ?? "")) throw new InputError(400, "invalid_listen_action");
        if (!options.activity) throw new InputError(503, "input_unavailable");
        options.activity(lease(), action as ListenAction);
      }
      else if (path === "/voice/utterance") {
        if (size < 9600 || size % 2) throw new InputError(400, "pcm_requires_300ms_to_15s_aligned_s16le_16khz_mono");
        await options.utterance(Buffer.concat(parts), controller.signal, performance.now() - started, lease());
      } else throw new InputError(404, "unknown_input_route");
      if (!controller.signal.aborted && !res.headersSent) finish(202, { accepted: true });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) finish(error instanceof InputError ? error.status : controller.signal.aborted ? 408 : 503, { error: error instanceof InputError ? error.message : "recognition_unavailable" });
    } finally { clearTimeout(timer); res.off("close", abort); }
  };
}
