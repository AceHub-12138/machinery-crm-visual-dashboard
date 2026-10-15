import http from "node:http";
import { readFileSync } from "node:fs";
const seed = JSON.parse(readFileSync(new URL("../services/voice-orchestrator/fixtures/public-sales-screen.json", import.meta.url)));
const sanitizedVisual = JSON.parse(readFileSync(new URL("../src/lib/fixtures/nexus-sanitized.json", import.meta.url)));
let payload, unavailable = false;
function reset() { payload = structuredClone(seed); payload.generatedAt = new Date().toISOString(); payload.displayNotice = true;
  Object.assign(payload.kpis, sanitizedVisual.kpis);
  for (const key of ['totalContractAmount','totalPaidAmount','totalUnpaidAmount','actualAmount','collectionRate']) payload.collection[key] = sanitizedVisual.collection[key];
  unavailable = false; }
reset();
http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:3199");
  if (url.pathname === "/control") {
    if (request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      payload = JSON.parse(body);
      payload.generatedAt = new Date().toISOString();
      unavailable = false;
      response.end("ok"); return;
    }
    if (url.searchParams.has("reset")) reset();
    if (url.searchParams.has("offline")) unavailable = true;
    if (url.searchParams.has("sanitizedVisual")) {
      Object.assign(payload.kpis, sanitizedVisual.kpis);
      payload.collection = structuredClone(sanitizedVisual.collection);
      payload.delivery.routes = structuredClone(sanitizedVisual.routes);
    }
    if (url.searchParams.has("negative")) {
      payload.kpis.periodContractAmount = "-98765";
      payload.collection.targetConfigured = false;
      payload.delivery.routes[0].city = null;
    }
    if (url.searchParams.has("exceeded")) {
      payload.kpis.periodContractAmount = "999999999999.99";
      payload.collection.targetRate = 1234.5; payload.collection.targetVisualRate = 100;
      payload.collection.exceeded = true; payload.collection.exceededAmount = "99999.99";
    }
    response.end("ok"); return;
  }
  if (unavailable) { response.writeHead(503); response.end("offline fixture"); return; }
  response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(payload));
}).listen(3199, "127.0.0.1");
