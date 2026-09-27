#!/usr/bin/env node
// Run the fake RouterOS (18728) + GenieACS (17557) servers for a `demo-seed --live` company.
// Reads the fake RouterOS password from the devkit state file; never prints it.
import { startFakeGenieACS } from "../fake/genieacs.mjs";
import { startFakeRouterOS } from "../fake/routeros.mjs";
import { readState } from "../lib/state.mjs";

const fake = readState()?.fake;
if (!fake?.routerosPassword) { console.error("no live demo state; run: node packages/starnet-devkit/scripts/demo-seed.mjs --live"); process.exit(1); }
const ros = await startFakeRouterOS({ port: fake.routerosPort, username: fake.routerosUser, password: fake.routerosPassword });
const acs = await startFakeGenieACS({ port: fake.genieacsPort });
console.log(`fake RouterOS ${ros.url} (user ${fake.routerosUser}), fake GenieACS ${acs.url}; Ctrl-C to stop`);
const logNew = (name, list, seen) => { for (const r of list.slice(seen)) console.log(new Date(r.at).toISOString(), name, r.method, r.path, r.auth ? "auth=ok" : "auth=FAIL"); return list.length; };
let a = 0, b = 0;
setInterval(() => { a = logNew("routeros", ros.requests, a); b = logNew("genieacs", acs.requests, b); }, 500);
