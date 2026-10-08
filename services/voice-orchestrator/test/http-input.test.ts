import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createInputHttpHandler } from "../src/http-input";
let server: Server, url: string;
const wake = vi.fn(), utterance = vi.fn(async () => {});
const token = "input-screen-token-123";
beforeEach(async () => {
  wake.mockReset(); wake.mockImplementation(f => !f); utterance.mockClear();
  server = createServer(createInputHttpHandler({ screenToken: token, wake, utterance, config: () => ({ hangoverMs: 500 }) }));
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
const headers = { authorization: `Bearer ${token}`, "content-type": "audio/pcm", "x-voice-screen": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "x-voice-session": "sess-aaaaaaaa", "x-voice-listen": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
describe("screen HTTP input boundary", () => {
  it("requires screen token and allowed origin, rejects console tokens", async () => {
    expect((await fetch(url + "/voice/wake", { method: "POST" })).status).toBe(401);
    expect((await fetch(url + "/voice/wake", { method: "POST", headers: { authorization: "Bearer console-token-123" } })).status).toBe(401);
    expect((await fetch(url + "/voice/wake", { method: "POST", headers: { ...headers, origin: "https://evil.example" } })).status).toBe(403);
    expect(wake).not.toHaveBeenCalled();
  });
  it("validates PCM duration/alignment/content-type before reaching ASR", async () => {
    for (const length of [2, 9599, 9601, 480002]) expect((await fetch(url + "/voice/utterance", { method: "POST", headers, body: new Uint8Array(length) })).status).toBe(length > 480000 ? 413 : 400);
    expect((await fetch(url + "/voice/utterance", { method: "POST", headers: { ...headers, "content-type": "audio/webm" }, body: new Uint8Array(9600) })).status).toBe(415);
    expect(utterance).not.toHaveBeenCalled();
    expect((await fetch(url + "/voice/utterance", { method: "POST", headers, body: new Uint8Array(9600) })).status).toBe(202);
    expect(utterance).toHaveBeenCalledOnce();
  });
  it("supports wake and followup reservation without exposing a WS control command", async () => {
    expect((await fetch(url + "/voice/wake", { method: "POST", headers })).status).toBe(202);
    expect(wake).toHaveBeenLastCalledWith(false, headers["x-voice-screen"]);
    await fetch(url + "/voice/wake?followup=1", { method: "POST", headers });
    expect(wake).toHaveBeenLastCalledWith(true, headers["x-voice-screen"]);
    expect((await fetch(url + "/voice/input-config", { headers })).status).toBe(200);
  });
  it("authorizes preflight without authorizing the later request", async () => {
    expect((await fetch(url + "/voice/utterance", { method: "OPTIONS", headers: { origin: "http://localhost:3015", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,x-voice-session,x-voice-listen,x-voice-screen" } })).status).toBe(204);
    expect((await fetch(url + "/voice/utterance", { method: "POST", headers: { "content-type": "audio/pcm" }, body: new Uint8Array(9600) })).status).toBe(401);
  });
});

it("returns 409 for unaccepted wake and requires bounded session identity",async()=>{
 wake.mockReturnValue(false);expect((await fetch(url+'/voice/wake',{method:'POST',headers})).status).toBe(409);
 expect((await fetch(url+'/voice/utterance',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'audio/pcm'},body:new Uint8Array(9600)})).status).toBe(400);
 const r=await fetch(url+'/voice/listen?action=ready',{method:'OPTIONS',headers:{origin:'http://localhost:3015','access-control-request-method':'POST','access-control-request-headers':'x-voice-session,x-voice-listen,authorization'}});
 expect(r.status).toBe(204);expect(r.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-voice-listen');
});

it('requires a bounded screen identity and preflight exposes the identity header',async()=>{
 for(const id of [undefined,'unknown','x'.repeat(500)]){
  const h:Record<string,string>={authorization:`Bearer ${token}`};if(id)h['x-voice-screen']=id;
  expect((await fetch(url+'/voice/wake',{method:'POST',headers:h})).status).toBe(400);
 }
 expect(wake).not.toHaveBeenCalled();
 const r=await fetch(url+'/voice/wake',{method:'OPTIONS',headers:{origin:'http://localhost:3015','access-control-request-method':'POST','access-control-request-headers':'authorization,x-voice-screen'}});
 expect(r.status).toBe(204);expect(r.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-voice-screen');
});
