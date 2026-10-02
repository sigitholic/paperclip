// Deterministic, realistic-looking fixture data for MOCK mode (no device configured).
import type { Device, PppoeSession, RouterResource } from "./sources.js";

export function mockPppoe(): PppoeSession[] {
  return Array.from({ length: 137 }, (_, i) => ({
    router: "mock",
    name: `pel-${String(1001 + i).padStart(5, "0")}@starnet`,
    address: `100.64.${10 + Math.floor(i / 250)}.${(i % 250) + 2}`,
    callerId: `DC:2C:6E:${(0x10 + (i >> 8)).toString(16).toUpperCase()}:${(i & 0xff).toString(16).padStart(2, "0").toUpperCase()}:7A`,
    uptime: `${(i % 9) + 1}d${(i * 7) % 24}h${(i * 13) % 60}m`,
    service: "pppoe",
  }));
}

export function mockResource(): RouterResource {
  return { cpuLoadPct: 23, memUsedPct: 41, totalMemoryMb: 4096, uptime: "12d4h31m", version: "7.15.3 (stable)", board: "CCR2004-1G-12S+2XS" };
}

export function mockDevices(now: number): Device[] {
  return Array.from({ length: 40 }, (_, i) => {
    const offline = i % 10 === 7; // 4 of 40 offline
    const serial = `ZTEG${String(80001234 + i)}`;
    return {
      id: `ZTE-F670L-${serial}`,
      serial,
      model: "F670L",
      lastInform: new Date(now - (offline ? (3 + i) * 3_600_000 : (i % 5) * 60_000)).toISOString(),
      online: !offline,
      firmware: i % 4 === 0 ? "V9.0.10P1N12" : "V9.0.11P2N3",
      pppoeUsername: `pel-${String(1001 + i).padStart(5, "0")}@starnet`,
    };
  });
}
