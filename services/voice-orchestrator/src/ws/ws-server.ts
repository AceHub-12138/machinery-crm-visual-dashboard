/**
 * 编排服务 WS hub(plan §9:编排服务 = WS hub + 会话状态;零依赖实现)。
 *
 * 客户端:大屏覆盖层(纯订阅)与 /voice-console 对话台(可发控制事件)。
 * 本模块只管连接与帧,不解析业务语义;事件解析在 orchestrator.ts(fail-closed)。
 *
 * 安全基线(2026-09-28 安全审核后加固):
 * - 默认只绑 127.0.0.1;跨机部署必须显式 VOICE_HUB_HOST=0.0.0.0;
 * - upgrade 阶段校验 Origin(默认仅允许本机来源;浏览器 WS 不受同源策略保护,
 *   不校验 = 运维机器上任意网页可跨站劫持,读经营数据/操纵大屏/烧 LLM 额度);
 * - 鉴权改为首帧 hub.auth,由 orchestrator 处理;
 * - 连接数上限;分片帧累计总长上限(防内存打爆);客户端帧必须掩码;
 *   无起始帧的续帧拒绝;二进制/未知 opcode 以 1003 关闭。
 * - 2026-09-30:hello 截止(4408)、心跳空闲断开、控制帧 ≤125B 且不分片、RSV 必须为 0。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import {
  acceptKey,
  decodeFrameAt,
  encodeFrame,
  OP_CLOSE,
  OP_CONTINUATION,
  OP_PING,
  OP_PONG,
  OP_TEXT,
} from "./codec.ts";

export type HubClientRole = "screen" | "console" | "unknown";

export type HubConnection = {
  readonly id: string;
  role: HubClientRole;
  send(payload: unknown): void;
  close(code?: number): void;
};

export type VoiceHubServer = {
  readonly port: number;
  readonly host: string;
  readonly connections: Set<HubConnection>;
  broadcast(payload: unknown, filter?: (conn: HubConnection) => boolean): void;
  counts(): { screens: number; consoles: number };
  close(): Promise<void>;
};

export type VoiceHubCallbacks = {
  onConnection?: (conn: HubConnection) => void;
  onMessage?: (conn: HubConnection, raw: string) => void;
  onClose?: (conn: HubConnection) => void;
  onError?: (err: Error) => void;
};

export type VoiceHubOptions = {
  /** HTTP audio only; websocket frame handling remains unchanged. */
  onHttpRequest?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  port: number;
  /** 默认 127.0.0.1:本机大屏/对话台即全部合法用途;跨机必须显式放开 */
  host?: string;
  /** Origin 白名单(精确匹配,区分端口)。缺省 = 仅本机来源(localhost/
   * 127.0.0.1/[::1]);无 Origin 头的客户端(非浏览器)放行——回环绑定下可接受。 */
  allowedOrigins?: string[];
  /** 握手后多久内必须完成角色声明(conn.role 不再是 unknown),否则 4408 关闭;0 = 关闭此检查。默认 5000 */
  helloTimeoutMs?: number;
  /** 服务端心跳 ping 间隔,默认 25000 */
  pingIntervalMs?: number;
  /** 超过多久没有收到任何入站数据即断开(浏览器会自动回 pong),默认 60000 */
  idleTimeoutMs?: number;
  /** 并发连接上限(防资源耗尽),默认 32 */
  maxConnections?: number;
} & VoiceHubCallbacks;

const MAX_TEXT_PAYLOAD = 1_048_576;

function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string, allowedOrigins?: string[]): boolean {
  return allowedOrigins ? allowedOrigins.includes(origin) : isLocalOrigin(origin);
}

