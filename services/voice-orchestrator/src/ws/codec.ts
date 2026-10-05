/**
 * 最小 RFC6455 WebSocket 编解码(帧层纯函数,供 ws-server 与单测使用)。
 *
 * 为什么手写:编排服务零依赖(仓库基线不加任何 npm 依赖),而本服务只需
 * 文本帧 + ping/pong/close——这正是 RFC6455 里最薄的一层。
 * 服务端→客户端帧不掩码,客户端→服务端帧必须掩码(RFC 6455 §5.1)。
 */

import { createHash } from "node:crypto";

export const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const OP_CONTINUATION = 0x0;
export const OP_TEXT = 0x1;
export const OP_BINARY = 0x2;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

/** 握手应答值(RFC 6455 §1.3)。 */
export function acceptKey(clientKey: string): string {
  return createHash("sha1").update(clientKey + WS_GUID).digest("base64");
}

/** 服务端出站帧(FIN=1,不掩码)。 */
export function encodeFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header: number[] = [0x80 | opcode];
  const len = payload.length;
  if (len < 126) {
    header.push(len);
  } else if (len < 65536) {
    header.push(126, (len >> 8) & 0xff, len & 0xff);
  } else {
    header.push(127);
    for (let shift = 56; shift >= 0; shift -= 8) header.push((len / 2 ** shift) & 0xff);
  }
  return Buffer.concat([Buffer.from(header), payload]);
}

/** unmask(RFC §5.3:payload 与 4 字节 key 循环异或)。 */
export function unmaskPayload(payload: Buffer, maskKey: Buffer): Buffer {
  const out = Buffer.from(payload);
  for (let i = 0; i < out.length; i++) out[i] ^= maskKey[i & 3];
  return out;
}

export type DecodedFrame = {
  opcode: number;
  fin: boolean;
  /** 客户端帧必须为 true(RFC 6455 §5.1);服务端应据此拒绝未掩码帧 */
  masked: boolean;
  /** RSV1-3 位(未协商扩展时必须为 0,RFC 6455 §5.2);是否拒绝由传输层决定 */
  rsv: number;
  payload: Buffer;
};

export type FrameDecoderResult = {
  frame: DecodedFrame | null;
  /** 跳过的字节数(整帧不完整时为 0);非法帧抛 Error。 */
  consumed: number;
};

/**
 * 从缓冲区头部尝试解一帧(增量喂入,不足一帧返回 consumed=0)。
 * 掩码位在此只做透传,是否强制掩码由传输层决定(ws-server 强制)。
 */
export function decodeFrameAt(buffer: Buffer, maxPayload = 1_048_576): FrameDecoderResult {
  if (buffer.length < 2) return { frame: null, consumed: 0 };
  const fin = (buffer[0] & 0x80) !== 0;
  const rsv = (buffer[0] & 0x70) >> 4;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let len = buffer[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buffer.length < 4) return { frame: null, consumed: 0 };
    len = buffer.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buffer.length < 10) return { frame: null, consumed: 0 };
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(maxPayload)) throw new Error("frame too large");
    len = Number(big);
    offset = 10;
  }
  if (len > maxPayload) throw new Error("frame too large");
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + len) return { frame: null, consumed: 0 };
  const payload = buffer.slice(offset + maskLength, offset + maskLength + len);
  return {
    frame: {
      opcode,
      fin,
      masked,
      rsv,
      payload: masked ? unmaskPayload(payload, buffer.slice(offset, offset + 4)) : payload,
    },
    consumed: offset + maskLength + len,
  };
}
