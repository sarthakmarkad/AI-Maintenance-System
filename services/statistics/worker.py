"""Private, bounded JSON worker. No database, network, event labels or credentials."""
import json
import math
import sys
from datetime import datetime
from statistics import median

POLICY = "synthetic-rolling-mad-v1"
PARAMETERS = {"hotTempC": 1.0, "coldTempC": 0.5, "pressureBar": 1.0}
WINDOWS = {"SUDDEN_CHANGE": 1, "SUSTAINED_SHIFT": 3, "DRIFT": 6}


def instant(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.utcoffset() is None:
        raise ValueError("Offset required")
    return dt.timestamp()


def analyse(payload):
    if set(payload) != {"rows", "from", "to"}:
        raise ValueError("Unexpected input")
    rows = payload["rows"]
    start, end = instant(payload["from"]), instant(payload["to"])
    if not start < end <= start + 31 * 86400 or len(rows) > 774:
        raise ValueError("Window too large")
    previous = None
    for row in rows:
        if set(row) != {"id", "measuredAt", *PARAMETERS}:
            raise ValueError("Unexpected reading fields")
        t = instant(row["measuredAt"])
        if previous is not None and t <= previous:
            raise ValueError("Readings must be ordered and unique")
        if not start - 30 * 3600 <= t < end:
            raise ValueError("Reading outside input range")
        for key in PARAMETERS:
            if type(row[key]) not in (int, float) or not math.isfinite(row[key]):
                raise ValueError("Finite values required")
        previous = t
    flags = []
    eligible = {kind: 0 for kind in WINDOWS}
    # Each endpoint uses only prior data. Missing hours invalidate that window.
    for i, row in enumerate(rows):
        if instant(row["measuredAt"]) < start:
            continue
        for kind, size in WINDOWS.items():
            segment = rows[max(0, i - size - 23):i + 1]
            if len(segment) != 24 + size or any(
                instant(b["measuredAt"]) - instant(a["measuredAt"]) != 3600
                for a, b in zip(segment, segment[1:])
            ):
                continue
            eligible[kind] += 1
            baseline, samples = segment[:24], segment[24:]
            for parameter, floor in PARAMETERS.items():
                center = median(r[parameter] for r in baseline)
                mad = median(abs(r[parameter] - center) for r in baseline)
                scale = max(mad / 0.6745, floor)
                values = [r[parameter] for r in samples]
                threshold = scale * (3 if kind == "SUSTAINED_SHIFT" else 4)
                change = values[-1] - baseline[-1][parameter]
                direction = 1 if change > 0 else -1
                slope = None
                if kind == "SUDDEN_CHANGE":
                    matches = abs(change) > threshold
                elif kind == "SUSTAINED_SHIFT":
                    change = sum(values) / 3 - center
                    direction = 1 if change > 0 else -1
                    matches = all((v - center) * direction > threshold for v in values)
                else:
                    change = values[-1] - values[0]
                    direction = 1 if change > 0 else -1
                    slope = sum((j - 2.5) * v for j, v in enumerate(values)) / 17.5
                    matches = abs(change) > threshold and sum(
                        (b - a) * direction > 0 for a, b in zip(values, values[1:])
                    ) >= 4 and slope * direction > 0
                if matches:
                    flags.append({
                        "parameter": parameter, "kind": kind,
                        "direction": "UP" if direction == 1 else "DOWN",
                        "measuredAt": row["measuredAt"], "value": row[parameter],
                        "baselineMedian": center, "baselineMad": mad,
                        "scale": scale, "threshold": threshold, "change": change,
                        "slope": slope,
                        "baselineIds": [r["id"] for r in baseline],
                        "sampleIds": [r["id"] for r in samples],
                    })
    return {"policyVersion": POLICY, "eligible": eligible, "flags": flags}


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(512001)
        if len(raw) > 512000:
            raise ValueError("Input too large")
        result = analyse(json.loads(raw))
        sys.stdout.write(json.dumps(result, allow_nan=False, separators=(",", ":")))
    except Exception:
        # Never echo company values or Python internals across the boundary.
        sys.stderr.write("Statistical analysis failed.\n")
        sys.exit(1)