export function startVoiceHub(options: VoiceHubOptions): Promise<VoiceHubServer> {
  const {
    port,
    host = "127.0.0.1",
    allowedOrigins,
    helloTimeoutMs = 5_000,
    pingIntervalMs = 25_000,
    idleTimeoutMs = 60_000,
    maxConnections = 32,
    onConnection,
    onMessage,
    onClose,
    onError,
  } = options;
  const connections = new Set<HubConnection>();
  const httpServer: Server = createServer((req, res) => {
    if ((req.url ?? "").split("?")[0].startsWith("/voice/")) {
      if (!options.onHttpRequest) { res.writeHead(404); res.end(); return; }
      Promise.resolve().then(() => options.onHttpRequest!(req, res)).catch((err) => {
        onError?.(err as Error);
        if (res.headersSent) res.destroy();
        else { res.writeHead(500); res.end(); }
      });
      return;
    }
    // 纯 WS 服务;HTTP GET 仅给运维一个探活端点(不回显配置细节)
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "voice-orchestrator", screens: counts().screens, consoles: counts().consoles }));
  });

  function counts(): { screens: number; consoles: number } {
    let screens = 0;
    let consoles = 0;
    for (const conn of connections) {
      if (conn.role === "screen") screens += 1;
      if (conn.role === "console") consoles += 1;
    }
    return { screens, consoles };
  }

  function rejectUpgrade(socket: Duplex, status: string): void {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const key = req.headers["sec-websocket-key"];
      const upgrade = req.headers.upgrade?.toLowerCase();
      if (upgrade !== "websocket" || !key) {
        rejectUpgrade(socket, "400 Bad Request");
        return;
      }
      // ---- Origin 校验(跨站 WebSocket 劫持防线;浏览器必发 Origin) ----
      const origin = req.headers.origin;
      if (origin) {
        const ok =
          isAllowedOrigin(origin, allowedOrigins);
        if (!ok) {
          rejectUpgrade(socket, "403 Forbidden");
          onError?.(new Error(`ws origin rejected: ${origin}`));
          return;
        }
      }
      // ---- 共享令牌(?token=)已删除:鉴权改为首帧 hub.auth,由 orchestrator 处理 ----
      if (connections.size >= maxConnections) {
        rejectUpgrade(socket, "503 Service Unavailable");
        onError?.(new Error("ws max connections reached"));
        return;
      }
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n` +
          "\r\n",
      );
      (socket as import("node:net").Socket).setNoDelay(true);
      attachConnection(socket, head);
    } catch (err) {
      rejectUpgrade(socket, "400 Bad Request");
      onError?.(err as Error);
    }
  });

  function attachConnection(socket: Duplex, head: Buffer): void {
    const conn: HubConnection = {
      id: randomUUID(),
      role: "unknown",
      send(payload) {
        if (socket.destroyed || !socket.writable) return;
        try {
          socket.write(encodeFrame(OP_TEXT, Buffer.from(JSON.stringify(payload), "utf8")));
        } catch (err) {
          onError?.(err as Error);
        }
      },
      close(code = 1000) {
        try {
          const body = Buffer.alloc(2);
          body.writeUInt16BE(code, 0);
          socket.write(encodeFrame(OP_CLOSE, body));
        } catch {
          /* ignore */
        }
        socket.end();
      },
    };
    connections.add(conn);
    onConnection?.(conn);

    let buffer = Buffer.alloc(0);
    let fragments: Buffer | null = null; // 进行中的分片聚合(null = 没有未完成消息)
    let closed = false;
    let lastSeen = Date.now();
    const helloTimer =
      helloTimeoutMs > 0
        ? setTimeout(() => {
            if (!closed && conn.role === "unknown") protocolError(4408, "hello timeout");
          }, helloTimeoutMs)
        : null;
    helloTimer?.unref?.();
    const heartbeat = setInterval(() => {
      if (closed) return;
      if (Date.now() - lastSeen > idleTimeoutMs) {
        protocolError(1001, "idle timeout");
        return;
      }
      try {
        if (!socket.destroyed && socket.writable) socket.write(encodeFrame(OP_PING, Buffer.alloc(0)));
      } catch {
        /* ignore */
      }
    }, pingIntervalMs);
    heartbeat.unref?.();
    const stopTimers = () => {
      if (helloTimer) clearTimeout(helloTimer);
      clearInterval(heartbeat);
    };

    const finish = () => {
      if (closed) return;
      stopTimers();
      closed = true;
      connections.delete(conn);
      onClose?.(conn);
      socket.destroy();
    };

    const protocolError = (code: number, why: string) => {
      stopTimers();
      onError?.(new Error(`ws protocol: ${why}`));
      // 先发 close 帧并等待 flush,再销毁——立即 destroy 会 RST 掉 close 帧,
      // 客户端只能看到 ECONNRESET 而拿不到关闭码
      try {
        const body = Buffer.alloc(2);
        body.writeUInt16BE(code, 0);
        socket.write(encodeFrame(OP_CLOSE, body));
        socket.end();
      } catch {
        /* ignore */
      }
      connections.delete(conn);
      if (!closed) {
        closed = true;
        onClose?.(conn);
      }
      const killer = setTimeout(() => socket.destroy(), 250);
      killer.unref?.();
    };

    const deliverText = (payload: Buffer): void => {
      onMessage?.(conn, payload.toString("utf8"));
    };

    const handleFrame = (opcode: number, payload: Buffer, fin: boolean, masked: boolean, rsv: number): void => {
      // RFC 6455 §5.1:客户端→服务端帧必须掩码
      if (!masked) {
        protocolError(1002, "unmasked client frame");
        return;
      }
      // RFC 6455 §5.2:未协商扩展时 RSV1-3 必须为 0
      if (rsv !== 0) {
        protocolError(1002, "non-zero RSV bits");
        return;
      }
      // RFC 6455 §5.5:控制帧(opcode ≥ 0x8)不得分片,payload ≤ 125 字节
      if (opcode >= 0x8 && (!fin || payload.length > 125)) {
        protocolError(1002, "invalid control frame");
        return;
      }
      switch (opcode) {
        case OP_TEXT: {
          if (fragments) {
            protocolError(1002, "new text frame during fragmented message");
            return;
          }
          if (!fin) {
            fragments = Buffer.from(payload);
            return;
          }
          deliverText(payload);
          return;
        }
        case OP_CONTINUATION: {
          if (!fragments) {
            protocolError(1002, "continuation without start frame");
            return;
          }
          if (fragments.length + payload.length > MAX_TEXT_PAYLOAD) {
            protocolError(1009, "fragmented message too large");
            return;
          }
          fragments = Buffer.concat([fragments, payload]);
          if (fin) {
            const whole = fragments;
            fragments = null;
            deliverText(whole);
          }
          return;
        }
        case OP_PING:
          if (!socket.destroyed && socket.writable) socket.write(encodeFrame(OP_PONG, payload));
          return;
        case OP_PONG:
          return;
        case OP_CLOSE:
          if (!socket.destroyed && socket.writable) {
            try {
              socket.write(encodeFrame(OP_CLOSE, payload.subarray(0, 2)));
            } catch {
              /* ignore */
            }
          }
          finish();
          return;
        default:
          // 二进制/保留 opcode:本协议只用文本,明确拒绝而不是静默吞掉
          protocolError(1003, `unsupported opcode 0x${opcode.toString(16)}`);
          return;
      }
    };

    socket.on("data", (chunk: Buffer) => {
      if (closed) return;
      lastSeen = Date.now();
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0 && !closed) {
        let result;
        try {
          result = decodeFrameAt(buffer, MAX_TEXT_PAYLOAD);
        } catch {
          protocolError(1009, "frame too large / malformed");
          return;
        }
        if (!result.frame) break;
        buffer = buffer.subarray(result.consumed);
        handleFrame(result.frame.opcode, result.frame.payload, result.frame.fin, result.frame.masked, result.frame.rsv);
      }
    });

    socket.on("error", () => finish());
    socket.on("close", () => finish());
    if (head.length > 0) socket.emit("data", head); // 握手包里可能已捎带首帧
  }

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const actualPort = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: actualPort,
        host,
        connections,
        broadcast(payload, filter) {
          for (const conn of connections) {
            if (filter && !filter(conn)) continue;
            conn.send(payload);
          }
        },
        counts,
        close: () =>
          new Promise((resolveClose) => {
            for (const conn of connections) conn.close(1001);
            httpServer.close(() => resolveClose());
          }),
      });
    });
  });
}
