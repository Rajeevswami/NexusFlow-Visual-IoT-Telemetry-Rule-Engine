# NexusFlow — Visual IoT Telemetry & Rule Engine

NexusFlow lets non-technical users build IoT rules visually on a drag-and-drop canvas
(for example **Turbine Sensor → Moving Average → SMS Alert**). Later milestones compile that
graph into RxJS streams and run it against high-frequency telemetry.

**Day 1 scope:** the time-series storage layer, the high-speed ingestion API, the WebSocket
fan-out, and the React Flow editor scaffold with graph persistence.

**Day 2 scope:** custom, configurable node types (sources, math, actions), the **stream compiler**
that turns a saved React Flow JSON graph into executable RxJS pipelines, graph validation and
serialization end to end, and the alerts collection written by action nodes.

**Day 3 scope:** live execution — the `telemetryBus` feeds every HTTP/WS reading into the compiled
pipelines through an O(1) `ruleExecutor`, the `/ws` server gains a channel subscription protocol
(`telemetry:<deviceId>`, `alerts`, `graph:<id>`) with per-device throttling, alerts gain a
per-device cooldown, and a live **Dashboard** (rolling Recharts line, stat cards, alert feed with
toasts, engine status) subscribes to it all in real time.

---

## 1. Tech stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 20+ (ES modules everywhere) |
| API | Express 4, Mongoose 8 |
| Validation | Zod |
| Realtime | `ws` (attached to the same HTTP server on `/ws`) |
| Streams | **RxJS 7** (Subjects, `bufferCount`, `filter`, `concatMap`, `share`, `catchError`) |
| Outbound HTTP | Axios (webhook action, 3 s timeout) |
| Database | MongoDB **5.0+** native **time-series** collections |
| Frontend | React 19 + Vite 6, `@xyflow/react` 12, Axios, Tailwind CSS 3 |
| Utilities | dotenv, cors, helmet, morgan |
| Tests | Vitest (compiler unit tests) + Node's built-in runner (HTTP/database) |

---

## 2. Folder structure

```
NexusFlow-Visual-IoT-Telemetry-Rule-Engine
├── README.md
├── CODE.md                       # complete source of every file, in tree order
├── DAY2-FILES.md                 # Day 2: full source of every new or modified file
├── .gitignore
│
├── server/
│   ├── package.json              # dev / start / simulate / benchmark / test
│   ├── .env.example
│   ├── vitest.config.js          # compiler unit tests (no database needed)
│   ├── samples/
│   │   └── turbine-graph.json    # Sensor -> Moving Average -> Threshold -> SMS Alert
│   ├── scripts/
│   │   ├── simulator.js          # mock hardware: N devices, spikes, HTTP or WebSocket
│   │   ├── engineCheck.js        # DAY 3: activate + simulate + compare alerts vs expected
│   │   └── benchmark.js          # throughput harness (target: 5,000 writes/sec)
│   ├── test/
│   │   ├── validation.test.js    # schema + HTTP behaviour, no database
│   │   ├── integration.test.js   # real MongoDB, skipped unless TEST_MONGODB_URI is set
│   │   ├── compilerRoutes.test.js# compile/test/activate HTTP routes (model stubbed)
│   │   ├── websocketChannels.test.js  # DAY 3: subscribe/unsubscribe/ingest/throttle
│   │   └── compiler/
│   │       ├── graphValidator.test.js
│   │       ├── operators.test.js
│   │       ├── streamCompiler.test.js
│   │       ├── ruleExecutor.test.js        # DAY 3: routing + deactivation isolation
│   │       └── activityCooldown.test.js     # DAY 3: node activity taps + cooldown
│   └── src/
│       ├── server.js             # HTTP bootstrap + /ws + graceful shutdown
│       ├── app.js                # helmet, cors, morgan, routes, error middleware
│       ├── config/{env,db}.js    # Zod env; native time-series provisioning
│       ├── models/
│       │   ├── Telemetry.js      # points at the native `telemetry` time-series collection
│       │   ├── Device.js         # deviceId, name, type, location, createdAt
│       │   ├── Graph.js          # name, nodes[], edges[], viewport, timestamps
│       │   └── Alert.js          # DAY 2: alerts raised by action nodes
│       ├── controllers/{telemetryController,graphController,alertController}.js
│       ├── routes/{telemetryRoutes,graphRoutes,alertRoutes,engineRoutes}.js
│       ├── services/
│       │   ├── websocket.js      # DAY 3: channel protocol, throttled fan-out, WS ingestion
│       │   ├── telemetryBus.js   # DAY 3: central RxJS Subject + engine counters
│       │   ├── ruleExecutor.js   # DAY 3: O(1) deviceId:sensorType routing per reading
│       │   ├── activeGraphManager.js   # DAY 2: graphId -> running pipeline
│       │   └── alertService.js         # DAY 2: persist alerts
│       ├── compiler/                   # DAY 2: JSON graph -> RxJS
│       │   ├── index.js          # public entry point
│       │   ├── graphValidator.js # shape, node types, handles, cycles, sources
│       │   ├── nodeRegistry.js   # type -> factory (Open/Closed extension point)
│       │   ├── streamCompiler.js # Subjects, pipe() chaining, share(), dispose()
│       │   ├── operators/{index,movingAverage,threshold,scale}.js
│       │   ├── actions/{index,smsAlert,webhook,log,template}.js
│       │   └── sources/{index,sensor}.js
│       ├── middleware/{validate,errorHandler}.js
│       ├── validation/{telemetry,graph,compile}.js
│       └── utils/httpError.js
│
└── client/
    ├── package.json, .env.example, index.html
    ├── vite.config.js            # dev server + /api and /ws proxy
    ├── tailwind.config.js, postcss.config.js, public/favicon.svg
    └── src/
        ├── main.jsx, App.jsx, index.css
        ├── pages/EditorPage.jsx
        ├── pages/DashboardPage.jsx     # DAY 3: live dashboard
        ├── ws/
        │   ├── WebSocketProvider.jsx   # DAY 3: shared socket, channels, backoff reconnect
        │   └── useChannel.js           # DAY 3: one-line channel subscription
        ├── hooks/useTelemetrySeries.js # DAY 3: 200 ms buffered series for charts
        ├── components/
        │   ├── dashboard/              # DAY 3: LiveLineChart, StatCards, AlertFeed, EngineStatus
        │   ├── nodes/                  # DAY 2 custom node types
        │   │   ├── index.js            # nodeTypes, defined once at module scope
        │   │   ├── definitions.js      # single source of truth for every node type
        │   │   ├── fields.jsx          # nodrag inputs + useNodeConfig()
        │   │   ├── NodeCard.jsx        # shared card shell, handles per category
        │   │   ├── SensorNode.jsx      MovingAverageNode.jsx
        │   │   ├── ThresholdNode.jsx   ScaleNode.jsx
        │   │   ├── SmsAlertNode.jsx    WebhookNode.jsx   LogNode.jsx
        │   ├── canvas/
        │   │   ├── FlowCanvas.jsx      # nodeTypes + isValidConnection + MiniMap/Controls
        │   │   ├── FlowNode.jsx        # legacy Day 1 node ("nexus"), still renders
        │   │   ├── NodePalette.jsx     # grouped, draggable, searchable
        │   │   ├── graphRules.js       # client-side connection + graph rules
        │   │   └── nodeLibrary.js      # re-exports the new definitions
        │   ├── layout/Navbar.jsx       # health + nav + Activate/Deactivate/Send test data
        │   ├── layout/NavLinks.jsx     # DAY 3: Editor | Dashboard router links
        │   ├── FlowInspector.jsx       # stats, checklist, live telemetry
        │   ├── GraphPicker.jsx         # accessible "Load graph" modal
        │   └── ValidationPanel.jsx     # validation errors and warnings
        └── services/
            ├── api.js             # Axios client (+ compile / alerts / stats / engine helpers)
            ├── useTelemetry.js    # buffered `telemetry` channel hook
            └── graphSerializer.js # clean { nodes, edges } JSON, download, copy
```

