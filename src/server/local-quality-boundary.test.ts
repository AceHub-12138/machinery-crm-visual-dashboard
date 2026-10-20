import { describe, it, expect } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createLocalQualityBoundary, verifiedLocalQualityRequest, verifyLoopbackQualityRequest } from './local-quality-boundary.mjs';
const request = (headers = {}, localAddress: string | undefined = '127.0.0.1', remoteAddress: string | undefined = '127.0.0.1', localPort = 3081) => ({ headers, socket: { localAddress, remoteAddress, localPort } }) as unknown as IncomingMessage;
const server = (address = '127.0.0.1', port = 3081) => ({ address: () => ({ address, family: 'IPv4', port }) });
describe('raw Node loopback boundary', () => {
  it('does not trust Host, env flags or a missing per-request context', () => {
    expect(verifiedLocalQualityRequest()).toBe(false);
    expect(verifyLoopbackQualityRequest(request({ host: 'localhost' }), server('0.0.0.0'))).toBe(false);
    expect(verifyLoopbackQualityRequest(request({ host: 'localhost' }), server('::'))).toBe(false);
    expect(verifyLoopbackQualityRequest(request(), { address: () => null })).toBe(false);
    expect(verifyLoopbackQualityRequest(request(), { address: () => '/tmp/test.sock' })).toBe(false);
  });
  it.each(['192.0.2.1', '10.0.0.1', '::ffff:192.0.2.1', 'localhost', ''])('rejects unverified peer or local address %s', address => {
    expect(verifyLoopbackQualityRequest(request({}, '127.0.0.1', address), server())).toBe(false);
    expect(verifyLoopbackQualityRequest(request({}, address), server())).toBe(false);
  });
  it('requires the actual socket port to match the verified listener', () => {
    expect(verifyLoopbackQualityRequest(request({}, '127.0.0.1', '127.0.0.1', 3082), server())).toBe(false);
    expect(verifyLoopbackQualityRequest(request(), server('127.0.0.1', 0))).toBe(false);
    expect(verifyLoopbackQualityRequest(request(), server())).toBe(true);
  });
  it('fails closed when socket address or port evidence is absent', () => {
    for (const key of ['localAddress', 'remoteAddress', 'localPort']) {
      const req = request(); Object.assign(req.socket, { [key]: undefined });
      expect(verifyLoopbackQualityRequest(req, server())).toBe(false);
    }
    const missingPort = { address: () => ({ address: '127.0.0.1', family: 'IPv4' }) } as unknown as ReturnType<typeof server>;
    const req = request(); Object.assign(req.socket, { localPort: undefined });
    expect(verifyLoopbackQualityRequest(req, missingPort)).toBe(false);
  });
  it.each(['forwarded', 'via', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-real-ip', 'proxy-connection', 'x-nexus-quality-boundary'])('rejects the presence of raw %s even when empty', name => {
    expect(verifyLoopbackQualityRequest(request({ [name]: '' }), server())).toBe(false);
  });
  it('isolates overlapping real HTTP requests and snapshots raw headers before Next mutation', async () => {
    const boundary = createLocalQualityBoundary();
    const http = createServer((req, res) => boundary.run(req, http, async () => {
      // Next fills these defaults later; they must not create a false rejection or a new grant.
      req.headers['x-forwarded-host'] = 'localhost';
      await new Promise(resolve => setTimeout(resolve, 2)); res.end(String(boundary.verified()));
    }));
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const bound = http.address(); if (!bound || typeof bound === 'string') throw new Error('Missing listener');
    try {
      const results = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
        const response = await fetch(`http://127.0.0.1:${bound.port}`, { headers: i % 2 ? { Forwarded: 'for=192.0.2.1' } : {} }); return response.text();
      }));
      expect(results).toEqual(Array.from({ length: 12 }, (_, i) => i % 2 ? 'false' : 'true'));
      expect(boundary.verified()).toBe(false);
    } finally { http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); }
  });
  it.each([['--hostname', '0.0.0.0'], ['--port', '0'], ['--port', '65536']])('the local launcher rejects unsafe or invalid CLI %s %s', (flag, value) => {
    const result = spawnSync(process.execPath, ['scripts/p1-5-c/local-server.mjs', flag, value], { encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('Usage:');
  });
});
