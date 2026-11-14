# NexusFlow — Performance Report

> **How to use this file.** Every number below is a **placeholder**. The scripts in
> `server/scripts/` print the real values on your machine; paste them into the tables and
> delete the `‹…›` cells. Nothing here is invented — an unfilled cell means "not measured
> yet".
>
> The commands assume the API is running (`cd server && npm start`) against a MongoDB 5.0+
> server, and that `INGEST_API_KEY` is exported if the server requires one.

```sh
cd server
export INGEST_API_KEY=…            # only if the server has one configured

# 1. ingestion throughput (30–60 s, target 5 000 writes/sec)
npm run benchmark -- --duration 45 --target 5000

# 2. storage: time-series vs an equivalent regular collection
npm run storage-report

# 3. end-to-end rule latency: POST ingestion -> alert over WebSocket
npm run rule-latency -- --samples 50
```

Each script prints a human-readable table **and** a single JSON line, so the results can be
pasted into this file verbatim.

---

## 1. Test environment

Fill this in before pasting numbers — throughput is meaningless without the machine.

| Item | Value |
|---|---|
| Date of run | ‹YYYY-MM-DD› |
| CPU / cores / RAM | ‹e.g. Apple M2, 8 cores, 16 GB› |
| OS | ‹e.g. macOS 15 / Ubuntu 24.04› |
| Node version | ‹`node -v`› |
| MongoDB | ‹version + local/Atlas + tier› |
| Deployment | ‹local / Docker / Render free› |
| Active graphs during the run | ‹1› |
| `NODE_ACTIVITY_ENABLED` | ‹true/false› |
| Benchmark client | ‹same host / separate host› |

---

## 2. Ingestion throughput

**Claim under test:** the ingestion hot path sustains **5 000 writes/sec** while answering
`202 Accepted` without waiting for rule evaluation or WebSocket fan-out.

**Command:** `npm run benchmark -- --duration 45 --target 5000`
(3 s warm-up is excluded from the measured window.)

| Metric | Result |
|---|---|
| Total writes | ‹…› |
| Measured duration | ‹… s› |
| **Writes / sec** | **‹…›** |
| Requests / sec | ‹…› |
| Batch size / concurrency | ‹100 / 16› |
| Target | 5 000 writes/sec — ‹MET / NOT MET› |
| **Latency p50** | ‹… ms› |
| **Latency p95** | ‹… ms› |
| **Latency p99** | ‹… ms› |
| Latency mean | ‹… ms› |
| **Errors** | ‹0› |

Raw JSON:

```json
‹paste the JSON line printed by scripts/benchmark.js›
```

### Variation sweep (optional but convincing)

Repeat with different batch sizes and concurrency to show where the ceiling is. A
closed-loop client is usually the first limit: if the measured throughput is below target,
raise `--concurrency` before blaming the server.

| Batch size | Concurrency | Writes/sec | p50 (ms) | p95 (ms) | Errors |
|---|---|---|---|---|---|
| 1 | 32 | ‹…› | ‹…› | ‹…› | ‹…› |
| 100 | 16 | ‹…› | ‹…› | ‹…› | ‹…› |
| 500 | 8 | ‹…› | ‹…› | ‹…› | ‹…› |
| 1000 | 4 | ‹…› | ‹…› | ‹…› | ‹…› |

### What the numbers mean

- **Throughput is dominated by MongoDB**, not by Node: the handler's only awaited work is
  `insertMany` on the time-series collection. The rule engine, the WebSocket fan-out and
  the outbound delivery queue all run *after* the 202 is flushed (`setImmediate`), so a
  slow action node cannot slow ingestion down.
- **p95/p99 >> p50 is expected.** A batch write waits for the storage engine's group
  commit; the tail is the checkpoint/journal interval, not a Node event-loop stall.
- **Errors should be 0.** A non-zero count is almost always the batch schema limit
  (1000 readings), the rate limiter (`INGEST_RATE_LIMIT`, default 6000/min per IP) or a
  body larger than `REQUEST_SIZE_LIMIT`.

---

## 3. Storage: time-series vs a regular collection

**Claim under test:** storing measurements in a MongoDB **time-series** collection is
meaningfully smaller than an equivalent ordinary collection holding the same documents.

