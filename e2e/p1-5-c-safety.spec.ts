import { test, expect } from '@playwright/test';
import { get, createServer, request as forward } from 'node:http';

async function decision(port: number, query: string, headers: Record<string, string> = {}, debug = true) {
  const search = [debug ? 'debug=1' : '', query].filter(Boolean).join('&');
  const html = await new Promise<string>((resolve, reject) => {
    const req = get({ hostname: '127.0.0.1', port, path: `/screen/sales${search ? `?${search}` : ''}`, headers: { Host: `localhost:${port}`, ...headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => res.statusCode === 200 ? resolve(body) : reject(new Error(`HTTP ${res.statusCode}`)));
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('Request timed out')));
  });
  // These are the actual server-selected props in the Next Flight response, before client calibration.
  const text = html.replace(/\\+"/g, '"');
  const mode = text.match(/"qualityMode":"(baseline|shadow|candidate)"/)?.[1];
  const manual = text.match(/"manualQualityAllowed":(true|false)/)?.[1];
  expect(mode).toBeDefined(); expect(manual).toBeDefined();
  return { mode, manual: manual === 'true' };
}
for (const mode of ['candidate', 'shadow']) for (const host of ['localhost', '127.0.0.1']) {
  test(`ordinary Next denies ${mode} despite forged ${host} Host and server grant`, async () => {
    expect(await decision(3082, `qualityExperiment=${mode}`, { Host: `${host}:3082` })).toEqual({ mode: 'baseline', manual: false });
  });
}
test('ordinary Next denies forged boundary headers and keeps default/old production URLs protected', async () => {
  for (const query of ['', 'qualityExperiment=external', 'qualityExperiment=candidate']) {
    expect(await decision(3082, query, { 'X-Nexus-Quality-Boundary': 'verified', 'X-Forwarded-Host': 'localhost:3082' })).toEqual({ mode: 'baseline', manual: false });
  }
});
test('ordinary production route without debug or experiment is Baseline with no manual control', async () => {
  expect(await decision(3082, '', {}, false)).toEqual({ mode: 'baseline', manual: false });
});
for (const mode of ['candidate', 'shadow']) test(`verified loopback launcher permits explicit ${mode}`, async () => {
  expect(await decision(3081, `qualityExperiment=${mode}`)).toEqual({ mode, manual: true });
});
for (const host of ['company.example', 'localhost.example', '127.0.0.1.attacker.test']) test(`loopback launcher denies untrusted Host ${host}`, async () => {
  expect(await decision(3081, 'qualityExperiment=candidate', { Host: host })).toEqual({ mode: 'baseline', manual: false });
});
for (const [name, value] of [
  ['Forwarded', 'for=203.0.113.9;host=localhost'], ['Via', '1.1 local-proxy'],
  ['X-Forwarded-For', '203.0.113.9'], ['X-Forwarded-For', '127.0.0.1'],
  ['X-Forwarded-Host', 'localhost:3081'], ['X-Forwarded-Proto', 'http'],
  ['X-Forwarded-Port', '3081'], ['X-Real-IP', '203.0.113.9'],
  ['X-Nexus-Quality-Boundary', 'verified'], ['X-Nexus-Quality-Permission', 'local-candidate'],
]) test(`loopback launcher refuses forwarded/forged ${name}=${value}`, async () => {
  for (const mode of ['candidate', 'shadow']) expect(await decision(3081, `qualityExperiment=${mode}`, { [name]: value })).toEqual({ mode: 'baseline', manual: false });
});
for (const query of ['qualityExperiment=external', 'qualityExperiment=invalid', 'qualityExperiment=candidate&qualityExperiment=shadow', '']) {
  test(`verified service does not expand URL permission: ${query || 'default'}`, async () => {
    expect((await decision(3081, query)).mode).toBe('baseline');
  });
}
test('verified shadow grant never gives Candidate or manual control', async () => {
  expect(await decision(3083, 'qualityExperiment=candidate')).toEqual({ mode: 'baseline', manual: false });
  expect(await decision(3083, 'qualityExperiment=shadow')).toEqual({ mode: 'shadow', manual: false });
});
test('an actual local forwarding proxy cannot grant either mode with a localhost Host', async () => {
  const proxy = createServer((req, res) => {
    const upstream = forward({ hostname: '127.0.0.1', port: 3081, path: req.url, headers: { ...req.headers, host: 'localhost:3081', forwarded: 'for=203.0.113.9' } }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.statusCode = 502; res.end(); }); req.pipe(upstream);
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const bound = proxy.address(); if (!bound || typeof bound === 'string') throw new Error('Missing proxy listener');
  try {
    for (const mode of ['candidate', 'shadow']) expect(await decision(bound.port, `qualityExperiment=${mode}`)).toEqual({ mode: 'baseline', manual: false });
  } finally { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); }
});
test('request context cannot leak between concurrent direct and forwarded requests', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => decision(3081, 'qualityExperiment=candidate', i % 2 ? { Forwarded: 'for=203.0.113.9' } : {})));
  results.forEach((result, i) => expect(result).toEqual(i % 2 ? { mode: 'baseline', manual: false } : { mode: 'candidate', manual: true }));
});
