// Fake GenieACS NBI (GET /devices/?query=<json>&projection=<csv>), enough for the ISP pack.
// Optional basic auth; `_lastInform` is relative to "now" so online/offline is deterministic.
import { createServer } from "node:http";

const IGD = "InternetGatewayDevice";
export function genieacsFixture(now = Date.now()) {
  const dev = (i, minutesAgo) => ({
    _id: `ZTE-F670L-DEMO${String(i).padStart(4, "0")}`,
    _lastInform: new Date(now - minutesAgo * 60_000).toISOString(),
    _deviceId: { _SerialNumber: `DEMO${String(i).padStart(4, "0")}`, _ProductClass: "F670L" },
    [IGD]: {
      DeviceInfo: { SoftwareVersion: { _value: "V9.0.10P1N12" } },
      WANDevice: { 1: { WANConnectionDevice: { 1: { WANPPPConnection: { 1: { Username: { _value: `demo-user-${String(i).padStart(2, "0")}@starnet` } } } } } } },
    },
  });
  // 10 CPE: 8 online (informed 1–5 min ago), 2 offline (2 h / 1 day ago).
  return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => dev(i, (i % 5) + 1)).concat([dev(9, 120), dev(10, 1440)]);
}

export function startFakeGenieACS({ port = 17557, host = "127.0.0.1", username, password, fixture = genieacsFixture } = {}) {
  const expected = username ? `Basic ${Buffer.from(`${username}:${password ?? ""}`).toString("base64")}` : null;
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const ok = !expected || req.headers.authorization === expected;
    requests.push({ at: Date.now(), method: req.method, path: url.pathname, auth: ok });
    if (!ok) return void res.writeHead(401).end("Unauthorized");
    if (url.pathname !== "/devices/" && url.pathname !== "/devices") return void res.writeHead(404).end("Not found");
    let query = {};
    try { query = JSON.parse(url.searchParams.get("query") || "{}"); } catch { return void res.writeHead(400).end("bad query"); }
    const rows = fixture(Date.now()).filter((d) => !query._id || d._id === query._id);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(rows));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ server, requests, url: `http://${host}:${server.address().port}`, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}
