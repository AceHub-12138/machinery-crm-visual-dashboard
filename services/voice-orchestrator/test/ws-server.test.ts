import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { startVoiceHub } from "../src/ws/ws-server.ts";
import { decodeFrameAt, encodeFrame, acceptKey } from "../src/ws/codec.ts";

describe("ws codec — 帧层纯函数", () => {
  it("握手 accept key 符合 RFC 6455 §1.3 示例值", () => {
    // RFC 文档原例:key "dGhlIHNhbXBsZSBub25jZQ==" → 固定 accept 值
    expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("服务端帧编码:小帧/扩展开关客户端可解", () => {
    const frame = encodeFrame(0x1, Buffer.from("你好", "utf8"));
    expect(frame[0]).toBe(0x81); // FIN + text
    expect(frame[1]).toBe(6); // 6 字节 UTF-8,无掩码
    const decoded = decodeFrameAt(frame);
    expect(decoded.frame?.payload.toString("utf8")).toBe("你好");
    expect(decoded.consumed).toBe(frame.length);
  });

  it("126~65535 长度用 16 位扩展头", () => {
    const body = Buffer.alloc(300, 0x61);
    const decoded = decodeFrameAt(encodeFrame(0x1, body));
    expect(decoded.frame?.payload.length).toBe(300);
  });

  it("不完整帧 consumed=0(增量喂入)", () => {
    const frame = encodeFrame(0x1, Buffer.from("abcdef"));
    expect(decodeFrameAt(frame.subarray(0, 4)).frame).toBeNull();
    expect(decodeFrameAt(frame.subarray(0, 4)).consumed).toBe(0);
  });
});

describe("ws hub — 真实回环(客户端:Node 全局 WebSocket)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const fn of cleanups) await fn();
  });

  it("握手/双向文本/角色计数/断连回调", async () => {
    const received: string[] = [];
    let closed: ((conn: unknown) => void) | null = null;
    const closedPromise = new Promise<unknown>((resolve) => {
      closed = resolve;
    });

    const hub = await startVoiceHub({
      port: 0,
      onMessage: (_conn, raw) => received.push(raw),
      onClose: (conn) => closed?.(conn),
    });
    cleanups.push(() => hub.close());

    const ws = new WebSocket(`ws://localhost:${hub.port}`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws connect failed"));
    });

    // 服务端 → 客户端
    const clientGot = new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(String(e.data));
    });
    hub.broadcast({ hello: true, n: 1 });
    expect(JSON.parse(await clientGot)).toEqual({ hello: true, n: 1 });

    // 客户端 → 服务端(浏览器式客户端自动掩码)
    ws.send(JSON.stringify({ type: "console.hello", role: "console" }));
    await vi_waitFor(() => received.length > 0);
    expect(JSON.parse(received[0])).toEqual({ type: "console.hello", role: "console" });

    // close 回调
    ws.close();
    const closedConn = (await closedPromise) as { id: string };
    expect(closedConn.id).toBeTruthy();
  });

  it("ping → pong(RFC 对拍)", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());
    // Node 全局 WebSocket 会自动回 pong;这里只验证服务端 ping 不炸连接
    const ws = new WebSocket(`ws://localhost:${hub.port}`);
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });
    // 发一个畸形 payload:hub 必须存活
    expect(hub.counts().consoles).toBe(0);
    ws.close();
    await vi_waitFor(() => hub.connections.size === 0);
  });
});

/* ---- 原始帧客户端(绕过浏览器自动掩码,用于对抗性测试) ---- */
async function rawConnect(port: number, headers: Record<string, string> = {}, path = "/"): Promise<import("node:net").Socket> {
  const net = await import("node:net");
  const socket = net.connect({ port, host: "127.0.0.1" });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const key = Buffer.from(randomUUID()).toString("base64");
  const CRLF = String.fromCharCode(13, 10);
  const req =
    `GET ${path} HTTP/1.1${CRLF}Host: 127.0.0.1:${port}${CRLF}Upgrade: websocket${CRLF}Connection: Upgrade${CRLF}` +
    `Sec-WebSocket-Key: ${key}${CRLF}Sec-WebSocket-Version: 13${CRLF}` +
    Object.entries(headers).map(([k, v]) => `${k}: ${v}${CRLF}`).join("") +
    CRLF;
  socket.write(req);
  const first = await new Promise<Buffer>((resolve) => socket.once("data", resolve));
  if (!first.toString().startsWith("HTTP/1.1 101")) {
    throw new Error(`handshake rejected: ${first.toString().split(CRLF)[0]}`);
  }
  return socket;
}

