// Fake MikroTik RouterOS v7 REST API (just the read endpoints the ISP pack uses).
// Basic auth is enforced; requests are recorded (method, path, auth ok) without credentials.
import { createServer } from "node:http";

export const ROUTEROS_FIXTURE = {
  pppActive: [
    { ".id": "*1", name: "demo-user-01@starnet", service: "pppoe", address: "100.64.10.1", "caller-id": "AA:BB:CC:10:00:01", uptime: "1h2m" },
    { ".id": "*2", name: "demo-user-02@starnet", service: "pppoe", address: "100.64.10.2", "caller-id": "AA:BB:CC:10:00:02", uptime: "3d4h" },
    { ".id": "*3", name: "demo-user-03@starnet", service: "pppoe", address: "100.64.10.3", "caller-id": "AA:BB:CC:10:00:03", uptime: "12m" },
    { ".id": "*4", name: "branch-l2tp", service: "l2tp", address: "10.9.9.9", "caller-id": "1.2.3.4", uptime: "5m" },
  ],
  resource: { "cpu-load": "31", "free-memory": "536870912", "total-memory": "1073741824", uptime: "9d1h", version: "7.16 (stable)", "board-name": "FAKE-CCR2004" },
};

export function startFakeRouterOS({ port = 18728, host = "127.0.0.1", username = "noc-ro", password, fixture = ROUTEROS_FIXTURE } = {}) {
  if (!password) throw new Error("startFakeRouterOS: password is required");
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const requests = [];
  const server = createServer((req, res) => {
    const ok = req.headers.authorization === expected;
    requests.push({ at: Date.now(), method: req.method, path: req.url, auth: ok });
    if (!ok) return void res.writeHead(401, { "content-type": "application/json" }).end('{"error":401,"message":"Unauthorized"}');
    const body = req.url === "/rest/ppp/active" ? fixture.pppActive : req.url === "/rest/system/resource" ? fixture.resource : null;
    if (!body) return void res.writeHead(404, { "content-type": "application/json" }).end('{"error":404,"message":"no such command"}');
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ server, requests, url: `http://${host}:${server.address().port}`, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}
