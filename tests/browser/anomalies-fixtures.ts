import { randomUUID } from "node:crypto";
const start = Date.parse("2026-08-31T18:30:00Z");
export const receipt = "2026-10-17T10:00:00.000Z";
const samples = Array.from({ length: 25 }, (_, i) => ({
  id: randomUUID(),
  sourceId: "TEST-" + i,
  sourceRow: i + 2,
  importId: "36e821c7-e4c3-4029-8f14-e01893b97893",
  measuredAt: new Date(start + i * 3600000).toISOString(),
  receivedAt: receipt,
  value: i === 24 ? 230 : 200,
}));
export const flag = {
  key: "a".repeat(64),
  policyVersion: "synthetic-rolling-mad-v1",
  parameter: "hotTempC",
  kind: "SUDDEN_CHANGE",
  direction: "UP",
  name: "Hot temperature",
  unit: "°C assumed",
  measuredAt: samples[24].measuredAt,
  availableAt: receipt,
  value: 230,
  baselineMedian: 200,
  baselineMad: 0,
  scale: 1,
  threshold: 4,
  change: 30,
  slope: null,
  baseline: samples.slice(0, 24),
  samples: samples.slice(24),
  review: null,
};
export function emptyPatterns() {
  return {
    source: "SYNTHETIC",
    timezone: "Asia/Kolkata",
    policyVersion: "synthetic-rolling-mad-v1",
    from: "2026-09-01",
    to: "2026-09-02",
    evaluatedAt: receipt,
    canReview: false,
    observations: 0,
    eligible: { SUDDEN_CHANGE: 0, SUSTAINED_SHIFT: 0, DRIFT: 0 },
    insufficientHistory: 0,
    total: 0,
    pending: 0,
    reviewed: 0,
    matching: 0,
    markers: [],
    items: [],
    nextCursor: null,
  };
}
export function trendFixture() {
  const points = Array.from({ length: 48 }, (_, i) => ({
    measuredAt: new Date(start + i * 3600000).toISOString(),
    localMeasuredAt: new Date(start + i * 3600000 + 330 * 60000)
      .toISOString()
      .slice(0, 19),
    hotTempC: i === 24 ? 230 : 200,
    coldTempC: 45,
    pressureBar: 100,
  }));
  return {
    source: "SYNTHETIC",
    timezone: "Asia/Kolkata",
    policyVersion: "demo-hourly-bands-v1",
    from: "2026-09-01",
    to: "2026-09-02",
    hasData: true,
    observations: 48,
    expectedHours: 48,
    missingHours: 0,
    reviewObservations: 1,
    latestMeasuredAt: points.at(-1)!.measuredAt,
    lastReceivedAt: receipt,
    points,
    statistics: [
      {
        key: "hotTempC",
        name: "Hot temperature",
        unit: "°C assumed",
        low: 180,
        high: 220,
        min: 200,
        max: 230,
        mean: 201,
        reviewCount: 1,
      },
      {
        key: "coldTempC",
        name: "Cold temperature",
        unit: "°C assumed",
        low: 40,
        high: 50,
        min: 45,
        max: 45,
        mean: 45,
        reviewCount: 0,
      },
      {
        key: "pressureBar",
        name: "Pressure",
        unit: "bar",
        low: 80,
        high: 120,
        min: 100,
        max: 100,
        mean: 100,
        reviewCount: 0,
      },
    ],
    reviews: [],
    rows: [],
    imports: [],
  };
}