function clientFrame(
  opcode: number,
  payload: Buffer,
  opts: { masked: boolean; fin?: boolean },
): Buffer {
  const { masked, fin = true } = opts;
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const body = masked
    ? Buffer.from(payload.map((b, i) => b ^ mask[i & 3]))
    : payload;
  const b0 = (fin ? 0x80 : 0x00) | opcode;
  const maskBit = masked ? 0x80 : 0x00;
  const header: number[] = [b0];
  if (payload.length < 126) {
    header.push(maskBit | payload.length);
  } else if (payload.length < 65536) {
    header.push(maskBit | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    header.push(
      maskBit | 127, 0, 0, 0, 0,
      (payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff,
      (payload.length >>> 8) & 0xff, payload.length & 0xff,
    );
  }
  return Buffer.concat([Buffer.from(header), masked ? mask : Buffer.alloc(0), body]);
}

describe("ws hub — 安全加固(2026-09-28 审核)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const fn of cleanups) await fn();
  });

  it("跨站 Origin 被拒(403),本机 Origin 放行", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());
    await expect(rawConnect(hub.port, { Origin: "https://evil.example" })).rejects.toThrow("403");
    await expect(rawConnect(hub.port, { Origin: "http://localhost:3015" })).resolves.toBeTruthy();
  });

  it("握手阶段不再做 ?token= 鉴权(改为首帧 hub.auth,审核 H2)", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());
    await expect(rawConnect(hub.port, {}, "/?token=anything")).resolves.toBeTruthy();
  });

  it("未掩码客户端帧 → 1002 关闭(RFC 6455 §5.1)", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());
    const socket = await rawConnect(hub.port);
    const closed = new Promise<number>((resolve) => {
      socket.on("data", (d: Buffer) => {
        if ((d[0] & 0x0f) === 0x8) resolve(d.length >= 4 ? d.readUInt16BE(2) : -1);
      });
    });
    socket.write(clientFrame(0x1, Buffer.from("hello"), { masked: false }));
    expect(await closed).toBe(1002);
  });

  it("分片洪泛:累计总长超限 → 1009 关闭,内存不涨", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());
    const socket = await rawConnect(hub.port);
    const closed = new Promise<number>((resolve) => {
      socket.on("data", (d: Buffer) => {
        if ((d[0] & 0x0f) === 0x8) resolve(d.length >= 4 ? d.readUInt16BE(2) : -1);
      });
    });
    const chunk = Buffer.alloc(64 * 1024, 0x61); // 64KB × 20 = 1.25MB > 1MB 上限
    socket.write(clientFrame(0x1, chunk.subarray(0, 1), { masked: true, fin: false })); // 分片首帧
    for (let i = 1; i < 20; i++) {
      socket.write(clientFrame(0x0, chunk, { masked: true, fin: i === 19 }));
    }
    expect(await closed).toBe(1009);
  }, 15_000);

  it("无起始帧的续帧 → 1002;二进制帧 → 1003", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());

    const s1 = await rawConnect(hub.port);
    const closed1 = new Promise<number>((resolve) => {
      s1.on("data", (d: Buffer) => {
        if ((d[0] & 0x0f) === 0x8) resolve(d.length >= 4 ? d.readUInt16BE(2) : -1);
      });
    });
    s1.write(clientFrame(0x0, Buffer.from("orphan"), { masked: true }));
    expect(await closed1).toBe(1002);

    const s2 = await rawConnect(hub.port);
    const closed2 = new Promise<number>((resolve) => {
      s2.on("data", (d: Buffer) => {
        if ((d[0] & 0x0f) === 0x8) resolve(d.length >= 4 ? d.readUInt16BE(2) : -1);
      });
    });
    s2.write(clientFrame(0x2, Buffer.from("bin"), { masked: true }));
    expect(await closed2).toBe(1003);
  });

  it("默认绑定 127.0.0.1(审核:0.0.0.0 与文档不符)", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());
    expect(hub.host).toBe("127.0.0.1");
  });
});

