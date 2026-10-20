/** Opt-in test launcher. The listener address is fixed, not configurable by headers or env. */
import { createServer } from 'node:http';
import next from 'next';
import { installLocalQualityBoundary } from '../../src/server/local-quality-boundary.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1])
  || Number(args[1]) < 1 || Number(args[1]) > 65535) throw new Error('Usage: node scripts/p1-5-c/local-server.mjs --port <1..65535>');
const port = Number(args[1]);
const hostname = '127.0.0.1';
const boundary = installLocalQualityBoundary();
const app = next({ dev: false, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((request, response) => {
  boundary.run(request, server, () => {
    Promise.resolve(handle(request, response)).catch(error => {
      console.error(error.message);
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    });
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: hostname, port, exclusive: true }, resolve); });
const bound = server.address();
if (!bound || typeof bound === 'string' || bound.address !== hostname) throw new Error('Loopback listener could not be verified');
console.log(`NEXUS local test server: http://${hostname}:${bound.port}`);
let closing = false;
async function close() {
  if (closing) return; closing = true;
  server.closeAllConnections();
  await Promise.all([app.close(), new Promise(resolve => server.close(resolve))]);
  process.exit(0);
}
process.on('SIGTERM', close); process.on('SIGINT', close);
