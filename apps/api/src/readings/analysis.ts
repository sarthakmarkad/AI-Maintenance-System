import { PARAMETERS, localTime } from "./parser";
export type Observation = {
  measuredAt: Date;
  receivedAt: Date;
  hotTempC: number;
  coldTempC: number;
  pressureBar: number;
  sourceId: string;
  sourceRow: number;
  importId: string;
  demoShift: string;
};
export function analyse(rows: Observation[], start: Date, endExclusive: Date) {
  const byTime = new Map(rows.map((row) => [row.measuredAt.getTime(), row]));
  const points = [];
  for (let t = start.getTime(); t < endExclusive.getTime(); t += 3600000) {
    const row = byTime.get(t);
    points.push({
      measuredAt: new Date(t).toISOString(),
      localMeasuredAt: localTime(new Date(t)),
      hotTempC: row?.hotTempC ?? null,
      coldTempC: row?.coldTempC ?? null,
      pressureBar: row?.pressureBar ?? null,
    });
  }
  const statistics = PARAMETERS.map((p) => {
    const values = rows.map((row) => row[p.key]);
    return {
      ...p,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      mean: values.length
        ? Math.round(
            (values.reduce((a, b) => a + b, 0) / values.length) * 1000,
          ) / 1000
        : null,
      reviewCount: values.filter((v) => v < p.low || v > p.high).length,
    };
  });
  const reviews: {
    parameter: string;
    unit: string;
    low: number;
    high: number;
    direction: string;
    firstMeasuredAt: string;
    lastMeasuredAt: string;
    receivedAt: string;
    samples: number;
    kind: string;
  }[] = [];
  for (const p of PARAMETERS) {
    let current: (typeof reviews)[number] | null = null;
    for (const point of points) {
      const value = point[p.key],
        direction =
          value === null
            ? null
            : value < p.low
              ? "BELOW"
              : value > p.high
                ? "ABOVE"
                : null;
      if (!direction) {
        current = null;
        continue;
      }
      if (!current || current.direction !== direction) {
        current = {
          parameter: p.name,
          unit: p.unit,
          low: p.low,
          high: p.high,
          direction,
          firstMeasuredAt: point.measuredAt,
          lastMeasuredAt: point.measuredAt,
          receivedAt: byTime
            .get(Date.parse(point.measuredAt))!
            .receivedAt.toISOString(),
          samples: 0,
          kind: "ISOLATED",
        };
        reviews.push(current);
      }
      current.samples++;
      current.lastMeasuredAt = point.measuredAt;
      current.receivedAt = [
        current.receivedAt,
        byTime.get(Date.parse(point.measuredAt))!.receivedAt.toISOString(),
      ]
        .sort()
        .at(-1)!;
      current.kind = current.samples > 1 ? "CONSECUTIVE" : "ISOLATED";
    }
  }
  return {
    points,
    statistics,
    reviews,
    expectedHours: points.length,
    missingHours: points.length - rows.length,
    reviewObservations: rows.filter((row) =>
      PARAMETERS.some((p) => row[p.key] < p.low || row[p.key] > p.high),
    ).length,
  };
}