**Command:** `npm run storage-report`
(the script copies every `telemetry` document into `telemetry_regular`, indexes it the
same way, reads `collStats` for both, then drops the copy unless `--keep` is passed.)

| Metric | `telemetry` (time-series) | `telemetry_regular` (ordinary) |
|---|---|---|
| Documents | ‹…› | ‹…› |
| Data size | ‹…› | ‹…› |
| **Storage size** | **‹…›** | **‹…›** |
| Average object size | ‹…› | ‹…› |
| Indexes | ‹…› | ‹…› |
| **Storage size ratio** | **‹x.xx›** (time-series / regular) | 1.00 |
| **Saving** | **‹xx.x %›** | — |

Raw JSON:

```json
‹paste the JSON line printed by scripts/storageReport.js›
```

### What the numbers mean

- A time-series collection groups measurements into internal **buckets** keyed by the
  `metaField` (`metadata`). The repeated part of each document — `deviceId`, `sensorType`,
  `location`, `unit`, and the measurement shape — is written once per bucket instead of
  once per document. That is where the saving comes from.
- The saving grows with the number of readings per (device, sensor, bucket interval) and
  with the amount of repeated metadata. A small sample (a few hundred readings) shows a
  smaller saving than a production-sized collection; re-run after `npm run simulate` has
  been running for a while for a representative figure.
- `granularity: seconds` is what NexusFlow creates. Coarser granularity means bigger
  buckets and better compression, at the cost of a coarser index on `timestamp`.
- The comparison collection is created and dropped by the script; nothing else is touched.

---

## 4. End-to-end rule latency

**Claim under test:** the time from `POST /api/telemetry` to the alert appearing on a
WebSocket subscriber is small enough for a live dashboard.

**Command:** `npm run rule-latency -- --samples 50`
(the script activates a `Sensor -> Threshold -> Log` rule, subscribes to `alerts`, pushes
readings above the threshold and times request-sent → alert-received.)

| Metric | Result |
|---|---|
| Samples measured | ‹… of 50› |
| **Average** | **‹… ms›** |
| **p50** | ‹… ms› |
| **p95** | **‹… ms›** |
| p99 | ‹… ms› |
| min / max | ‹… / … ms› |
| Errors | ‹0› |

Raw JSON:

```json
‹paste the JSON line printed by scripts/ruleLatency.js›
```

### What the numbers mean

The measured interval contains, in order:

1. the HTTP request + Zod validation + `insertMany` (durability),
2. `setImmediate` fan-out into `telemetryBus`,
3. `ruleExecutor` routing (an O(1) Map lookup per reading),
4. the RxJS pipeline (`bufferCount` → `filter` → action handler),
5. `Alert.create` (for actions that persist),
6. the WebSocket write to the subscribed channel.

So this number is an upper bound on "how stale can the dashboard be", not just the rule
engine. A p95 in the low tens of milliseconds locally is expected; on a free-tier host the
network hop and the database round trip dominate.

---

## 5. Frontend

The canvas is instrumented so that a hot device stream cannot cause a re-render per
message: `useTelemetrySeries` and `useTelemetry` buffer incoming frames and flush into
React state at most once per 200 ms / 500 ms window, and `CanvasActivityStore` notifies
only the node/edge that changed via `useSyncExternalStore`.

| Metric | Result |
|---|---|
| Production bundle (total) | ‹… kB / … kB gzipped› |
| Largest chunk | ‹… kB› |
| Re-renders/sec at 100 msg/s | ‹…› (≈ 5 by design) |
| Lighthouse performance (local) | ‹…› |

Measured locally with `cd client && npm run build`; the build splits `react`, `flow`
(React Flow) and `charts` (Recharts) into separate chunks so a code change does not
invalidate a ~1 MB bundle.

---

## 6. Limitations of this report

- Numbers are **machine- and configuration-specific**. A free-tier MongoDB Atlas M0 cluster
  and a sleeping Render instance will not reproduce a local run.
- The benchmark is a **closed-loop** client: it measures the server *and* the client. Use
  a separate machine for the load generator when quoting a server-side figure.
- `storage-report` compares storage size, not query performance. Query benchmarks
  (`GET /api/telemetry`, `GET /api/telemetry/stats`) are not included yet.
- Rule latency includes the database write; there is deliberately no "fire before
  persisting" mode, because a durable alert is worth more than a marginally faster one.