async function vi_waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("ws hub — 2026-09-30 审核修复", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const fn of cleanups) await fn();
  });

  const closeCodeOf = (socket: import("node:net").Socket) =>
    new Promise<number>((resolve) => {
      let buf = Buffer.alloc(0);
      socket.on("data", (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        // 逐帧扫描(服务端帧不掩码,长度 < 126)
        let off = 0;
        while (off + 2 <= buf.length) {
          const op = buf[off] & 0x0f;
          const len = buf[off + 1] & 0x7f;
          if (off + 2 + len > buf.length) break;
          if (op === 0x8) return resolve(len >= 2 ? buf.readUInt16BE(off + 2) : -1);
          off += 2 + len;
        }
      });
      socket.on("close", () => resolve(-1));
    });

  it("握手后 helloTimeoutMs 内未声明角色 → 4408 关闭(审核 M5)", async () => {
    const hub = await startVoiceHub({ port: 0, helloTimeoutMs: 200 });
    cleanups.push(() => hub.close());
    const socket = await rawConnect(hub.port);
    expect(await closeCodeOf(socket)).toBe(4408);
    await new Promise((r) => setTimeout(r, 50));
    expect(hub.connections.size).toBe(0);
  });

  it("已声明角色的连接不受 hello 截止影响", async () => {
    const hub = await startVoiceHub({
      port: 0,
      helloTimeoutMs: 200,
      onMessage: (conn) => {
        conn.role = "screen";
      },
    });
    cleanups.push(() => hub.close());
    const socket = await rawConnect(hub.port);
    socket.write(clientFrame(0x1, Buffer.from("{}"), { masked: true }));
    await new Promise((r) => setTimeout(r, 400));
    expect(hub.connections.size).toBe(1);
  });

  it("心跳:idleTimeoutMs 内无任何入站数据 → 断开(审核 M5)", async () => {
    const hub = await startVoiceHub({ port: 0, helloTimeoutMs: 0, pingIntervalMs: 100, idleTimeoutMs: 300 });
    cleanups.push(() => hub.close());
    const socket = await rawConnect(hub.port); // 原始 socket 不会自动回 pong
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    expect(hub.connections.size).toBe(0);
  });

  it("超长 ping(>125B)→ 1002(审核 L1)", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());
    const socket = await rawConnect(hub.port);
    const code = closeCodeOf(socket);
    socket.write(clientFrame(0x9, Buffer.alloc(200, 0x61), { masked: true }));
    expect(await code).toBe(1002);
  });

  it("分片控制帧(ping fin=0)→ 1002(审核 L1)", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());
    const socket = await rawConnect(hub.port);
    const code = closeCodeOf(socket);
    socket.write(clientFrame(0x9, Buffer.from("x"), { masked: true, fin: false }));
    expect(await code).toBe(1002);
  });

  it("RSV 位非 0 → 1002(审核 L1)", async () => {
    const hub = await startVoiceHub({ port: 0 });
    cleanups.push(() => hub.close());
    const socket = await rawConnect(hub.port);
    const code = closeCodeOf(socket);
    const frame = clientFrame(0x1, Buffer.from("{}"), { masked: true });
    frame[0] |= 0x40; // RSV1
    socket.write(frame);
    expect(await code).toBe(1002);
  });

  it("拒绝事件走 onError(审核 L3)", async () => {
    const errors: string[] = [];
    const hub = await startVoiceHub({ port: 0, onError: (e) => errors.push(e.message) });
    cleanups.push(() => hub.close());
    await expect(rawConnect(hub.port, { Origin: "https://evil.example" })).rejects.toThrow("403");
    expect(errors.some((m) => m.includes("origin rejected"))).toBe(true);
  });
});