---

## 3. Setup

### 3.1 Prerequisites

* **Node.js 20+** and npm 10+
* **MongoDB 5.0 or newer** (time-series collections require 5.0+). Any of these work:
  * a local `mongod`,
  * MongoDB Atlas (free tier is fine),
  * Docker: `docker run -d --name nexusflow-mongo -p 27017:27017 mongo:7`

### 3.2 Install

```bash
git clone <your-fork-url> NexusFlow
cd NexusFlow

# Backend
cd server
cp .env.example .env          # then edit MONGODB_URI if needed
npm install

# Frontend
cd ../client
cp .env.example .env
npm install
```

### 3.3 Environment variables

`server/.env`

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `5000` | HTTP + WebSocket port |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/nexusflow` | database connection string |
| `CLIENT_ORIGIN` | `http://localhost:5173` | comma-separated CORS origins (the Vite proxy is same-origin and needs no CORS) |
| `TELEMETRY_RETENTION_SECONDS` | *(empty)* | optional `expireAfterSeconds` TTL, applied **only when the collection is first created** |
| `NODE_ACTIVITY_ENABLED` | `true` | Day 3: per-node `tap()` activity reporting (`node_activity` messages for Day 4's glowing wires). Set `false` to disable instrumentation in production runs |

`client/.env`

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | browser-side API base (kept same-origin) |
| `VITE_PROXY_TARGET` | `http://localhost:5000` | where Vite forwards `/api` and `/ws` |

### 3.4 Run

Terminal 1 — API (start MongoDB first):

```bash
cd server
npm run dev        # nodemon; use `npm start` for production
```

Terminal 2 — editor:

```bash
cd client
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
cd server
npm test                                   # node:test (integration suite skips without TEST_MONGODB_URI)
npm run simulate                           # 10 devices, one batch per second
npm run simulate -- --devices 50 --interval 500
npm run benchmark                          # 100 requests x 100 readings, concurrency 10
npm run benchmark -- --requests 500 --batch-size 1000 --concurrency 25
```

---

## 4. Time-series storage

On startup the server opens the native driver, checks whether `telemetry` exists and — **only if
it is missing** — creates it:

```js
db.createCollection('telemetry', {
  timeseries: { timeField: 'timestamp', metaField: 'metadata', granularity: 'seconds' },
  expireAfterSeconds: 2592000,        // only when TELEMETRY_RETENTION_SECONDS is set
});
```

* `metadata` = `{ deviceId, sensorType, location }`
* measurements = `value` (Number), `unit` (String) plus optional extra numeric fields
* index `{ "metadata.deviceId": 1, timestamp: -1 }` (named `device_timestamp`)
* If an existing `telemetry` collection has different time-series options, startup **fails loudly**
  instead of silently writing to the wrong shape.
* Retention is creation-only on purpose: silently shrinking a TTL can delete data.

---

## 5. Stream compiler (Day 2)

### 5.1 How a JSON graph becomes RxJS

`POST /api/graphs/:id/compile` loads a saved graph, validates it and compiles it into a live
pipeline held in memory by the `ActiveGraphManager`. Ingested telemetry is then pushed into the
pipeline's source Subjects.

```
  React Flow JSON (saved in MongoDB)        RxJS pipeline held in memory
  ─────────────────────────────────────    ────────────────────────────────────────────
  [Sensor]                                 Subject<event>                  (hot source)
   deviceId: turbine-001                     key: "turbine-001:temperature"
   sensorType: temperature                      │
       │                                        │  one per source node
       ▼                                        ▼
  [Moving Average] windowSize = 5   ──►   bufferCount(5, 1) -> map(average)
       │                                        │
       ▼                                        ▼
  [Threshold] operator ">" value 80 ──►   filter(event => event.value > 80)
       │                                        │
       ├──────────────► [SMS Alert]  ──►  concatMap(handler) -> alerts collection + /ws
       └──────────────► [Log]        ──►  concatMap(handler) -> console          (share())
```

The compiler does five things, and nothing else:

1. **Adjacency** — build `parents` / `children` maps from the edges.
2. **Sources** — create one RxJS `Subject` per source node, keyed by `deviceId:sensorType`.
3. **Chaining** — walk from each source and wrap the parent stream with the operator the
   registry provides (`registry[type].createOperator(config)`). A node with **more than one
   child** is wrapped in `share()`, so branching never duplicates work or side effects.
4. **Leaves** — every action node is subscribed; its handler runs once per event through
   `concatMap`, which keeps ordering even for asynchronous handlers.
5. **Teardown** — `dispose()` unsubscribes every subscription and completes every Subject.
   Recompiling or deactivating a graph always disposes the previous pipeline first.

An event flowing through a pipeline is:

```js
{ deviceId: 'turbine-001', sensorType: 'temperature', unit: '°C', timestamp: Date, value: 87.8 }
```

Reliability rules:

* every node stream ends with `catchError(...)`, so one failing node only stops its own branch;
* action handlers are wrapped so a rejected promise is turned into an alert with `delivered: false`
  instead of tearing down the subscription;
* `dryRun` mode (used by `/test` and the unit tests) never sends an SMS, calls a webhook or
  writes to MongoDB — it just collects the results.

### 5.2 Node registry (Open/Closed)

`src/compiler/nodeRegistry.js` maps a node type to a factory. `streamCompiler.js` contains no
node-specific logic, so a new operator is one new file plus one import:

```js
// src/compiler/operators/rateOfChange.js
import { map, pairwise } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

export function rateOfChange() {
  return (source$) => source$.pipe(pairwise(), map(([a, b]) => ({ ...b, value: b.value - a.value })));
}

registerNode({
  type: 'rateOfChange',
  category: 'math',
  label: 'Rate of Change',
  defaults: {},
  validate: () => [],
  createOperator: (config) => rateOfChange(),
});
```

| Type | Category | Config | Implementation |
| --- | --- | --- | --- |
| `sensor` | source | `deviceId`, `sensorType` | one `Subject` per node; `*` matches any value |
| `movingAverage` | math | `windowSize` (1–1000, default 5) | `bufferCount(n, 1)` + `map(average)` |
| `threshold` | math | `operator` (`>`, `>=`, `<`, `<=`, `==`, `!=`), `value` | `filter()` |
| `scale` | math | `factor`, `offset` | `map(v => v * factor + offset)` |
| `smsAlert` | action | `phone`, `messageTemplate` | mock gateway: console log + `alerts` document |
| `webhook` | action | `url`, `method` | Axios call, 3 s timeout, failures captured |
| `log` | action | `label`, `template` | console log + `alerts` document |

Message templates support `${deviceId}`, `${sensorType}`, `${value}`, `${unit}`, `${timestamp}`
and `${date}`.

### 5.3 Validation and the alerts collection

`graphValidator.js` returns `{ ok, errors, warnings }`. Errors block compilation: unknown node
types, duplicate ids, edges pointing at missing nodes, input into a source, output from an action,
more than one input per node, **cycles** (iterative DFS with a coloured stack) and a graph with no
source. Warnings are advisory: disconnected nodes, dangling outputs, no action node.

`Alert` documents (`graphId`, `nodeId`, `type`, `deviceId`, `sensorType`, `value`, `message`,
`triggeredAt`) are written by the SMS, webhook and log actions in live mode, and skipped in
dry-run mode.

---

## 6. Live execution flow (Day 3)

Every reading — HTTP single, HTTP batch or WebSocket — enters **one** RxJS Subject and fans out
from there. The HTTP response is sent first (202 after the durable write); rule evaluation and
browser delivery always happen on the next tick.

```
                       ┌────────────────────────── device (simulator / hardware / curl) ─┐
                       │                                                                  │
              POST /api/telemetry[/batch]                          WS { type:"telemetry" }
                       │                                                                  │
                       ▼                                                                  ▼
        ┌─────────────────────────────┐   validate + save   ┌──────────────────────────────────┐
        │  MongoDB (time-series)      │◄────────────────────│  HTTP 202 / WS ack (responded    │
        │  insertMany (non-blocking   │   setImmediate()    │  FIRST, before any rule runs)    │
        │  for the rule path)         │──────────────┐      └──────────────────────────────────┘
        └─────────────────────────────┘              │
                                                     ▼
                              ┌──────────────────────────────────────────┐
                              │  telemetryBus  (hot RxJS Subject)        │
                              │  + engine counters (processed / mps /    │
                              │    alertsFired)                          │
                              └──────────────────────────────────────────┘
                                   │                            │
             ┌─────────────────────┤                            ├──────────────────────┐
             ▼                     ▼                            ▼                      ▼
  ┌────────────────────┐  ┌──────────────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │ ruleExecutor       │  │ websocket broadcaster     │  │ (future sinks)  │  │ GET /api/engine/ │
  │ Map<key, routes>   │  │ per-device throttle >20/  │  │                 │  │ status           │
  │ deviceId:sensorType│  │ s -> sampleTime(100)      │  │                 │  │                  │
  └─────────┬──────────┘  └────────────┬─────────────┘  └──────────────────┘  └──────────────────┘
            │  one Subject per graph,   │
            │  catchError isolated      │
            ▼                           │
  ┌──────────────────────────────────┐  │
  │ compiled RxJS pipeline (per      │  │   channel subscribers
  │ active graph):                   │  │   · telemetry:<deviceId>  (or `telemetry` for all)
  │  Source Subject                  │  │   · alerts
  │    → MovingAverage → Threshold   │──┤   · graph:<graphId>  (alert + node_activity + status)
  │      → Action (tap → activityBus)│  │
  │      → Action fires:             │  │
  │         1. cooldown check (N s)  │  │
  │         2. Alert → MongoDB       │  │
  │         3. broadcast "alert"     │  │
  └──────────────────────────────────┘  │
                                        ▼
                       ┌─────────────────────────────────────────┐
                       │  Browser: WebSocketProvider (channels)  │
                       │   · Dashboard: rolling chart, stat      │
                       │     cards, alert feed + toast, engine   │
                       │     status (polls /api/engine/status)   │
                       │   · Editor: activation badge, inspector │
                       └─────────────────────────────────────────┘
```

Key properties:

* **Respond first, evaluate after** — `telemetryController` answers `202` right after
  `insertMany`; `telemetryBus.ingest()` runs inside `setImmediate`, so rule evaluation can never
  delay ingestion.
* **O(1) routing** — `ruleExecutor` indexes every compiled source as `deviceId:sensorType` in a
  `Map`; wildcard sources (`*`) live in a tiny side list. Graphs are never looped per reading, and
  multiple active graphs each get their own delivery Subject wrapped in `catchError`, so one
  broken pipeline cannot crash the engine (it logs and resubscribes).
* **Registration is automatic** — `activeGraphManager.activate()` registers the pipeline with the
  executor and broadcasts `graph_status: "active"`; `deactivate()` unregisters it, disposes the
  RxJS subscriptions and broadcasts `graph_status: "inactive"`.
* **Channel fan-out, not broadcast** — the WebSocket server keeps `channel -> Set<socket>` and
  sends a message only to sockets subscribed to a matching channel (deduplicated per socket).
  Devices faster than ~20 msg/s are sampled to 10 msg/s on the wire (latest wins, 100 ms window)
  while **every** reading is still saved and evaluated server-side.
* **Alert cooldown** — action nodes accept `cooldownSeconds` in their config: while the window is
  open (per device) the handler is never called, so nothing is persisted or broadcast. `0`
  (default) disables it.
* **Optional instrumentation** — with `NODE_ACTIVITY_ENABLED=true` (default) every node pipes a
  throttled `tap()` (`{ graphId, nodeId, value }`) to the `node_activity` channel for Day 4's
  glowing wires; set it to `false` to remove the taps from production pipelines.

---

## 7. API reference

Base URL: `http://localhost:5000/api`

| Method | Endpoint | Body / query | Response |
| --- | --- | --- | --- |
| `GET` | `/health` | – | `200 { status: "ok", database: "connected" }`, `503` when Mongo is down |
| `POST` | `/telemetry` | single reading | `202 { accepted: 1 }` |
| `POST` | `/telemetry/batch` | array of 1–1000 readings | `202 { accepted: n }` |
| `GET` | `/telemetry` | `deviceId`, `from`, `to`, `limit` (1–1000, default 100) | `200 { data: [...] }` newest first |
| `POST` | `/graphs` | `{ name, nodes, edges, viewport? }` | `201 { data: graph }` |
| `GET` | `/graphs` | – | `200 { data: [ { _id, name, createdAt, updatedAt } ] }` (max 100) |
| `GET` | `/graphs/:id` | – | `200 { data: graph }` / `404` |
| `PUT` | `/graphs/:id` | full graph | `200 { data: graph }` / `404` |
| `DELETE` | `/graphs/:id` | – | `204` / `404` |
| `POST` | `/graphs/validate` | raw graph JSON | `200 { valid, errors, warnings, summary }` — validates without saving |
| `POST` | `/graphs/:id/compile` | – | `200 { data: { graphId, name, nodeCount, edgeCount, sources, subscriptions } }`, `400` with `error.details` when invalid |
| `POST` | `/graphs/:id/deactivate` | – | `200 { data: { graphId, active: false } }`, `404` when it was not running |
| `GET` | `/graphs/active` | – | `200 { data: [ { graphId, name, nodeCount, edgeCount, sources, activatedAt, subscriptions } ] }` |
| `POST` | `/graphs/:id/test` | `{ values: [70, 85, 90] }` | `200 { data: { dryRun: true, delivered, alertCount, alerts[] } }` |
| `GET` | `/alerts` | `graphId`, `deviceId`, `limit` (1–500, default 50) | `200 { data: [...] }` recent alerts, newest first |
| `GET` | `/telemetry/stats` | `deviceId`, `window` (`30s`/`5m`/`2h`/`1d`, default `5m`) | `200 { data: { buckets: [ { minute, avg, min, max, count } ] } }` — MongoDB `$dateTrunc` per-minute aggregation |
| `GET` | `/engine/status` | – | `200 { data: { activeGraphs, messagesProcessed, messagesPerSecond, alertsFired, routedReadings, routingErrors, uptimeSeconds } }` |

Reading payload:

```json
{
  "timestamp": "2026-11-10T10:30:00.000Z",
  "metadata": { "deviceId": "turbine-001", "sensorType": "temperature", "location": "Bay 3" },
  "value": 86.4,
  "unit": "°C",
  "vibrationRms": 3.1
}
```

* `timestamp` is optional and defaults to ingestion time; ISO-8601 strings are accepted.
* Extra keys must be numeric (`catchall(z.number())`) — they become additional measurements.
* Batch writes use `insertMany(..., { ordered: false, lean: true })`, so one bad reading cannot
  stall the rest of the batch.
* `202` is returned **after** the write is acknowledged; the WebSocket broadcast is best-effort
  and happens after the response is sent.

### WebSocket (Day 3 channel protocol)

`ws://localhost:5000/ws`

**Client → server**

```jsonc
{ "type": "subscribe",   "channels": ["telemetry:turbine-001", "alerts", "graph:<graphId>"] }
{ "type": "unsubscribe", "channels": ["alerts"] }
{ "type": "telemetry",   "data": { "timestamp": "...", "metadata": { "deviceId": "turbine-001", "sensorType": "temperature", "location": "Bay 3" }, "value": 86.4, "unit": "°C" } }
{ "type": "ping" }
```

Channels: `telemetry` (all devices), `telemetry:<deviceId>`, `alerts`, `graph:<graphId>`.
Malformed JSON, unknown types and invalid payloads get `{ "type": "error", ... }` back and never
crash the server.

**Server → client**

```jsonc
{ "type": "connected",     "data": { "message": "Connected to NexusFlow", "channels": [...] } }
{ "type": "subscribed",    "data": { "channels": ["alerts"] } }
{ "type": "ack",           "data": { "accepted": 1, "timestamp": "..." } }        // WS ingestion
{ "type": "telemetry",     "data": { "metadata": { "deviceId": "turbine-001" }, "value": 86.4, "unit": "°C" } }
{ "type": "alert",         "data": { "graphId", "nodeId", "deviceId", "value", "message", "severity", "triggeredAt" } }
{ "type": "node_activity", "data": { "graphId", "nodeId", "value", "timestamp" } }   // Day 4 glowing wires
{ "type": "graph_status",  "data": { "graphId", "status": "active|inactive|error" } }
{ "type": "error",         "data": { "message": "..." } }
```

Delivery is per subscription — a socket only ever receives messages for its channels (deduplicated
if it subscribes to several channels carrying the same message). Devices sending faster than
~20 msg/s are sampled to 10 msg/s **on the broadcast path only**; saving and rule evaluation see
every reading. Clients that buffer more than 1 MB are skipped rather than slowing ingestion, and
dead sockets are reaped by a 30-second ping/pong heartbeat.

---

## 8. Simulator and benchmark

**Simulator** (`server/scripts/simulator.js`) — emits temperature, vibration and pressure readings
for N devices every X ms, injects anomaly spikes (temperature > 80 °C), and ships them over HTTP,
WebSocket or both (chunked at the 1,000-reading API limit for HTTP):

```bash
cd server
npm run simulate                                   # 10 devices, 1000 ms, HTTP batches
npm run simulate -- --devices 50 --interval 200    # 150 readings every 200 ms
npm run simulate -- --transport ws                 # push every reading over /ws
npm run simulate -- --transport both --spikes 0.15 # HTTP + WS with 15% anomaly chance
npm run simulate -- --url http://192.168.1.20:5000 # point at another host
```

**Engine check** (`server/scripts/engineCheck.js`) — the Day 3 end-to-end assertion: activates the
sample turbine graph, pushes a deterministic series with anomaly spikes (HTTP or WS), replays the
moving-average/threshold window locally to compute the expected alert count, then compares it with
`GET /api/alerts`:

```bash
cd server
npm run engine-check                                # 60 readings, spike every 7th
npm run engine-check -- --transport ws --rounds 200 --spike-every 3
#   readings sent    : 60
#   alerts expected  : 9
#   alerts fired     : 9
#   result           : PASS ✓          (exit code 0; the graph is deactivated afterwards)
```

**Benchmark** (`server/scripts/benchmark.js`) — fires concurrent batch requests and prints
writes/sec. It pre-serialises the payload so client-side JSON work is excluded:

```bash
cd server
npm run benchmark
npm run benchmark -- --requests 1000 --batch-size 500 --concurrency 40
# Accepted 500,000 readings in 61.20 s (0 failed requests).
# Throughput: 8,169 writes/sec. Mid-project target: 5,000 writes/sec (informational).
```

Throughput depends on hardware, storage and whether `mongod` is local; batching is the difference
between hundreds and thousands of writes per second.

---

## 9. Visual editor

**Nodes (Day 2)** — each node type is a React component registered once at module scope in
`client/src/components/nodes/index.js`:

| Group | Nodes | Handles |
| --- | --- | --- |
| Data sources | `SensorNode` — `deviceId`, `sensorType` | output only |
| Math operations | `MovingAverageNode` (`windowSize`), `ThresholdNode` (`operator`, `value`), `ScaleNode` (`factor`, `offset`) | input + output |
| Action triggers | `SmsAlertNode` (`phone`, `messageTemplate`), `WebhookNode` (`url`, `method`), `LogNode` (`label`, `template`) | input only |

Every node renders a card with an icon, a category colour (source = blue, math = amber,
action = red), the category label, a summary badge and editable inputs. Inputs carry the
`nodrag` / `nopan` classes and write straight into React Flow state through
`useReactFlow().updateNodeData(id, { config: { key: value } })`, so config survives a save/load
round trip.

**Connection rules** (`canvas/graphRules.js`, enforced live by `isValidConnection`):
sources cannot receive input, actions cannot output, self-connections, duplicates and any edge
that would create a loop are refused, and only `Source -> Math -> … -> Action` and
`Source -> Action` flows are allowed. Dropping on an invalid target shows the reason in a toast.

**Toolbar (Day 3)** — editable graph name, live backend health pill, an **INACTIVE / ACTIVE /
ERROR** engine badge fed by `graph_status` messages, **Activate** / **Deactivate**
(`POST /graphs/:id/compile` and `/deactivate`), **Send test data** (pushes 4 normal + 2 overheat
readings through the real ingestion API so a rule can be seen firing from the UI), then
**Load graph**, **Validate graph** (checks source/action presence, disconnected nodes and cycles;
the backend is asked too when it is reachable), **Export JSON** (downloads
`{ name, nodes, edges, viewport }` and offers a copy-to-clipboard action) and **Save graph**.
Navigation between the **Editor** and the live **Dashboard** is a pill switcher in the header.

**Canvas** — drag to pan, scroll to zoom, MiniMap, Controls, dotted Background, smooth-step
edges, delete with <kbd>Delete</kbd> / <kbd>Backspace</kbd>.

**Inspector** — node/edge counts, selected-node details, a remove action and the live telemetry
feed driven by `/ws`.

Saved JSON is deliberately clean (no React Flow runtime state):

```json
{
  "name": "Turbine overheat rule",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [
    { "id": "sensor-turbine", "type": "sensor", "position": { "x": 0, "y": 96 },
      "data": { "kind": "sensor", "label": "Sensor", "category": "source",
                "config": { "deviceId": "turbine-001", "sensorType": "temperature" } } }
  ],
  "edges": [{ "id": "edge-1", "source": "sensor-turbine", "target": "average-1" }]
}
```

---

## 10. Verification checklist

### 10.1 Start MongoDB, server and client

```bash
# MongoDB (pick one)
mongod --dbpath ~/mongodb-data --port 27017                     # local
docker run -d --name nexusflow-mongo -p 27017:27017 mongo:7     # Docker
# or point MONGODB_URI at an Atlas cluster

cd server && npm install && cp .env.example .env && npm run dev
# -> "MongoDB connected: nexusflow"
# -> "Created telemetry time-series collection."
# -> "NexusFlow API listening on port 5000; WebSocket: /ws"

cd client && npm install && cp .env.example .env && npm run dev
# -> http://localhost:5173 ; the health pill shows "Backend connected"
```

### 10.2 Confirm the time-series collection exists

```bash
mongosh "mongodb://127.0.0.1:27017/nexusflow"
```

```js
db.getCollectionInfos({ name: 'telemetry' })
// [{ name: 'telemetry', type: 'timeseries',
//    options: { timeseries: { timeField: 'timestamp', metaField: 'metadata',
//                             granularity: 'seconds', bucketMaxSpanSeconds: 3600 } }, ... }]

db.telemetry.getIndexes()
// _id_ ... and { name: 'device_timestamp', key: { 'metadata.deviceId': 1, timestamp: -1 } }
```

### 10.3 Ingest a single reading and a batch

```bash
# single
curl -i -X POST http://localhost:5000/api/telemetry \
  -H 'Content-Type: application/json' \
  -d '{"timestamp":"2026-11-10T10:30:00.000Z","metadata":{"deviceId":"turbine-001","sensorType":"temperature","location":"Bay 3"},"value":86.4,"unit":"°C"}'
# HTTP/1.1 202 Accepted   {"accepted":1}

# batch (note the JSON array)
curl -i -X POST http://localhost:5000/api/telemetry/batch \
  -H 'Content-Type: application/json' \
  -d '[{"metadata":{"deviceId":"turbine-001","sensorType":"temperature","location":"Bay 3"},"value":52.1,"unit":"°C"},
       {"metadata":{"deviceId":"turbine-002","sensorType":"vibration","location":"Bay 3"},"value":3.4,"unit":"mm/s"}]'
# HTTP/1.1 202 Accepted   {"accepted":2}

# read it back
curl 'http://localhost:5000/api/telemetry?deviceId=turbine-001&limit=5'
curl 'http://localhost:5000/api/telemetry?from=2026-11-10T00:00:00.000Z&to=2026-11-10T23:59:59.000Z&limit=100'

# health
curl -i http://localhost:5000/api/health
# 200 {"status":"ok","database":"connected"}
```

Rejections to expect: `400` with `{ "error": { "message": "Validation failed.", "details": [...] } }`
for non-numeric `value`, a batch of 1,001 readings, or `from > to`.

### 10.4 Verify the WebSocket endpoint

```bash
npx --yes wscat -c ws://localhost:5000/ws
# connected (press CTRL+C to quit)
# < {"type":"connected","data":{"message":"Connected to NexusFlow"}}
# then, from another terminal:
curl -X POST http://localhost:5000/api/telemetry -H 'Content-Type: application/json' \
  -d '{"metadata":{"deviceId":"turbine-001","sensorType":"temperature","location":"Bay 3"},"value":91.2,"unit":"°C"}'
# < {"type":"telemetry","data":{ ... "value":91.2 ... }}
```

> `npx wscat` needs registry access; the browser client also prints the connection state in the
> inspector's **LIVE TELEMETRY** panel (`LIVE` / `CONNECTING` / `OFFLINE`).

### 10.5 Save and load a graph from the UI

1. Open `http://localhost:5173`. The seed graph **Turbine Sensor → Moving Average → SMS Alert**
   is already on the canvas.
2. Drag **Temperature Sensor** from the palette onto the canvas, then drag from the circle on its
   right edge to the left edge of **Threshold** to connect them.
3. Click the graph name (top-left of the canvas) and rename it, e.g. `Turbine overheat rule`.
4. Click **Save graph** → toast "Graph saved. Nice work!".

   ```bash
   curl http://localhost:5000/api/graphs
   # {"data":[{"_id":"...","name":"Turbine overheat rule","createdAt":"...","updatedAt":"..."}]}
   ```
5. Delete every node (select + <kbd>Delete</kbd>) or reload the page, then click **Load graph**,
   pick `Turbine overheat rule`, and the nodes, edges and viewport are restored.
6. Sanity check by ID:

   ```bash
   curl http://localhost:5000/api/graphs/<id> | head -c 400
   curl -X DELETE http://localhost:5000/api/graphs/<id> -i   # 204 No Content
   ```

### 10.6 Automated tests

```bash
cd server
npm test                 # vitest compiler suite + node:test HTTP/database/WS suite
npm run test:compiler    # 44 unit tests: validator, operators, stream compiler,
                         #   ruleExecutor routing/isolation, activity taps, cooldown
npm run test:http        # HTTP routes (validation, compile, stubbed model) +
                         #   WebSocket channel protocol (subscribe/unsubscribe/ingest/throttle)
TEST_MONGODB_URI="mongodb://127.0.0.1:27017" npm test
# the integration suite creates a throwaway database and asserts the time-series
# options, the compound index, single/batch ingestion, the query endpoint,
# graph CRUD and the WebSocket connected/telemetry messages

cd ../client
npm run build            # production build of the editor + dashboard
```

### 10.7 Day 2: compile, test and deactivate a graph

```bash
# 1. Load the sample graph (Sensor -> MovingAverage(5) -> Threshold(>80) -> SMS Alert)
curl -X POST http://localhost:5000/api/graphs \
  -H 'Content-Type: application/json' \
  -d @server/samples/turbine-graph.json
# -> 201 { "data": { "_id": "6734...", ... } }

GRAPH_ID=<paste the _id from above>

# 2. Validate raw JSON without saving it
curl -X POST http://localhost:5000/api/graphs/validate \
  -H 'Content-Type: application/json' -d @server/samples/turbine-graph.json
# -> { "valid": true, "errors": [], "warnings": [], "summary": { "nodeCount": 4, "edgeCount": 3 } }

# 3. Compile + activate
curl -X POST http://localhost:5000/api/graphs/$GRAPH_ID/compile
# -> 200 { "data": { "nodeCount": 4, "edgeCount": 3,
#           "sources": [ { "nodeId": "sensor-turbine", "key": "turbine-001:temperature" } ],
#           "subscriptions": 1 } }

# 4. Dry run: six values through a 5-reading window -> two alerts
curl -X POST http://localhost:5000/api/graphs/$GRAPH_ID/test \
  -H 'Content-Type: application/json' \
  -d '{"values":[70,85,90,95,99,100]}'
# -> { "data": { "dryRun": true, "delivered": 6, "alertCount": 2,
#           "alerts": [ { "type": "smsAlert", "value": 87.8,
#                         "message": "ALERT turbine-001 temperature average = 87.80" }, ... ] } }

# 5. List active pipelines, then deactivate
curl http://localhost:5000/api/graphs/active
curl -X POST http://localhost:5000/api/graphs/$GRAPH_ID/deactivate   # -> 200
curl http://localhost:5000/api/graphs/active                         # -> { "data": [] }
```

Live check (with the simulator running): the graph above fires an SMS alert as soon as the
5-reading average for `turbine-001 / temperature` passes 80 — watch the server log for
`[sms -> +911234567890] ...`, the `alerts` collection for the persisted document, and `/ws` for
`{ "type": "alert", ... }` messages.

```bash
cd server && npm run simulate -- --devices 1 --interval 200
mongosh "mongodb://127.0.0.1:27017/nexusflow" --eval 'db.alerts.find().sort({triggeredAt:-1}).limit(5)'
```

### 10.8 Day 2: build and save the turbine graph in the UI

1. `cd client && npm run dev` and open `http://localhost:5173`. The canvas starts with the
   Day 2 seed graph: **Sensor → Moving Average → Threshold → SMS Alert**.
2. Edit a node in place: click the **Device ID** field of the sensor and type `turbine-007`, set
   the moving average **window size** to `5`, the threshold to `> 80` and the SMS **phone** to
   `+911234567890`. Values are stored on the node as you type.
3. Drag **Log** from *Action triggers* onto the canvas, then drag from the Threshold's right
   handle to the Log's left handle: the threshold now fans out to two actions.
4. Click **Validate graph** → the panel reports *"Graph is valid"* (or lists the problem with a
   **Show node** button that centres the offending node).
5. Click **Save graph** → toast *"Graph saved with 5 nodes and 4 edges."*
6. Click **Export JSON** → `turbine-overheat-rule.json` is downloaded (the toast also offers
   **Copy JSON**). The file contains exactly `{ name, viewport, nodes[{id,type,position,data}],
   edges[{id,source,target}] }`.
7. Reload the page, click **Load graph**, pick the saved graph: every node, edge, position and
   **config value** is restored.
8. Copy the downloaded file to the server and compile it:
   `curl -X POST localhost:5000/api/graphs -H 'Content-Type: application/json' -d @turbine-overheat-rule.json`
   then `curl -X POST localhost:5000/api/graphs/<id>/compile`.

### 10.9 Day 3: live execution and the dashboard

**Activate from the UI**

1. Open the editor (`http://localhost:5173`), load or save the turbine graph, then press
   **Activate** in the toolbar → the badge switches to `ACTIVE` (green pulse) and a toast confirms
   the subscription count. The server logs nothing extra; the pipeline is now fed by `telemetryBus`.
2. Press **Send test data** → six readings (4 normal + 2 × 96 °C spikes) go through the real
   ingestion API. With the 5-reading average crossing 80 you get an alert toast on the dashboard
   and the server logs `[sms -> +911234567890] ALERT turbine-001 ...`.
3. Or run the simulator: `cd server && npm run simulate -- --devices 1 --interval 200 --spikes 0.3`.
4. Open the **Dashboard** (nav pill, Editor | Dashboard) and pick `turbine-001` / `temperature`.

**What to expect on the dashboard**

* **Chart** — a rolling window of the last 60 points updating ~5×/second (messages are buffered
  and flushed every 200 ms; Recharts animation is off). When an active graph has a threshold for
  the selected device/sensor, a red dashed **reference line** (`threshold > 80`) is drawn.
* **Stat cards** — latest / average / min / max over the window plus live messages/sec.
* **Alert feed** — new alerts appear instantly, newest first, severity-coloured, with a
  toast notification (auto-dismisses after 6 s). The feed is pre-filled from `GET /api/alerts`.
* **Engine status** — active graphs, messages/sec, total processed and alerts fired, polled from
  `GET /api/engine/status` every 5 s.
* **Deactivate** in the editor → the badge returns to `INACTIVE`, `graph_status: "inactive"` is
  broadcast, and the alert feed stops growing while the simulator keeps running.

**Manual WebSocket test (wscat)**

```bash
npx wscat -c ws://localhost:5000/ws
# then inside the wscat shell:
> {"type":"subscribe","channels":["telemetry:turbine-001","alerts"]}
< {"type":"subscribed","data":{"channels":["telemetry:turbine-001","alerts"]}}
# start the simulator in another terminal; you should see (throttled) telemetry:
< {"type":"telemetry","data":{"metadata":{"deviceId":"turbine-001",...},"value":52.31,"unit":"°C"}}
# push a spike over the same socket:
> {"type":"telemetry","data":{"timestamp":"2026-11-12T10:00:00.000Z","metadata":{"deviceId":"turbine-001","sensorType":"temperature","location":"wscat"},"value":97,"unit":"°C"}}
< {"type":"ack","data":{"accepted":1,"timestamp":"2026-11-12T10:00:00.000Z"}}
# if the turbine graph is active, an alert follows once the window average is > 80:
< {"type":"alert","data":{"graphId":"...","deviceId":"turbine-001","value":87.8,"severity":"critical","message":"ALERT ..."}}
# a client that never subscribed gets nothing:
> {"type":"unsubscribe","channels":["alerts"]}   # now alerts stop, telemetry continues
```

**curl examples for the Day 3 APIs**

```bash
# recent alerts for one device (optionally &graphId=<id>)
curl 'http://localhost:5000/api/alerts?deviceId=turbine-001&limit=10'

# per-minute avg/min/max/count over the last 5 minutes (window: 30s | 5m | 2h | 1d)
curl 'http://localhost:5000/api/telemetry/stats?deviceId=turbine-001&window=5m'
# -> { "data": { "buckets": [ { "minute": "...", "avg": 61.2, "min": 45, "max": 99, "count": 30 }, ... ] } }

# engine counters (what the dashboard panel polls)
curl 'http://localhost:5000/api/engine/status'
# -> { "data": { "activeGraphs": 1, "messagesProcessed": 1240, "messagesPerSecond": 18,
#               "alertsFired": 7, "routedReadings": 1240, "routingErrors": 0, "uptimeSeconds": 92 } }

# scripted end-to-end check: activate -> spike series -> compare alerts vs expected
cd server && npm run engine-check
```

---

## 11. Files

Every file's complete source, in the same order as the folder tree above, is collected in
[`CODE.md`](CODE.md). [`DAY2-FILES.md`](DAY2-FILES.md) contains only the files that were added or
modified on Day 2; [`DAY3-FILES.md`](DAY3-FILES.md) does the same for Day 3 (live execution).

## 12. Notes on this build

* Ingestion acknowledgment is tied to a successful database write; the WebSocket broadcast is
  separate and best-effort by design.
* `Device` is modelled now and left unused — device registration endpoints land with a later
  milestone.
* Day 2 keeps the Day 1 node type `nexus` registered (`canvas/FlowNode.jsx`) so graphs saved
  before Day 2 still render on the canvas; they are reported as an unknown type by the validator
  until they are rebuilt with typed nodes.
* The graph is stored as raw React Flow JSON (`Mixed`), so new node fields survive a round trip
  without a migration.
* The integration test is skipped unless `TEST_MONGODB_URI` is set, so `npm test` stays useful
  offline.
