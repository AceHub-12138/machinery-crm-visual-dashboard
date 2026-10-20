import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';

const readerKey = Symbol.for('dachuan.nexus.local-quality-boundary.v1');
const loopback = address => typeof address === 'string' && (
  isIP(address) === 4 && address.split('.')[0] === '127'
  || address === '::1'
  || address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 && address.slice(7).split('.')[0] === '127'
);

/** Inspect the raw request BEFORE Next adds its own x-forwarded-* defaults.
 * @param {Pick<import('node:http').IncomingMessage, 'headers' | 'socket'>} request
 * @param {Pick<import('node:http').Server, 'address'>} server
 */
export function verifyLoopbackQualityRequest(request, server) {
  const bound = server.address();
  if (!bound || typeof bound === 'string' || !loopback(bound.address)) return false;
  if (!loopback(request.socket.localAddress) || !loopback(request.socket.remoteAddress)
    || !Number.isInteger(bound.port) || bound.port <= 0 || bound.port > 65535
    || bound.port !== request.socket.localPort) return false;
  return !Object.keys(request.headers).some(name => {
    const key = name.toLowerCase();
    return key === 'forwarded' || key === 'via' || key === 'x-real-ip' || key === 'proxy-connection'
      || key.startsWith('x-forwarded-') || key.startsWith('x-nexus-quality-');
  });
}

export function createLocalQualityBoundary() {
  /** @type {AsyncLocalStorage<boolean>} */
  const context = new AsyncLocalStorage();
  return {
    /** @template T
     * @param {Pick<import('node:http').IncomingMessage, 'headers' | 'socket'>} request
     * @param {Pick<import('node:http').Server, 'address'>} server
     * @param {() => T} handler
     */
    run: (request, server, handler) => context.run(verifyLoopbackQualityRequest(request, server), handler),
    verified: () => context.getStore() === true,
  };
}

/** Server process memory only: no request header, environment assertion, token or client API. */
export function installLocalQualityBoundary() {
  if (Reflect.has(globalThis, readerKey)) throw new Error('Local quality boundary already installed');
  const boundary = createLocalQualityBoundary();
  Object.defineProperty(globalThis, readerKey, { value: boundary.verified, writable: false, configurable: false });
  return boundary;
}

export function verifiedLocalQualityRequest() {
  const reader = Reflect.get(globalThis, readerKey);
  try { return typeof reader === 'function' && reader() === true; } catch { return false; }
}
