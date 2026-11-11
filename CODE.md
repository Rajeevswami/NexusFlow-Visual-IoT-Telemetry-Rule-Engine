# NexusFlow — complete source, file by file

Every file in this repository is reproduced below in the same order as the folder tree in
`README.md`. Generated from the working tree on branch
`arena/90868532-nexusflow-visual-iot-telemetry` (Day 1 + Day 2).
For a Day-2-only view, see [`DAY2-FILES.md`](DAY2-FILES.md).

## `README.md`

```md
# NexusFlow — Visual IoT Telemetry & Rule Engine

NexusFlow lets non-technical users build IoT rules visually on a drag-and-drop canvas
(for example **Turbine Sensor → Moving Average → SMS Alert**). Later milestones compile that
graph into RxJS streams and run it against high-frequency telemetry.

**Day 1 scope:** the time-series storage layer, the high-speed ingestion API, the WebSocket
fan-out, and the React Flow editor scaffold with graph persistence.

**Day 2 scope:** custom, configurable node types (sources, math, actions), the **stream compiler**
that turns a saved React Flow JSON graph into executable RxJS pipelines, graph validation and
serialization end to end, and the alerts collection written by action nodes.

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
│   │   ├── simulator.js          # mock hardware: N devices, anomaly spikes, batched POSTs
│   │   └── benchmark.js          # throughput harness (target: 5,000 writes/sec)
│   ├── test/
│   │   ├── validation.test.js    # schema + HTTP behaviour, no database
│   │   ├── integration.test.js   # real MongoDB, skipped unless TEST_MONGODB_URI is set
│   │   ├── compilerRoutes.test.js# compile/test/activate HTTP routes (model stubbed)
│   │   └── compiler/
│   │       ├── graphValidator.test.js
│   │       ├── operators.test.js
│   │       └── streamCompiler.test.js
│   └── src/
│       ├── server.js             # HTTP bootstrap + /ws + graceful shutdown
│       ├── app.js                # helmet, cors, morgan, routes, error middleware
│       ├── config/{env,db}.js    # Zod env; native time-series provisioning
│       ├── models/
│       │   ├── Telemetry.js      # points at the native `telemetry` time-series collection
│       │   ├── Device.js         # deviceId, name, type, location, createdAt
│       │   ├── Graph.js          # name, nodes[], edges[], viewport, timestamps
│       │   └── Alert.js          # DAY 2: alerts raised by action nodes
│       ├── controllers/{telemetryController,graphController}.js
│       ├── routes/{telemetryRoutes,graphRoutes}.js
│       ├── services/
│       │   ├── websocket.js      # connected / telemetry / alert broadcasts
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
        ├── components/
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
        │   ├── layout/Navbar.jsx       # health + Load / Validate / Export / Save
        │   ├── FlowInspector.jsx       # stats, checklist, live telemetry
        │   ├── GraphPicker.jsx         # accessible "Load graph" modal
        │   └── ValidationPanel.jsx     # validation errors and warnings
        └── services/
            ├── api.js             # Axios client (+ compile / validate / test helpers)
            ├── useTelemetry.js    # same-origin WebSocket hook w/ reconnect
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

## 6. API reference

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

### WebSocket

`ws://localhost:5000/ws`

```jsonc
// on connect
{ "type": "connected", "data": { "message": "Connected to NexusFlow" } }

// on every accepted ingestion request
{ "type": "telemetry", "data": { "metadata": { "deviceId": "turbine-001" }, "value": 86.4, "unit": "°C" } }

// Day 2: raised by an action node of an active pipeline
{ "type": "alert", "data": { "graphId": "...", "nodeId": "sms-1", "type": "smsAlert", "deviceId": "turbine-001", "value": 87.8, "message": "ALERT turbine-001 temperature average = 87.80" } }
```

Clients that buffer more than 1 MB are skipped rather than slowing ingestion, and dead sockets are
reaped by a 30-second ping/pong heartbeat.

---

## 7. Simulator and benchmark

**Simulator** (`server/scripts/simulator.js`) — emits temperature, vibration and pressure readings
for N devices every X ms, injects an anomaly spike (temperature > 80 °C) in ~4% of ticks, and posts
each tick as a batch (chunked at the 1,000-reading API limit):

```bash
cd server
npm run simulate                                   # 10 devices, 1000 ms
npm run simulate -- --devices 50 --interval 200    # 150 readings every 200 ms
npm run simulate -- --url http://192.168.1.20:5000 # point at another host
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

## 8. Visual editor

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

**Toolbar** — editable graph name, live backend health pill, **Load graph**, **Validate graph**
(checks source/action presence, disconnected nodes and cycles; the backend is asked too when it
is reachable), **Export JSON** (downloads `{ name, nodes, edges, viewport }` and offers a
copy-to-clipboard action) and **Save graph**.

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

## 9. Verification checklist

### 9.1 Start MongoDB, server and client

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

### 9.2 Confirm the time-series collection exists

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

### 9.3 Ingest a single reading and a batch

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

### 9.4 Verify the WebSocket endpoint

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

### 9.5 Save and load a graph from the UI

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

### 9.6 Automated tests

```bash
cd server
npm test                 # vitest compiler suite + node:test HTTP/database suite
npm run test:compiler    # 28 unit tests: validator, operators, stream compiler
npm run test:http        # HTTP routes (validation, compile, compile-with-stubbed-model)
TEST_MONGODB_URI="mongodb://127.0.0.1:27017" npm test
# the integration suite creates a throwaway database and asserts the time-series
# options, the compound index, single/batch ingestion, the query endpoint,
# graph CRUD and the WebSocket connected/telemetry messages

cd ../client
npm run build            # production build of the editor
```

### 9.7 Day 2: compile, test and deactivate a graph

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

### 9.8 Day 2: build and save the turbine graph in the UI

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

---

## 10. Files

Every file's complete source, in the same order as the folder tree above, is collected in
[`CODE.md`](CODE.md). [`DAY2-FILES.md`](DAY2-FILES.md) contains only the files that were added or
modified on Day 2.

## 11. Notes on this build

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
```

## `server/package.json`

```json
{
  "name": "nexusflow-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "simulate": "node scripts/simulator.js",
    "benchmark": "node scripts/benchmark.js",
    "test": "vitest run && node --test test/validation.test.js test/integration.test.js test/compilerRoutes.test.js",
    "test:compiler": "vitest run",
    "test:http": "node --test test/validation.test.js test/integration.test.js test/compilerRoutes.test.js"
  },
  "dependencies": {
    "axios": "^1.21.1",
    "cors": "^2.8.5",
    "dotenv": "^16.6.1",
    "express": "^4.22.1",
    "helmet": "^8.1.0",
    "mongoose": "^8.24.8",
    "morgan": "^1.10.1",
    "rxjs": "^7.8.2",
    "ws": "^8.22.2",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "nodemon": "^3.1.11",
    "supertest": "^7.2.2",
    "vitest": "^5.1.0"
  }
}
```

## `server/.env.example`

```dotenv
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/nexusflow
# Comma-separated browser origins permitted for direct cross-origin requests.
# The Vite development proxy is same-origin and does not require CORS.
CLIENT_ORIGIN=http://localhost:5173
# Optional positive integer. Applies when the telemetry collection is first created.
TELEMETRY_RETENTION_SECONDS=
```

## `server/vitest.config.js`

```js
import { defineConfig } from 'vitest/config';

/**
 * Vitest runs the compiler unit tests (pure logic, no database).
 * The HTTP/database suites stay on Node's built-in runner, see the "test" script.
 */
export default defineConfig({
  test: {
    include: ['test/compiler/**/*.test.js'],
    environment: 'node',
    reporters: 'default',
  },
});
```

## `server/src/config/env.js`

```js
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/nexusflow'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  TELEMETRY_RETENTION_SECONDS: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = {
  nodeEnv: result.data.NODE_ENV,
  port: result.data.PORT,
  mongoUri: result.data.MONGODB_URI,
  clientOrigins: result.data.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
  telemetryRetentionSeconds: result.data.TELEMETRY_RETENTION_SECONDS,
};
```

## `server/src/config/db.js`

```js
import mongoose from 'mongoose';
import { env } from './env.js';

const collectionName = 'telemetry';
const expectedTimeSeries = {
  timeField: 'timestamp',
  metaField: 'metadata',
  granularity: 'seconds',
};

/** Create the collection before Mongoose can write any measurements to it. */
export async function ensureTelemetryCollection(db, retentionSeconds) {
  let existing = await db.listCollections({ name: collectionName }, { nameOnly: false }).next();

  if (!existing) {
    const options = { timeseries: expectedTimeSeries };
    if (retentionSeconds !== undefined) options.expireAfterSeconds = retentionSeconds;
    try {
      await db.createCollection(collectionName, options);
      console.info('Created telemetry time-series collection.');
    } catch (error) {
      // Another app instance may have created the collection between our check and create.
      if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
    }
    existing = await db.listCollections({ name: collectionName }, { nameOnly: false }).next();
  }

  const actual = existing?.options?.timeseries;
  if (!actual || actual.timeField !== expectedTimeSeries.timeField || actual.metaField !== expectedTimeSeries.metaField || actual.granularity !== expectedTimeSeries.granularity) {
    throw new Error('Existing telemetry collection is not the expected time-series collection (timestamp, metadata, seconds). Refusing to modify it.');
  }

  // Retention is deliberately creation-only; silently changing it could delete existing data.
  const existingRetention = existing.options.expireAfterSeconds;
  if (retentionSeconds !== undefined && Number(existingRetention) !== retentionSeconds) {
    console.warn('TELEMETRY_RETENTION_SECONDS differs from the existing collection. The existing retention setting was not changed.');
  }

  await db.collection(collectionName).createIndex(
    { 'metadata.deviceId': 1, timestamp: -1 },
    { name: 'device_timestamp' },
  );
}

export async function connectDatabase() {
  // Fail operations rather than buffering them indefinitely during a disconnect.
  mongoose.set('bufferCommands', false);
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
  await ensureTelemetryCollection(mongoose.connection.db, env.telemetryRetentionSeconds);
  console.info(`MongoDB connected: ${mongoose.connection.name}`);
}
```

## `server/src/models/Telemetry.js`

```js
import mongoose from 'mongoose';

const telemetrySchema = new mongoose.Schema({
  timestamp: { type: Date, required: true },
  metadata: {
    deviceId: { type: String, required: true },
    sensorType: { type: String, required: true },
    location: { type: String, required: true },
  },
  value: { type: Number, required: true },
  unit: { type: String, required: true },
}, {
  collection: 'telemetry',
  // Extra numeric measurements are validated at the API boundary.
  strict: false,
  versionKey: false,
  // The native driver must create the time-series collection before any writes.
  autoCreate: false,
  autoIndex: false,
});

export const Telemetry = mongoose.model('Telemetry', telemetrySchema);
```

## `server/src/models/Device.js`

```js
import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  location: { type: String, required: true, trim: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const Device = mongoose.model('Device', deviceSchema);
```

## `server/src/models/Graph.js`

```js
import mongoose from 'mongoose';

const graphSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  // React Flow owns the node/edge shape; retain its raw JSON without stripping fields.
  nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
  edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
  viewport: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true, minimize: false, versionKey: false });

export const Graph = mongoose.model('Graph', graphSchema);
```

## `server/src/models/Alert.js`

```js
import mongoose from 'mongoose';

/**
 * Alerts raised by action nodes of a compiled pipeline.
 * Stored in a normal collection (not time-series) because alerts are low volume,
 * are read by id/graph and are kept for auditing.
 */
const alertSchema = new mongoose.Schema({
  graphId: { type: mongoose.Schema.Types.ObjectId, ref: 'Graph', index: true },
  nodeId: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  deviceId: { type: String, required: true, trim: true, index: true },
  sensorType: { type: String, trim: true },
  value: { type: Number },
  message: { type: String, required: true },
  triggeredAt: { type: Date, default: Date.now },
}, { timestamps: false, versionKey: false });

export const Alert = mongoose.model('Alert', alertSchema);
```

## `server/src/validation/telemetry.js`

```js
import { z } from 'zod';

const boundedText = z.string().trim().min(1).max(120);
const timestamp = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const knownFields = new Set(['timestamp', 'metadata', 'value', 'unit']);

export const readingSchema = z.object({
  // A missing timestamp is captured at ingestion, not at schema construction.
  timestamp: timestamp.optional().transform((value) => value ?? new Date()),
  metadata: z.object({
    deviceId: boundedText,
    sensorType: boundedText,
    location: boundedText,
  }).strict(),
  value: z.number().finite(),
  unit: boundedText,
}).catchall(z.number().finite()).superRefine((reading, context) => {
  const extras = Object.keys(reading).filter((key) => !knownFields.has(key));
  if (extras.length > 32) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'At most 32 extra numeric measurements are allowed.' });
  }
  for (const key of extras) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Extra measurement names must start with a letter and contain only letters, digits, or underscores.' });
    }
  }
});

export const batchSchema = z.array(readingSchema).min(1).max(1000);

export const telemetryQuerySchema = z.object({
  deviceId: boundedText.optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
}).strict().refine((query) => !query.from || !query.to || query.from <= query.to, {
  message: 'from must be earlier than or equal to to.',
  path: ['from'],
});
```

## `server/src/validation/graph.js`

```js
import { z } from 'zod';

const id = z.string().trim().min(1).max(200);
const nodeSchema = z.object({
  id,
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).passthrough(),
  data: z.record(z.unknown()),
}).passthrough();
const edgeSchema = z.object({ id, source: id, target: id }).passthrough();

export const graphSchema = z.object({
  name: z.string().trim().min(1).max(100),
  nodes: z.array(nodeSchema).max(500),
  edges: z.array(edgeSchema).max(2000),
  viewport: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().finite().positive(),
  }).optional(),
}).strict().superRefine((graph, context) => {
  const nodeIds = new Set();
  graph.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index, 'id'], message: 'Node IDs must be unique.' });
    nodeIds.add(node.id);
  });
  const edgeIds = new Set();
  graph.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['edges', index, 'id'], message: 'Edge IDs must be unique.' });
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['edges', index], message: 'Edge endpoints must reference existing nodes.' });
    }
    edgeIds.add(edge.id);
  });
});

export const graphIdSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid graph ID.'),
});
```

## `server/src/validation/compile.js`

```js
import { z } from 'zod';

/**
 * Body of POST /api/graphs/validate — the raw graph JSON straight from React Flow,
 * checked without being persisted.
 */
export const rawGraphSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  nodes: z.array(z.record(z.unknown())).max(500),
  edges: z.array(z.record(z.unknown())).max(2000),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive() }).optional(),
}).strict();

const testValueSchema = z.object({
  deviceId: z.string().trim().min(1).max(120).optional(),
  sensorType: z.string().trim().min(1).max(120).optional(),
  unit: z.string().trim().max(20).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  value: z.number().finite(),
}).strict();

/**
 * Body of POST /api/graphs/:id/test — sample values pushed through the compiled pipeline.
 * Accepts bare numbers or explicit readings.
 */
export const testGraphSchema = z.object({
  values: z.array(z.union([z.number().finite(), testValueSchema])).min(1).max(1000),
}).strict();
```

## `server/src/middleware/validate.js`

```js
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: {
          message: 'Validation failed.',
          details: result.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
        },
      });
    }
    // Express query/params may be read-only; keep parsed values in res.locals.
    res.locals.validated ??= {};
    res.locals.validated[source] = result.data;
    return next();
  };
}

export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
```

## `server/src/middleware/errorHandler.js`

```js
import { env } from '../config/env.js';

export function notFound(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.path}`);
  error.status = 404;
  next(error);
}

export function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(error);
  const status = error.status ?? error.statusCode ?? 500;
  const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  if (safeStatus >= 500) console.error(error);
  let message = safeStatus >= 500 ? 'An unexpected server error occurred.' : error.message;
  if (error.type === 'entity.parse.failed') message = 'Malformed JSON body.';
  if (error.type === 'entity.too.large') message = 'Request body is too large.';
  const response = { error: { message } };
  // Bulk writes can partially succeed even with ordered:false. Do not imply a retry is safe.
  if (error.insertedDocs?.length) response.error.insertedCount = error.insertedDocs.length;
  if (env.nodeEnv === 'development' && safeStatus >= 500) response.error.detail = error.message;
  return res.status(safeStatus).json(response);
}
```

## `server/src/utils/httpError.js`

```js
/**
 * Create an Error carrying an HTTP status code, recognised by the central error middleware.
 *
 * @param {number} status HTTP status code
 * @param {string} message human-readable message returned to the client
 * @param {object} [extra] additional fields (for example `details`)
 */
export function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}
```

## `server/src/controllers/telemetryController.js`

```js
import { Telemetry } from '../models/Telemetry.js';
import { broadcastTelemetry } from '../services/websocket.js';
import { activeGraphManager } from '../services/activeGraphManager.js';

async function insertAndAccept(readings, res, single = false) {
  // Zod has already validated/cast the complete payload. lean avoids a second
  // Mongoose hydration/validation pass on this high-throughput path.
  const inserted = await Telemetry.insertMany(readings, { ordered: false, lean: true });
  res.status(202).json({ accepted: inserted.length });
  // Fan-out is best-effort and must never delay or fail the HTTP response:
  // (1) push the readings to the browser, (2) feed every active RxJS pipeline.
  setImmediate(() => {
    try { broadcastTelemetry(single ? inserted[0] : inserted); }
    catch (error) { console.error('WebSocket broadcast failed:', error.message); }
    try { activeGraphManager.publish(inserted); }
    catch (error) { console.error('Failed to publish readings to active graphs:', error.message); }
  });
}

export async function ingestReading(req, res) {
  await insertAndAccept([res.locals.validated.body], res, true);
}

export async function ingestBatch(req, res) {
  await insertAndAccept(res.locals.validated.body, res);
}

export async function getReadings(req, res) {
  const { deviceId, from, to, limit } = res.locals.validated.query;
  const filter = {};
  if (deviceId) filter['metadata.deviceId'] = deviceId;
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = from;
    if (to) filter.timestamp.$lte = to;
  }
  const data = await Telemetry.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
  res.json({ data });
}
```

## `server/src/controllers/graphController.js`

```js
import { Graph } from '../models/Graph.js';
import { compileGraph, validateGraph, GraphValidationError } from '../compiler/index.js';
import { activeGraphManager } from '../services/activeGraphManager.js';
import { httpError } from '../utils/httpError.js';

export async function createGraph(req, res) {
  const graph = await Graph.create(res.locals.validated.body);
  res.status(201).json({ data: graph });
}

export async function listGraphs(req, res) {
  // Keep the picker response small; GET by ID returns the complete graph.
  const graphs = await Graph.find().select('name createdAt updatedAt').sort({ updatedAt: -1 }).limit(100).lean();
  res.json({ data: graphs });
}

export async function getGraph(req, res) {
  const graph = await Graph.findById(res.locals.validated.params.id).lean();
  if (!graph) return res.status(404).json({ error: { message: 'Graph not found.' } });
  return res.json({ data: graph });
}

export async function updateGraph(req, res) {
  const graph = await Graph.findByIdAndUpdate(res.locals.validated.params.id, res.locals.validated.body, {
    new: true,
    runValidators: true,
  }).lean();
  if (!graph) return res.status(404).json({ error: { message: 'Graph not found.' } });
  return res.json({ data: graph });
}

export async function deleteGraph(req, res) {
  const graph = await Graph.findByIdAndDelete(res.locals.validated.params.id).lean();
  if (!graph) return res.status(404).json({ error: { message: 'Graph not found.' } });
  return res.status(204).end();
}

/**
 * POST /api/graphs/validate — validate raw graph JSON without saving it.
 * Returns 200 with `{ valid, errors, warnings }` (a 400 is reserved for malformed bodies).
 */
export async function validateGraphJson(req, res) {
  const result = validateGraph(res.locals.validated.body);
  res.json({
    valid: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    summary: { nodeCount: result.nodes.length, edgeCount: result.edges.length },
  });
}

/**
 * POST /api/graphs/:id/compile — validate + compile a saved graph and activate it.
 */
export async function compileGraphHandler(req, res) {
  const { id } = res.locals.validated.params;
  try {
    const entry = await activeGraphManager.activate(id);
    res.status(200).json({
      data: {
        graphId: entry.graphId,
        name: entry.name,
        nodeCount: entry.nodeCount,
        edgeCount: entry.edgeCount,
        sources: entry.sources,
        warnings: entry.warnings,
        subscriptions: entry.compiled.subscriptions.length,
        activatedAt: entry.activatedAt,
      },
    });
  } catch (error) {
    if (error instanceof GraphValidationError) {
      return res.status(400).json({ error: { message: 'Graph is not valid.', details: error.errors, warnings: error.warnings } });
    }
    throw error;
  }
}

/** POST /api/graphs/:id/deactivate — dispose the pipeline and forget it. */
export async function deactivateGraphHandler(req, res) {
  const { id } = res.locals.validated.params;
  const deactivated = activeGraphManager.deactivate(id);
  if (!deactivated) throw httpError(404, 'No active pipeline found for this graph.');
  return res.json({ data: { graphId: id, active: false } });
}

/** GET /api/graphs/active — summaries of every running pipeline. */
export async function listActiveGraphs(req, res) {
  res.json({ data: activeGraphManager.list() });
}

/**
 * POST /api/graphs/:id/test — dry run: push sample values through the compiled pipeline
 * and return the alerts that fired. Nothing is sent and nothing is persisted.
 */
export async function testGraphHandler(req, res) {
  const { id } = res.locals.validated.params;
  const { values } = res.locals.validated.body;

  const graph = await Graph.findById(id).lean();
  if (!graph) throw httpError(404, 'Graph not found.');

  let compiled;
  try {
    compiled = compileGraph({ nodes: graph.nodes ?? [], edges: graph.edges ?? [] }, { graphId: String(graph._id), dryRun: true });
  } catch (error) {
    if (error instanceof GraphValidationError) {
      return res.status(400).json({ error: { message: 'Graph is not valid.', details: error.errors, warnings: error.warnings } });
    }
    throw error;
  }

  try {
    const delivered = compiled.pushValues(values);
    // Handlers are async; let the microtask queue drain before reading the results.
    await new Promise((resolve) => setImmediate(resolve));
    const alerts = compiled.getAlerts();
    res.json({
      data: {
        graphId: String(graph._id),
        dryRun: true,
        values: values.length,
        delivered,
        alertCount: alerts.length,
        alerts,
      },
    });
  } finally {
    compiled.dispose();
  }
}
```

## `server/src/routes/telemetryRoutes.js`

```js
import { Router } from 'express';
import { getReadings, ingestBatch, ingestReading } from '../controllers/telemetryController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { batchSchema, readingSchema, telemetryQuerySchema } from '../validation/telemetry.js';

const router = Router();
router.post('/', validate(readingSchema), asyncHandler(ingestReading));
router.post('/batch', validate(batchSchema), asyncHandler(ingestBatch));
router.get('/', validate(telemetryQuerySchema, 'query'), asyncHandler(getReadings));
export default router;
```

## `server/src/routes/graphRoutes.js`

```js
import { Router } from 'express';
import {
  compileGraphHandler,
  createGraph,
  deactivateGraphHandler,
  deleteGraph,
  getGraph,
  listActiveGraphs,
  listGraphs,
  testGraphHandler,
  updateGraph,
  validateGraphJson,
} from '../controllers/graphController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { graphIdSchema, graphSchema } from '../validation/graph.js';
import { rawGraphSchema, testGraphSchema } from '../validation/compile.js';

const router = Router();

// Static paths must be declared BEFORE "/:id" so they are not captured by the param route.
router.route('/active').get(asyncHandler(listActiveGraphs));
router.route('/validate').post(validate(rawGraphSchema), asyncHandler(validateGraphJson));

router.route('/')
  .post(validate(graphSchema), asyncHandler(createGraph))
  .get(asyncHandler(listGraphs));

// All "/:id" routes share the ObjectId param check.
const byId = router.route('/:id').all(validate(graphIdSchema, 'params'));
byId.get(asyncHandler(getGraph))
  .put(validate(graphSchema), asyncHandler(updateGraph))
  .delete(asyncHandler(deleteGraph));

router.route('/:id/compile').all(validate(graphIdSchema, 'params')).post(asyncHandler(compileGraphHandler));
router.route('/:id/deactivate').all(validate(graphIdSchema, 'params')).post(asyncHandler(deactivateGraphHandler));
router.route('/:id/test')
  .all(validate(graphIdSchema, 'params'))
  .post(validate(testGraphSchema), asyncHandler(testGraphHandler));

export default router;
```

## `server/src/services/websocket.js`

```js
import { WebSocket, WebSocketServer } from 'ws';

let socketServer;
const maxBufferedBytes = 1024 * 1024;

export function attachWebSocketServer(httpServer) {
  socketServer = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });
  socketServer.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', (error) => console.error('WebSocket error:', error.message));
    socket.send(JSON.stringify({ type: 'connected', data: { message: 'Connected to NexusFlow' } }));
  });
  socketServer.on('error', (error) => console.error('WebSocket server error:', error.message));

  // Remove broken connections; unref prevents this timer from keeping Node alive.
  const heartbeat = setInterval(() => {
    for (const socket of socketServer.clients) {
      if (!socket.isAlive) socket.terminate();
      else { socket.isAlive = false; socket.ping(); }
    }
  }, 30_000);
  heartbeat.unref();
  socketServer.on('close', () => clearInterval(heartbeat));
  return socketServer;
}

/**
 * Best-effort fan-out. A slow or dead client must never block ingestion or make the
 * server buffer unbounded data, so anything over `maxBufferedBytes` is skipped.
 *
 * @param {string} type message type, for example "telemetry" or "alert"
 * @param {unknown} data payload
 */
function broadcast(type, data) {
  if (!socketServer || socketServer.clients.size === 0) return;
  const message = JSON.stringify({ type, data });
  for (const socket of socketServer.clients) {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > maxBufferedBytes) continue;
    socket.send(message, (error) => {
      if (error) console.error('WebSocket broadcast failed:', error.message);
    });
  }
}

/** Push freshly ingested telemetry to every connected client. */
export function broadcastTelemetry(data) {
  broadcast('telemetry', data);
}

/** Push an alert raised by a compiled pipeline to every connected client. */
export function broadcastAlert(data) {
  broadcast('alert', data);
}
```

## `server/src/services/activeGraphManager.js`

```js
import { Graph } from '../models/Graph.js';
import { compileGraph } from '../compiler/index.js';
import { httpError } from '../utils/httpError.js';
import { broadcastAlert } from './websocket.js';

/**
 * Holds the compiled pipelines that are currently running, keyed by graph id.
 *
 * Compiling is cheap but not free: a graph is compiled once on activation and then fed
 * by the ingestion path. Re-compiling or deactivating always disposes the previous
 * pipeline so no subscription or Subject is left behind.
 */
class ActiveGraphManager {
  /** @type {Map<string, { graphId: string, name: string, compiled: object, activatedAt: Date, sources: object[] }>} */
  #pipelines = new Map();

  /**
   * Load a saved graph, validate + compile it and make it the active pipeline.
   *
   * @param {string} graphId
   * @returns {Promise<object>} activation summary
   */
  async activate(graphId) {
    const graph = await Graph.findById(graphId).lean();
    if (!graph) throw httpError(404, 'Graph not found.');

    const id = String(graph._id);
    const compiled = compileGraph(
      { nodes: graph.nodes ?? [], edges: graph.edges ?? [] },
      {
        graphId: id,
        onAlert: (alert) => broadcastAlert({ graphId: id, ...alert }),
      },
    );

    // Replace any previously compiled version of this graph.
    this.deactivate(id);
    const entry = {
      graphId: id,
      name: graph.name,
      compiled,
      sources: compiled.sources,
      nodeCount: compiled.nodeCount,
      edgeCount: compiled.edgeCount,
      warnings: compiled.warnings,
      activatedAt: new Date(),
    };
    this.#pipelines.set(id, entry);
    return entry;
  }

  /**
   * Dispose a running pipeline.
   * @param {string} graphId
   * @returns {boolean} true when something was deactivated
   */
  deactivate(graphId) {
    const entry = this.#pipelines.get(graphId);
    if (!entry) return false;
    try {
      entry.compiled.dispose();
    } catch (error) {
      console.error(`Failed to dispose pipeline ${graphId}: ${error.message}`);
    }
    this.#pipelines.delete(graphId);
    return true;
  }

  /** @returns {object[]} summaries of every active pipeline */
  list() {
    return [...this.#pipelines.values()].map((entry) => this.#summarise(entry));
  }

  /** @param {string} graphId */
  get(graphId) {
    const entry = this.#pipelines.get(graphId);
    return entry ? this.#summarise(entry) : null;
  }

  /**
   * Feed freshly ingested readings into every active pipeline.
   * Never throws: a broken pipeline must not fail ingestion.
   *
   * @param {object[]} readings persisted telemetry documents
   * @returns {number} how many (pipeline, reading) deliveries happened
   */
  publish(readings) {
    if (this.#pipelines.size === 0 || !Array.isArray(readings) || readings.length === 0) return 0;
    let delivered = 0;
    for (const entry of this.#pipelines.values()) {
      for (const reading of readings) {
        try {
          delivered += entry.compiled.publish(reading);
        } catch (error) {
          console.error(`Pipeline ${entry.graphId} failed to process a reading: ${error.message}`);
        }
      }
    }
    return delivered;
  }

  /** Dispose everything — used on shutdown and by tests. */
  disposeAll() {
    for (const graphId of [...this.#pipelines.keys()]) this.deactivate(graphId);
  }

  #summarise(entry) {
    return {
      graphId: entry.graphId,
      name: entry.name,
      nodeCount: entry.nodeCount,
      edgeCount: entry.edgeCount,
      sources: entry.sources,
      warnings: entry.warnings,
      activatedAt: entry.activatedAt,
      subscriptions: entry.compiled.subscriptions.length,
    };
  }
}

export const activeGraphManager = new ActiveGraphManager();
```

## `server/src/services/alertService.js`

```js
import { Alert } from '../models/Alert.js';

/**
 * Persist an alert raised by an action node.
 *
 * Never throws: persistence must not break the RxJS pipeline, it only means the alert
 * is not recorded.
 *
 * @param {{ graphId?: string, nodeId: string, type: string, deviceId?: string,
 *           sensorType?: string, value?: number, message: string, triggeredAt?: Date }} alert
 * @returns {Promise<object | null>} the saved document, or null when it could not be stored
 */
export async function recordAlert(alert) {
  try {
    const saved = await Alert.create({
      graphId: alert.graphId || undefined,
      nodeId: alert.nodeId,
      type: alert.type,
      deviceId: alert.deviceId ?? 'unknown',
      sensorType: alert.sensorType,
      value: alert.value,
      message: alert.message,
      triggeredAt: alert.triggeredAt ?? new Date(),
    });
    return saved.toObject();
  } catch (error) {
    console.error(`Failed to persist alert for node ${alert.nodeId}: ${error.message}`);
    return null;
  }
}

/**
 * @param {string} graphId
 * @param {number} [limit]
 */
export async function listAlerts(graphId, limit = 50) {
  return Alert.find({ graphId }).sort({ triggeredAt: -1 }).limit(Math.min(limit, 500)).lean();
}
```

## `server/src/compiler/index.js`

```js
/**
 * Public entry point of the stream compiler.
 *
 * Importing this module registers every node type (operators, actions and sources)
 * and exposes the validator, the registry and the compiler.
 */
import './operators/index.js';
import './actions/index.js';
import './sources/index.js';

export { validateGraph } from './graphValidator.js';
export { compileGraph, describeNodes, toEvent, GraphValidationError } from './streamCompiler.js';
export { nodeRegistry, registerNode, getNode, hasNode, listNodes, nodeTypes, resolveConfig } from './nodeRegistry.js';
```

## `server/src/compiler/graphValidator.js`

```js
import { nodeRegistry } from './nodeRegistry.js';

/**
 * Shape of the graph JSON produced by the React Flow editor:
 *
 * {
 *   name: 'Turbine overheat rule',
 *   nodes: [ { id, type, position, data: { label?, config: { ... } } } ],
 *   edges: [ { id, source, target } ]
 * }
 */

/** @typedef {{ code: string, message: string, nodeId?: string, edgeId?: string }} GraphIssue */

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const problem = (code, message, extra = {}) => ({ code, message, ...extra });

/**
 * Detect a cycle with an iterative depth-first search. Returns the ids that form
 * the cycle (including the repeated node at the end) or `null` when the graph is acyclic.
 *
 * @param {Map<string, string[]>} adjacency node id -> outgoing neighbour ids
 * @returns {string[] | null}
 */
function findCycle(adjacency) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map([...adjacency.keys()].map((id) => [id, WHITE]));

  for (const root of adjacency.keys()) {
    if (color.get(root) !== WHITE) continue;
    // Each stack entry is [nodeId, iterator over its neighbours].
    const stack = [[root, adjacency.get(root)[Symbol.iterator]()]];
    const path = [root];
    color.set(root, GRAY);

    while (stack.length) {
      const [node, iterator] = stack[stack.length - 1];
      const next = iterator.next();
      if (next.done) {
        color.set(node, BLACK);
        stack.pop();
        path.pop();
        continue;
      }
      const neighbour = next.value;
      const state = color.get(neighbour);
      if (state === GRAY) {
        // Found a back edge: slice the current path from the first occurrence.
        return [...path.slice(path.indexOf(neighbour)), neighbour];
      }
      if (state === WHITE) {
        color.set(neighbour, GRAY);
        stack.push([neighbour, adjacency.get(neighbour)[Symbol.iterator]()]);
        path.push(neighbour);
      }
    }
  }
  return null;
}

/**
 * Validate a raw graph JSON document.
 *
 * Errors make the graph uncompilable; warnings are surfaced to the client but do not
 * block compilation (for example a node that is not wired to anything).
 *
 * @param {unknown} graph raw graph JSON
 * @returns {{ ok: boolean, errors: GraphIssue[], warnings: GraphIssue[], nodes: any[], edges: any[] }}
 */
export function validateGraph(graph) {
  /** @type {GraphIssue[]} */
  const errors = [];
  /** @type {GraphIssue[]} */
  const warnings = [];

  if (!isPlainObject(graph)) {
    return { ok: false, errors: [problem('invalid_graph', 'Graph must be a JSON object.')], warnings, nodes: [], edges: [] };
  }
  const rawNodes = graph.nodes;
  const rawEdges = graph.edges ?? [];

  if (!Array.isArray(rawNodes)) {
    return { ok: false, errors: [problem('invalid_nodes', 'Graph.nodes must be an array.')], warnings, nodes: [], edges: [] };
  }
  if (rawNodes.length === 0) {
    return { ok: false, errors: [problem('empty_graph', 'Graph must contain at least one node.')], warnings, nodes: [], edges: [] };
  }
  if (rawNodes.length > 500) {
    errors.push(problem('too_many_nodes', `Graph has ${rawNodes.length} nodes; the maximum is 500.`));
  }
  if (!Array.isArray(rawEdges)) {
    return { ok: false, errors: [problem('invalid_edges', 'Graph.edges must be an array.')], warnings, nodes: rawNodes, edges: [] };
  }

  // ---------------------------------------------------------------- nodes
  /** @type {Map<string, any>} */
  const nodesById = new Map();
  rawNodes.forEach((node, index) => {
    if (!isPlainObject(node)) {
      errors.push(problem('invalid_node', `Node at index ${index} must be an object.`));
      return;
    }
    const id = typeof node.id === 'string' ? node.id.trim() : '';
    if (!id) {
      errors.push(problem('invalid_node', `Node at index ${index} is missing an id.`));
      return;
    }
    if (nodesById.has(id)) {
      errors.push(problem('duplicate_node', `Duplicate node id "${id}".`, { nodeId: id }));
      return;
    }
    const type = typeof node.type === 'string' ? node.type : '';
    if (!type) {
      errors.push(problem('missing_type', `Node "${id}" is missing a type.`, { nodeId: id }));
      return;
    }
    const definition = nodeRegistry.get(type);
    if (!definition) {
      errors.push(problem('unknown_type', `Node "${id}" has unknown type "${type}". Known types: ${nodeRegistry.types().join(', ')}.`, { nodeId: id }));
      return;
    }
    if (node.data !== undefined && !isPlainObject(node.data)) {
      errors.push(problem('invalid_data', `Node "${id}" has a non-object "data" field.`, { nodeId: id }));
      return;
    }
    const config = node.data?.config ?? {};
    if (!isPlainObject(config)) {
      errors.push(problem('invalid_config', `Node "${id}" has a non-object "config" field.`, { nodeId: id }));
      return;
    }
    // Each node type owns its own config rules (Open/Closed: new nodes bring their own).
    for (const message of definition.validate(config)) {
      errors.push(problem('invalid_config', `Node "${id}" (${type}): ${message}`, { nodeId: id }));
    }
    nodesById.set(id, { ...node, id, type, definition, config });
  });

  // ---------------------------------------------------------------- edges
  /** @type {Map<string, any>} */
  const edgesById = new Map();
  /** @type {Map<string, string[]>} */
  const adjacency = new Map([...nodesById.keys()].map((id) => [id, []]));
  /** @type {Map<string, number>} */
  const inDegree = new Map([...nodesById.keys()].map((id) => [id, 0]));
  /** @type {Set<string>} */
  const seenPairs = new Set();

  rawEdges.forEach((edge, index) => {
    if (!isPlainObject(edge)) {
      errors.push(problem('invalid_edge', `Edge at index ${index} must be an object.`));
      return;
    }
    const id = typeof edge.id === 'string' ? edge.id.trim() : '';
    const source = typeof edge.source === 'string' ? edge.source : '';
    const target = typeof edge.target === 'string' ? edge.target : '';
    if (!id || !source || !target) {
      errors.push(problem('invalid_edge', `Edge at index ${index} requires id, source and target.`));
      return;
    }
    if (edgesById.has(id)) {
      errors.push(problem('duplicate_edge', `Duplicate edge id "${id}".`, { edgeId: id }));
      return;
    }
    if (!nodesById.has(source)) {
      errors.push(problem('missing_source', `Edge "${id}" references unknown source node "${source}".`, { edgeId: id }));
      return;
    }
    if (!nodesById.has(target)) {
      errors.push(problem('missing_target', `Edge "${id}" references unknown target node "${target}".`, { edgeId: id }));
      return;
    }
    if (source === target) {
      errors.push(problem('self_connection', `Edge "${id}" connects node "${source}" to itself.`, { edgeId: id }));
      return;
    }
    const pair = `${source}->${target}`;
    if (seenPairs.has(pair)) {
      errors.push(problem('duplicate_connection', `Nodes "${source}" and "${target}" are already connected.`, { edgeId: id }));
      return;
    }
    seenPairs.add(pair);

    const from = nodesById.get(source);
    const to = nodesById.get(target);
    if (to.definition.category === 'source') {
      errors.push(problem('source_has_input', `"${from.definition.label}" cannot connect into source node "${target}": sources only emit data.`, { edgeId: id }));
      return;
    }
    if (from.definition.category === 'action') {
      errors.push(problem('action_has_output', `Action node "${source}" cannot feed another node: actions are terminal.`, { edgeId: id }));
      return;
    }
    edgesById.set(id, { id, source, target });
    adjacency.get(source).push(target);
    inDegree.set(target, inDegree.get(target) + 1);
  });

  // ------------------------------------------------------- cardinality rules
  for (const node of nodesById.values()) {
    const incoming = inDegree.get(node.id);
    const outgoing = adjacency.get(node.id).length;
    if (node.definition.category !== 'source' && incoming > 1) {
      errors.push(problem('too_many_inputs', `Node "${node.id}" has ${incoming} inputs; only a single input per node is supported.`, { nodeId: node.id }));
    }
    if (node.definition.category !== 'source' && incoming === 0) {
      warnings.push(problem('disconnected_node', `Node "${node.id}" (${node.definition.label}) has no input and will never receive data.`, { nodeId: node.id }));
    }
    if (node.definition.category !== 'action' && outgoing === 0) {
      warnings.push(problem('dangling_output', `Node "${node.id}" (${node.definition.label}) output is not connected to anything.`, { nodeId: node.id }));
    }
  }

  // --------------------------------------------------------------- cycles
  const cycle = findCycle(adjacency);
  if (cycle) {
    errors.push(problem('cycle', `Graph contains a cycle: ${cycle.join(' -> ')}.`));
  }

  // ------------------------------------------------- sources / sinks summary
  const sourceNodes = [...nodesById.values()].filter((node) => node.definition.category === 'source');
  const actionNodes = [...nodesById.values()].filter((node) => node.definition.category === 'action');
  if (sourceNodes.length === 0) {
    errors.push(problem('no_source', 'Graph needs at least one data source node.'));
  }
  if (actionNodes.length === 0) {
    warnings.push(problem('no_action', 'Graph has no action node, so it will never trigger an alert.'));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    nodes: [...nodesById.values()],
    edges: [...edgesById.values()],
  };
}
```

## `server/src/compiler/nodeRegistry.js`

```js
/**
 * Node registry — the extension point of the stream compiler.
 *
 * Every node type registers itself with:
 *   {
 *     type: 'movingAverage',
 *     category: 'source' | 'math' | 'action',
 *     label: 'Moving Average',
 *     defaults: { windowSize: 5 },
 *     validate(config): string[]                      // human-readable config errors
 *     createOperator(config, context): (source$) => Observable   // math nodes only
 *     createAction(config, context): (event) => result | Promise<result>  // action nodes only
 *     subjectKey(config): string                      // source nodes only
 *   }
 *
 * `streamCompiler` contains no node-specific logic: it only walks the registry, so new
 * node types are added by dropping a file into operators/ or actions/ and importing it.
 */

/** @type {Map<string, any>} */
const registry = new Map();

/**
 * Register a node type.
 * @param {any} definition node definition (see file header)
 */
export function registerNode(definition) {
  if (!definition?.type) throw new Error('registerNode requires a "type".');
  if (!['source', 'math', 'action'].includes(definition.category)) {
    throw new Error(`registerNode: "${definition.type}" needs a category of source, math or action.`);
  }
  if (definition.category === 'math' && typeof definition.createOperator !== 'function') {
    throw new Error(`registerNode: math node "${definition.type}" must implement createOperator().`);
  }
  if (definition.category === 'action' && typeof definition.createAction !== 'function') {
    throw new Error(`registerNode: action node "${definition.type}" must implement createAction().`);
  }
  registry.set(definition.type, {
    validate: () => [],
    defaults: {},
    ...definition,
  });
}

/** @param {string} type */
export function getNode(type) {
  return registry.get(type);
}

/** @param {string} type */
export const hasNode = (type) => registry.has(type);

/** All registered node definitions, sorted by category then label. */
export function listNodes() {
  return [...registry.values()];
}

/** All registered node type ids (used in error messages and by the client). */
export const nodeTypes = () => [...registry.keys()];

/** Merge a node's defaults with the config coming from the client. */
export function resolveConfig(type, config = {}) {
  return { ...(registry.get(type)?.defaults ?? {}), ...config };
}

export const nodeRegistry = { register: registerNode, get: getNode, has: hasNode, list: listNodes, types: nodeTypes };
```

## `server/src/compiler/streamCompiler.js`

```js
import { EMPTY, Subject, catchError, concatMap, of, share } from 'rxjs';
import { getNode, listNodes, resolveConfig } from './nodeRegistry.js';
import { validateGraph } from './graphValidator.js';
// Importing the node modules is what populates the registry.
import './operators/index.js';
import './actions/index.js';
import './sources/index.js';

/**
 * Thrown when a graph cannot be compiled. Carries the validator issues so the API can
 * return them verbatim.
 */
export class GraphValidationError extends Error {
  constructor(errors, warnings = []) {
    super(`Graph is not valid: ${errors.map((issue) => issue.message).join(' ')}`);
    this.name = 'GraphValidationError';
    this.status = 400;
    this.errors = errors;
    this.warnings = warnings;
  }
}

/**
 * Normalise a persisted telemetry reading into the event shape that flows through a
 * pipeline: `{ deviceId, sensorType, unit, timestamp, value }`.
 */
export function toEvent(reading = {}) {
  return {
    deviceId: reading.metadata?.deviceId ?? 'unknown',
    sensorType: reading.metadata?.sensorType,
    unit: reading.unit,
    timestamp: reading.timestamp ? new Date(reading.timestamp) : new Date(),
    value: Number(reading.value),
  };
}

/**
 * Compile a validated graph into a live RxJS pipeline.
 *
 * Strategy
 *   1. every **source** node gets a `Subject` (the entry point for telemetry),
 *   2. every **math** node wraps its parent's stream with the operator from the registry,
 *   3. streams with more than one child are `share()`d so branching never duplicates work,
 *   4. every **action** node is subscribed at a leaf and its handler runs per event,
 *   5. `dispose()` unsubscribes everything so graphs can be swapped at runtime.
 *
 * @param {object} graph raw React Flow JSON `{ nodes, edges }`
 * @param {{ graphId?: string | null, dryRun?: boolean, onAlert?: (result: object) => void }} [options]
 *   `dryRun` compiles the pipeline but never sends an SMS, calls a webhook or writes to the
 *   database; fired alerts are collected and returned by `getAlerts()`.
 * @returns {object} compiled pipeline handle
 */
export function compileGraph(graph, options = {}) {
  const { graphId = null, dryRun = false, onAlert = null } = options;

  const validation = validateGraph(graph);
  if (!validation.ok) throw new GraphValidationError(validation.errors, validation.warnings);

  const nodes = validation.nodes;
  const edges = validation.edges;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  /** @type {Map<string, string[]>} outgoing neighbours */
  const children = new Map(nodes.map((node) => [node.id, []]));
  /** @type {Map<string, string[]>} incoming neighbours (at most one per node) */
  const parents = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    children.get(edge.source).push(edge.target);
    parents.get(edge.target).push(edge.source);
  }

  /** @type {Map<string, Subject<object>>} nodeId -> Subject (source nodes only) */
  const subjects = new Map();
  /** @type {Map<string, import('rxjs').Observable<object>>} memoised streams (nodeId -> Observable) */
  const streams = new Map();
  /** @type {import('rxjs').Subscription[]} */
  const subscriptions = [];
  /** @type {object[]} alerts collected in dry-run mode */
  const alerts = [];
  let disposed = false;

  const sourceNodes = nodes.filter((node) => node.definition.category === 'source');
  const actionNodes = nodes.filter((node) => node.definition.category === 'action');
  for (const node of sourceNodes) subjects.set(node.id, new Subject());

  /** Guard against a malformed graph reaching unbounded recursion (defensive; validator rejects cycles). */
  function buildStream(nodeId, path = []) {
    if (streams.has(nodeId)) return streams.get(nodeId);
    if (path.includes(nodeId)) throw new Error(`Node "${nodeId}" is part of a cycle (${[...path, nodeId].join(' -> ')}).`);

    const node = nodesById.get(nodeId);
    if (!node) throw new Error(`Node "${nodeId}" not found in graph (edge points at a missing node).`);
    const config = resolveConfig(node.type, node.config);
    let stream$;

    if (node.definition.category === 'source') {
      stream$ = subjects.get(nodeId);
    } else {
      const [parentId] = parents.get(nodeId);
      if (!parentId) {
        // A math node may legally have no input (the validator flags this as a warning:
        // it can never receive data). Compile it as a dead branch — an EMPTY stream —
        // instead of dereferencing an undefined parent and crashing the whole pipeline.
        stream$ = EMPTY;
      } else {
        const input$ = buildStream(parentId, [...path, nodeId]);
        const operator = node.definition.createOperator(config, { graphId, nodeId, dryRun });
        // A failing operator must not tear down sibling branches: catch here and log.
        stream$ = input$.pipe(
          operator,
          catchError((error) => {
            console.error(`[compiler] node "${nodeId}" (${node.type}) failed: ${error.message}`);
            return EMPTY;
          }),
        );
      }
    }

    // Fan-out: share one upstream subscription between all children.
    if (children.get(nodeId).length > 1) stream$ = stream$.pipe(share());

    streams.set(nodeId, stream$);
    return stream$;
  }

  // --------------------------------------------------------------- actions
  for (const node of actionNodes) {
    const [parentId] = parents.get(node.id);
    if (!parentId) continue; // Disconnected action: the validator already warns.

    const config = resolveConfig(node.type, node.config);
    const context = { graphId, nodeId: node.id, dryRun, type: node.type };
    const handler = node.definition.createAction(config, context);
    const input$ = buildStream(parentId);

    const actionStream$ = input$.pipe(
      // concatMap keeps events in order even when a handler is asynchronous.
      concatMap((event) => of(event).pipe(
        concatMap((value) => Promise.resolve()
          .then(() => handler(value))
          .catch((error) => ({
            nodeId: node.id,
            type: node.type,
            deviceId: value?.deviceId,
            value: value?.value,
            message: `Action failed: ${error.message}`,
            error: error.message,
            delivered: false,
            triggeredAt: new Date(),
          }))),
        catchError((error) => {
          console.error(`[compiler] action "${node.id}" (${node.type}) failed: ${error.message}`);
          return EMPTY;
        }),
      )),
      catchError((error) => {
        console.error(`[compiler] pipeline for action "${node.id}" stopped: ${error.message}`);
        return EMPTY;
      }),
    );

    subscriptions.push(actionStream$.subscribe({
      next: (result) => {
        if (dryRun) alerts.push(result);
        try {
          onAlert?.(result);
        } catch (error) {
          console.error(`[compiler] alert listener failed: ${error.message}`);
        }
      },
      error: (error) => console.error(`[compiler] action "${node.id}" subscription error: ${error.message}`),
    }));
  }

  /** Build an event for a source node from a raw test value. */
  function buildEvent(raw, config) {
    const base = {
      deviceId: config.deviceId ?? 'test-device',
      sensorType: config.sensorType ?? 'value',
      unit: '',
      timestamp: new Date(),
    };
    if (typeof raw === 'number') return { ...base, value: raw };
    return {
      deviceId: raw?.deviceId ?? base.deviceId,
      sensorType: raw?.sensorType ?? base.sensorType,
      unit: raw?.unit ?? '',
      timestamp: raw?.timestamp ? new Date(raw.timestamp) : base.timestamp,
      value: Number(raw?.value),
    };
  }

  return {
    graphId,
    dryRun,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    warnings: validation.warnings,
    subjects,
    subscriptions,
    sources: sourceNodes.map((node) => {
      const config = resolveConfig(node.type, node.config);
      return {
        nodeId: node.id,
        type: node.type,
        deviceId: config.deviceId ?? '*',
        sensorType: config.sensorType ?? '*',
        key: node.definition.subjectKey?.(config) ?? `${config.deviceId ?? '*'}:${config.sensorType ?? '*'}`,
      };
    }),

    /** Feed one persisted telemetry reading into every matching source node. */
    publish(reading) {
      if (disposed) return 0;
      let delivered = 0;
      for (const node of sourceNodes) {
        const config = resolveConfig(node.type, node.config);
        if (node.definition.matches && !node.definition.matches(reading, config)) continue;
        subjects.get(node.id).next(toEvent(reading));
        delivered += 1;
      }
      return delivered;
    },

    /**
     * Dry-run helper: push sample values (numbers or `{ deviceId, sensorType, value }`)
     * through the pipeline and return how many source nodes consumed them.
     */
    pushValues(values) {
      if (disposed) return 0;
      let delivered = 0;
      for (const raw of values) {
        for (const node of sourceNodes) {
          const config = resolveConfig(node.type, node.config);
          const event = buildEvent(raw, config);
          if (node.definition.matches && !node.definition.matches({ metadata: event }, config)) continue;
          subjects.get(node.id).next(event);
          delivered += 1;
        }
      }
      return delivered;
    },

    /** Alerts collected while running in dry-run mode. */
    getAlerts: () => (dryRun ? [...alerts] : []),

    get disposed() {
      return disposed;
    },

    /** Unsubscribe every action and complete every source Subject. */
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const subscription of subscriptions) subscription.unsubscribe();
      subscriptions.length = 0;
      for (const subject of subjects.values()) subject.complete();
      subjects.clear();
      streams.clear();
    },
  };
}

/**
 * Node metadata for clients/UI (types, labels, defaults, categories), so the React
 * palette can stay in sync with the compiler instead of hard-coding node kinds.
 */
export function describeNodes() {
  return listNodes().map(({ type, category, label, defaults }) => ({ type, category, label, defaults }));
}

export { getNode };
```

## `server/src/compiler/operators/index.js`

```js
/**
 * Importing this module registers every math/transform node in the registry.
 * Add a new file here to make a new operator available to the compiler.
 */
export { movingAverage } from './movingAverage.js';
export { threshold, THRESHOLD_OPERATORS } from './threshold.js';
export { scale } from './scale.js';
```

## `server/src/compiler/operators/movingAverage.js`

```js
import { bufferCount, map } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

/**
 * Sliding-window average.
 *
 * `bufferCount(windowSize, 1)` emits a new buffer on every event (startOffset = 1), so the
 * average updates on each reading once the window is full.
 *
 * @param {number} windowSize number of readings in the window (>= 1)
 * @returns {(source$: import('rxjs').Observable<object>) => import('rxjs').Observable<object>}
 */
export function movingAverage(windowSize = 5) {
  const size = Math.max(1, Math.floor(Number(windowSize) || 1));
  return (source$) => source$.pipe(
    bufferCount(size, 1),
    map((events) => {
      const sum = events.reduce((total, event) => total + Number(event.value), 0);
      const last = events[events.length - 1];
      return {
        ...last,
        value: sum / events.length,
        // Extra context for actions/UI: the raw window that produced this average.
        samples: events.length,
        window: events.map((event) => event.value),
      };
    }),
  );
}

registerNode({
  type: 'movingAverage',
  category: 'math',
  label: 'Moving Average',
  defaults: { windowSize: 5 },
  validate(config) {
    const errors = [];
    const { windowSize } = config;
    if (windowSize !== undefined && (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 1000)) {
      errors.push('windowSize must be an integer between 1 and 1000.');
    }
    return errors;
  },
  createOperator: (config) => movingAverage(config.windowSize),
});
```

## `server/src/compiler/operators/threshold.js`

```js
import { filter } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

/** Supported comparison operators (mirrored by the client dropdown). */
export const THRESHOLD_OPERATORS = ['>', '>=', '<', '<=', '==', '!='];

const comparators = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

/**
 * Pass through only the events that satisfy `value <operator> threshold`.
 *
 * @param {string} operator one of THRESHOLD_OPERATORS
 * @param {number} value threshold
 */
export function threshold(operator = '>', value = 0) {
  const compare = comparators[operator];
  if (!compare) throw new Error(`Unsupported threshold operator "${operator}".`);
  const limit = Number(value);
  return (source$) => source$.pipe(filter((event) => compare(Number(event.value), limit)));
}

registerNode({
  type: 'threshold',
  category: 'math',
  label: 'Threshold',
  defaults: { operator: '>', value: 80 },
  validate(config) {
    const errors = [];
    if (config.operator !== undefined && !THRESHOLD_OPERATORS.includes(config.operator)) {
      errors.push(`operator must be one of ${THRESHOLD_OPERATORS.join(', ')}.`);
    }
    if (config.value !== undefined && typeof config.value !== 'number') {
      errors.push('value must be a number.');
    }
    return errors;
  },
  createOperator: (config) => threshold(config.operator, config.value),
});
```

## `server/src/compiler/operators/scale.js`

```js
import { map } from 'rxjs';
import { registerNode } from '../nodeRegistry.js';

/**
 * Linear transform: `value = value * factor + offset` (unit conversion, calibration...).
 *
 * @param {number} factor
 * @param {number} offset
 */
export function scale(factor = 1, offset = 0) {
  const k = Number(factor);
  const c = Number(offset);
  return (source$) => source$.pipe(map((event) => ({ ...event, value: Number(event.value) * k + c })));
}

registerNode({
  type: 'scale',
  category: 'math',
  label: 'Scale',
  defaults: { factor: 1, offset: 0 },
  validate(config) {
    const errors = [];
    for (const key of ['factor', 'offset']) {
      if (config[key] !== undefined && typeof config[key] !== 'number') errors.push(`${key} must be a number.`);
    }
    return errors;
  },
  createOperator: (config) => scale(config.factor, config.offset),
});
```

## `server/src/compiler/actions/index.js`

```js
/**
 * Importing this module registers every action node in the registry.
 */
export { createSmsAction } from './smsAlert.js';
export { createWebhookAction } from './webhook.js';
export { createLogAction } from './log.js';
export { renderTemplate } from './template.js';
```

## `server/src/compiler/actions/template.js`

```js
/**
 * Render an action message template.
 *
 * Supported placeholders: ${value}, ${deviceId}, ${sensorType}, ${unit}, ${timestamp}, ${date}
 * Unknown placeholders are left untouched so no information is silently lost.
 *
 * @param {string} template
 * @param {{ value?: number, deviceId?: string, sensorType?: string, unit?: string, timestamp?: Date | string }} event
 * @returns {string}
 */
export function renderTemplate(template, event = {}) {
  if (typeof template !== 'string' || template.trim() === '') return defaultMessage(event);
  const when = event.timestamp ? new Date(event.timestamp) : new Date();
  const values = {
    value: formatNumber(event.value),
    deviceId: event.deviceId ?? 'unknown-device',
    sensorType: event.sensorType ?? 'unknown-sensor',
    unit: event.unit ?? '',
    timestamp: when.toISOString(),
    date: when.toISOString().slice(0, 10),
  };
  return template.replace(/\$\{\s*(\w+)\s*\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

export function defaultMessage(event = {}) {
  const unit = event.unit ? ` ${event.unit}` : '';
  return `Alert: ${event.deviceId ?? 'unknown-device'} ${event.sensorType ?? ''} = ${formatNumber(event.value)}${unit}`.trim();
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
```

## `server/src/compiler/actions/smsAlert.js`

```js
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { renderTemplate } from './template.js';

const DEFAULT_TEMPLATE = 'ALERT ${deviceId} ${sensorType} = ${value}${unit}';

/**
 * Mock SMS gateway: logs the message and stores it in the `alerts` collection.
 * Swapping this for Twilio/MSG91 later only requires replacing this handler.
 */
export function createSmsAction(config, context) {
  const phone = String(config.phone ?? '').trim() || '+10000000000';
  const template = config.messageTemplate || DEFAULT_TEMPLATE;

  return async (event) => {
    const message = renderTemplate(template, event);
    const result = {
      nodeId: context.nodeId,
      type: 'smsAlert',
      deviceId: event?.deviceId ?? 'unknown',
      sensorType: event?.sensorType,
      value: event?.value,
      message,
      to: phone,
      triggeredAt: new Date(),
      delivered: false,
      dryRun: Boolean(context.dryRun),
    };

    // Dry runs never contact the provider and never touch the database.
    if (context.dryRun) return result;

    console.info(`[sms -> ${phone}] ${message}`);
    const saved = await recordAlert({
      graphId: context.graphId,
      nodeId: context.nodeId,
      type: 'smsAlert',
      deviceId: result.deviceId,
      sensorType: result.sensorType,
      value: result.value,
      message,
      triggeredAt: result.triggeredAt,
    });
    result.alertId = saved?._id?.toString();
    result.delivered = Boolean(saved);
    return result;
  };
}

registerNode({
  type: 'smsAlert',
  category: 'action',
  label: 'SMS Alert',
  defaults: { phone: '+10000000000', messageTemplate: DEFAULT_TEMPLATE },
  validate(config) {
    const errors = [];
    if (config.phone !== undefined) {
      const phone = String(config.phone).trim();
      if (phone === '' || !/^\+?[0-9 ()-]{6,20}$/.test(phone)) errors.push('phone must be 6-20 digits (optional leading +).');
    }
    if (config.messageTemplate !== undefined && String(config.messageTemplate).length > 240) {
      errors.push('messageTemplate must be 240 characters or fewer.');
    }
    return errors;
  },
  createAction: createSmsAction,
});
```

## `server/src/compiler/actions/webhook.js`

```js
import axios from 'axios';
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { renderTemplate } from './template.js';

const METHODS = ['POST', 'PUT', 'PATCH'];
const TIMEOUT_MS = 3000;

/**
 * Outgoing HTTP call. Timeouts and failures are captured in the result instead of
 * being thrown, so a dead endpoint can never break the pipeline.
 */
export function createWebhookAction(config, context) {
  const rawUrl = String(config.url ?? '').trim();
  const method = METHODS.includes(String(config.method).toUpperCase()) ? String(config.method).toUpperCase() : 'POST';
  let url = null;
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    url = parsed.toString();
  } catch {
    url = null;
  }

  return async (event) => {
    const payload = {
      deviceId: event?.deviceId,
      sensorType: event?.sensorType,
      value: event?.value,
      unit: event?.unit,
      timestamp: event?.timestamp ?? new Date().toISOString(),
      graphId: context.graphId ?? null,
      nodeId: context.nodeId ?? null,
    };
    const result = {
      nodeId: context.nodeId,
      type: 'webhook',
      deviceId: payload.deviceId ?? 'unknown',
      sensorType: payload.sensorType,
      value: payload.value,
      message: `${method} ${url ?? rawUrl}`,
      url: url ?? rawUrl,
      method,
      triggeredAt: new Date(),
      delivered: false,
      dryRun: Boolean(context.dryRun),
    };

    if (context.dryRun) return result;
    if (!url) {
      result.error = 'Invalid webhook URL.';
      console.error(`[webhook] invalid url "${rawUrl}"`);
      return result;
    }

    try {
      const response = await axios.request({ url, method, data: payload, timeout: TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } });
      result.status = response.status;
      result.delivered = true;
    } catch (error) {
      result.error = error.code === 'ECONNABORTED' ? `Request timed out after ${TIMEOUT_MS} ms.` : error.message;
      console.error(`[webhook ${method} ${url}] failed: ${result.error}`);
    }

    await recordAlert({
      graphId: context.graphId,
      nodeId: context.nodeId,
      type: 'webhook',
      deviceId: result.deviceId,
      sensorType: result.sensorType,
      value: result.value,
      message: result.delivered ? `${method} ${url} -> ${result.status}` : `${method} ${url} failed: ${result.error}`,
      triggeredAt: result.triggeredAt,
    });
    return result;
  };
}

registerNode({
  type: 'webhook',
  category: 'action',
  label: 'Webhook',
  defaults: { url: 'https://example.com/hook', method: 'POST' },
  validate(config) {
    const errors = [];
    if (config.url !== undefined) {
      try {
        const parsed = new URL(String(config.url));
        if (!['http:', 'https:'].includes(parsed.protocol)) errors.push('url must use http or https.');
      } catch {
        errors.push('url must be an absolute http(s) URL.');
      }
    }
    if (config.method !== undefined && !METHODS.includes(String(config.method).toUpperCase())) {
      errors.push(`method must be one of ${METHODS.join(', ')}.`);
    }
    return errors;
  },
  createAction: createWebhookAction,
});
```

## `server/src/compiler/actions/log.js`

```js
import { registerNode } from '../nodeRegistry.js';
import { recordAlert } from '../../services/alertService.js';
import { renderTemplate } from './template.js';

/**
 * Console action — the cheapest way to see a pipeline working during development
 * and the action used by the unit tests.
 */
export function createLogAction(config, context) {
  const prefix = String(config.label ?? '').trim() || 'log';

  return async (event) => {
    const message = renderTemplate(config.template || '${deviceId} ${sensorType} = ${value}${unit}', event);
    const result = {
      nodeId: context.nodeId,
      type: 'log',
      deviceId: event?.deviceId ?? 'unknown',
      sensorType: event?.sensorType,
      value: event?.value,
      message,
      triggeredAt: new Date(),
      delivered: true,
      dryRun: Boolean(context.dryRun),
    };

    // Dry runs collect results in memory; keep the test output quiet.
    if (!context.dryRun) {
      console.info(`[${prefix}] ${message}`);
      await recordAlert({
        graphId: context.graphId,
        nodeId: context.nodeId,
        type: 'log',
        deviceId: result.deviceId,
        sensorType: result.sensorType,
        value: result.value,
        message,
        triggeredAt: result.triggeredAt,
      });
    }
    return result;
  };
}

registerNode({
  type: 'log',
  category: 'action',
  label: 'Log',
  defaults: { label: 'pipeline', template: '${deviceId} ${sensorType} = ${value}${unit}' },
  validate(config) {
    const errors = [];
    if (config.label !== undefined && String(config.label).length > 60) errors.push('label must be 60 characters or fewer.');
    return errors;
  },
  createAction: createLogAction,
});
```

## `server/src/compiler/sources/index.js`

```js
/**
 * Importing this module registers every source node in the registry.
 */
export { sensorKey, sensorMatches } from './sensor.js';
```

## `server/src/compiler/sources/sensor.js`

```js
import { registerNode } from '../nodeRegistry.js';

const WILDCARD = '*';

/** Stable key used to look up a source node's Subject. */
export function sensorKey(config = {}) {
  return `${config.deviceId || WILDCARD}:${config.sensorType || WILDCARD}`;
}

const matches = (configured, actual) => !configured || configured === WILDCARD || configured === actual;

/** Does an incoming telemetry reading belong to this sensor node? */
export function sensorMatches(reading, config = {}) {
  const metadata = reading?.metadata ?? {};
  return matches(config.deviceId, metadata.deviceId) && matches(config.sensorType, metadata.sensorType);
}

registerNode({
  type: 'sensor',
  category: 'source',
  label: 'Sensor Source',
  defaults: { deviceId: 'turbine-001', sensorType: 'temperature' },
  subjectKey: sensorKey,
  matches: sensorMatches,
  validate(config) {
    const errors = [];
    for (const key of ['deviceId', 'sensorType']) {
      if (config[key] !== undefined) {
        const value = String(config[key]).trim();
        if (value === '') errors.push(`${key} must not be empty.`);
        else if (value.length > 120) errors.push(`${key} must be 120 characters or fewer.`);
      }
    }
    return errors;
  },
});
```

## `server/src/app.js`

```js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import graphRoutes from './routes/graphRoutes.js';
import telemetryRoutes from './routes/telemetryRoutes.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.clientOrigins }));
app.use(express.json({ limit: '2mb' }));
if (env.nodeEnv !== 'test') app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'degraded',
    database: connected ? 'connected' : 'disconnected',
  });
});
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/graphs', graphRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
```

## `server/src/server.js`

```js
import http from 'node:http';
import mongoose from 'mongoose';
import app from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { attachWebSocketServer } from './services/websocket.js';
import { activeGraphManager } from './services/activeGraphManager.js';

let server;
let sockets;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal}: shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  if (sockets) {
    for (const client of sockets.clients) client.terminate();
    sockets.close();
  }
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  // Release every compiled pipeline before the process exits.
  activeGraphManager.disposeAll();
  await mongoose.disconnect();
  clearTimeout(forceExit);
}

process.on('SIGINT', () => { shutdown('SIGINT').catch(console.error); });
process.on('SIGTERM', () => { shutdown('SIGTERM').catch(console.error); });

try {
  await connectDatabase();
  server = http.createServer(app);
  sockets = attachWebSocketServer(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, '0.0.0.0', resolve);
  });
  console.info(`NexusFlow API listening on port ${env.port}; WebSocket: /ws`);
} catch (error) {
  console.error('Startup failed:', error.message);
  await shutdown('startup failure');
  process.exitCode = 1;
}
```

## `server/scripts/simulator.js`

```js
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const { values } = parseArgs({ options: {
  devices: { type: 'string', default: process.env.SIMULATOR_DEVICES ?? '10' },
  interval: { type: 'string', default: process.env.SIMULATOR_INTERVAL_MS ?? '1000' },
  url: { type: 'string', default: process.env.SIMULATOR_URL ?? 'http://localhost:5000' },
} });
const devices = Number(values.devices);
const interval = Number(values.interval);
if (!Number.isInteger(devices) || devices < 1 || devices > 10_000 || !Number.isInteger(interval) || interval < 50) {
  console.error('Use --devices 1..10000 and --interval (milliseconds) >= 50.');
  process.exit(1);
}
const baseUrl = new URL(values.url);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('The URL must use HTTP or HTTPS.');
const endpoint = new URL('/api/telemetry/batch', baseUrl);
const rounded = (value) => Math.round(value * 100) / 100;
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });

console.log(`Simulating ${devices} devices (3 readings each) every ${interval} ms -> ${endpoint}`);
console.log('Press Ctrl+C to stop.');
while (running) {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  const readings = [];
  for (let i = 1; i <= devices; i += 1) {
    const deviceId = `turbine-${String(i).padStart(3, '0')}`;
    const location = `Site ${Math.ceil(i / 10)}`;
    const anomaly = Math.random() < 0.04;
    for (const [sensorType, value, unit] of [
      ['temperature', anomaly ? 85 + Math.random() * 20 : 45 + Math.random() * 25, '°C'],
      ['vibration', 0.5 + Math.random() * 4, 'mm/s'],
      ['pressure', 2 + Math.random() * 6, 'bar'],
    ]) {
      readings.push({ timestamp, metadata: { deviceId, sensorType, location }, value: rounded(value), unit });
    }
  }

  let accepted = 0;
  try {
    for (let i = 0; i < readings.length; i += 1000) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readings.slice(i, i + 1000)),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error?.message ?? 'request failed'}`);
      accepted += body.accepted;
    }
    console.log(`${timestamp}  accepted ${accepted} readings`);
  } catch (error) {
    console.error(`${timestamp}  accepted ${accepted} readings before error: ${error.message}`);
  }
  if (running) await sleep(Math.max(0, interval - (Date.now() - start)));
}
console.log('Simulator stopped.');
```

## `server/scripts/benchmark.js`

```js
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

const { values } = parseArgs({ options: {
  requests: { type: 'string', default: '100' },
  'batch-size': { type: 'string', default: '100' },
  concurrency: { type: 'string', default: '10' },
  url: { type: 'string', default: 'http://localhost:5000' },
} });
const requests = Number(values.requests);
const batchSize = Number(values['batch-size']);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(requests) || requests < 1 || requests > 100_000 ||
    !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000 ||
    !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) {
  console.error('Use --requests 1..100000, --batch-size 1..1000, --concurrency 1..200.');
  process.exit(1);
}
const baseUrl = new URL(values.url);
if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('The URL must use HTTP or HTTPS.');
const endpoint = new URL('/api/telemetry/batch', baseUrl);
const timestamp = new Date().toISOString();
// Reusing serialized input keeps client-side generation out of the measurement.
const payload = JSON.stringify(Array.from({ length: batchSize }, (_, i) => ({
  timestamp,
  metadata: { deviceId: `benchmark-${i % 100}`, sensorType: 'temperature', location: 'benchmark' },
  value: 50 + (i % 30),
  unit: '°C',
})));
let nextRequest = 0;
let writes = 0;
let failures = 0;
const started = performance.now();

async function worker() {
  while (nextRequest < requests) {
    nextRequest += 1;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json();
      if (!response.ok || body.accepted !== batchSize) throw new Error(`HTTP ${response.status}: ${body.error?.message ?? 'unexpected accepted count'}`);
      writes += body.accepted;
    } catch (error) {
      failures += 1;
      if (failures <= 3) console.error(`Request failed: ${error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
const seconds = (performance.now() - started) / 1000;
console.log(`Accepted ${writes.toLocaleString()} readings in ${seconds.toFixed(2)} s (${failures} failed requests).`);
console.log(`Throughput: ${Math.round(writes / seconds).toLocaleString()} writes/sec. Mid-project target: 5,000 writes/sec (informational).`);
if (failures) process.exitCode = 1;
```

## `server/samples/turbine-graph.json`

```json
{
  "name": "Turbine overheat rule",
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1
  },
  "nodes": [
    {
      "id": "sensor-turbine",
      "type": "sensor",
      "position": {
        "x": 0,
        "y": 120
      },
      "data": {
        "label": "Turbine Sensor",
        "config": {
          "deviceId": "turbine-001",
          "sensorType": "temperature"
        }
      }
    },
    {
      "id": "average-1",
      "type": "movingAverage",
      "position": {
        "x": 300,
        "y": 120
      },
      "data": {
        "label": "Moving Average Filter",
        "config": {
          "windowSize": 5
        }
      }
    },
    {
      "id": "threshold-1",
      "type": "threshold",
      "position": {
        "x": 600,
        "y": 120
      },
      "data": {
        "label": "Overheat Threshold",
        "config": {
          "operator": ">",
          "value": 80
        }
      }
    },
    {
      "id": "sms-1",
      "type": "smsAlert",
      "position": {
        "x": 900,
        "y": 120
      },
      "data": {
        "label": "SMS Alert",
        "config": {
          "phone": "+911234567890",
          "messageTemplate": "ALERT ${deviceId} ${sensorType} average = ${value}${unit}"
        }
      }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "sensor-turbine",
      "target": "average-1"
    },
    {
      "id": "edge-2",
      "source": "average-1",
      "target": "threshold-1"
    },
    {
      "id": "edge-3",
      "source": "threshold-1",
      "target": "sms-1"
    }
  ]
}
```

## `server/test/validation.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { batchSchema, readingSchema, telemetryQuerySchema } from '../src/validation/telemetry.js';
import { graphSchema } from '../src/validation/graph.js';

const reading = {
  timestamp: '2026-01-01T12:00:00.000Z',
  metadata: { deviceId: 'turbine-001', sensorType: 'temperature', location: 'Site 1' },
  value: 42.5,
  unit: '°C',
};

test('reading validation accepts extra numeric measurements and converts time', () => {
  const result = readingSchema.parse({ ...reading, humidity: 48 });
  assert.ok(result.timestamp instanceof Date);
  assert.equal(result.humidity, 48);
  assert.ok(readingSchema.parse({ ...reading, timestamp: undefined }).timestamp instanceof Date);
});

test('invalid readings, batches and query ranges are rejected', () => {
  assert.equal(readingSchema.safeParse({ ...reading, humidity: '48' }).success, false);
  assert.equal(readingSchema.safeParse({ ...reading, timestamp: 'invalid' }).success, false);
  assert.equal(readingSchema.safeParse({ ...reading, '$bad': 1 }).success, false);
  assert.equal(batchSchema.safeParse(Array(1001).fill(reading)).success, false);
  assert.equal(telemetryQuerySchema.safeParse({ from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success, false);
});

test('graph validation retains React Flow fields and rejects dangling edges', () => {
  const node = { id: 'a', position: { x: 0, y: 0 }, data: { label: 'Sensor' }, type: 'nexus' };
  const valid = graphSchema.parse({ name: '  Flow  ', nodes: [node], edges: [] });
  assert.equal(valid.name, 'Flow');
  assert.equal(valid.nodes[0].type, 'nexus');
  assert.equal(graphSchema.safeParse({ name: 'x', nodes: [node], edges: [{ id: 'e', source: 'a', target: 'missing' }] }).success, false);
});

test('HTTP validation, missing routes and health work without a database', async () => {
  const invalid = await request(app).post('/api/telemetry').send({ value: 'not a number' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.message, 'Validation failed.');
  const malformed = await request(app).post('/api/telemetry').set('Content-Type', 'application/json').send('{');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.message, 'Malformed JSON body.');
  assert.equal((await request(app).get('/missing')).status, 404);
  const health = await request(app).get('/api/health');
  assert.equal(health.status, 503);
  assert.equal(health.body.database, 'disconnected');
});
```

## `server/test/integration.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import mongoose from 'mongoose';
import request from 'supertest';
import { WebSocket } from 'ws';
import app from '../src/app.js';
import { ensureTelemetryCollection } from '../src/config/db.js';
import { attachWebSocketServer } from '../src/services/websocket.js';

const uri = process.env.TEST_MONGODB_URI;
test('MongoDB time-series, telemetry, graph CRUD and WebSockets', { skip: !uri && 'Set TEST_MONGODB_URI to a MongoDB 5.0+ server' }, async () => {
  // Never touch the configured database: use a unique throwaway database.
  const dbName = `nexusflow_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  let server;
  let sockets;
  let socket;
  try {
    await ensureTelemetryCollection(mongoose.connection.db, 86400);
    await ensureTelemetryCollection(mongoose.connection.db, 86400); // restart is safe
    const info = await mongoose.connection.db.listCollections({ name: 'telemetry' }).next();
    assert.equal(info.options.timeseries.timeField, 'timestamp');
    assert.equal(info.options.timeseries.metaField, 'metadata');
    assert.equal(info.options.timeseries.granularity, 'seconds');
    assert.equal(info.options.expireAfterSeconds, 86400);
    const indexes = await mongoose.connection.db.collection('telemetry').indexes();
    assert.ok(indexes.some((index) => index.key['metadata.deviceId'] === 1 && index.key.timestamp === -1));

    server = http.createServer(app);
    sockets = attachWebSocketServer(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
    const connected = once(socket, 'message');
    assert.equal(JSON.parse((await connected)[0].toString()).type, 'connected');

    const reading = {
      timestamp: new Date().toISOString(),
      metadata: { deviceId: 'device-1', sensorType: 'temperature', location: 'test' },
      value: 86, unit: '°C', humidity: 45,
    };
    const broadcast = once(socket, 'message');
    const single = await request(server).post('/api/telemetry').send(reading);
    assert.equal(single.status, 202);
    assert.equal(single.body.accepted, 1);
    const event = JSON.parse((await broadcast)[0].toString());
    assert.equal(event.type, 'telemetry');
    assert.equal(event.data.value, 86);
    const batch = await request(server).post('/api/telemetry/batch').send([reading, { ...reading, value: 90 }]);
    assert.equal(batch.status, 202);
    assert.equal(batch.body.accepted, 2);
    const query = await request(server).get('/api/telemetry').query({ deviceId: 'device-1', limit: 2 });
    assert.equal(query.status, 200);
    assert.equal(query.body.data.length, 2);
    assert.equal(query.body.data[0].humidity, 45);
    assert.equal((await request(server).get('/api/health')).status, 200);

    const graph = { name: 'Test', nodes: [{ id: 'a', position: { x: 5, y: 10 }, data: { label: 'Sensor' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const created = await request(server).post('/api/graphs').send(graph);
    assert.equal(created.status, 201);
    const id = created.body.data._id;
    assert.equal((await request(server).get('/api/graphs')).body.data[0]._id, id);
    assert.equal((await request(server).get(`/api/graphs/${id}`)).body.data.nodes[0].data.label, 'Sensor');
    assert.equal((await request(server).put(`/api/graphs/${id}`).send({ ...graph, name: 'Updated' })).body.data.name, 'Updated');
    assert.equal((await request(server).delete(`/api/graphs/${id}`)).status, 204);
    assert.equal((await request(server).get(`/api/graphs/${id}`)).status, 404);
  } finally {
    if (socket) socket.terminate();
    if (sockets) {
      for (const client of sockets.clients) client.terminate();
      await new Promise((resolve) => sockets.close(resolve));
    }
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
```

## `server/test/compilerRoutes.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { Graph } from '../src/models/Graph.js';
import { activeGraphManager } from '../src/services/activeGraphManager.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * HTTP tests for the Day 2 compile endpoints.
 *
 * `Graph.findById` is stubbed so the routing, validation, status codes, response shape and
 * disposal logic can be tested without a database. Use the vitest suite and
 * `TEST_MONGODB_URI=... npm test` for the real database paths.
 */

const ID_A = '64b7f9c2e1a2b3c4d5e6f7a8';
const ID_B = '64b7f9c2e1a2b3c4d5e6f7b9';
const sample = JSON.parse(readFileSync(fileURLToPath(new URL('../samples/turbine-graph.json', import.meta.url)), 'utf8'));
const originalFindById = Graph.findById;

/** Serve the given documents (by id) through the model. */
function stubGraphs(docs) {
  Graph.findById = (id) => ({
    lean: async () => {
      const doc = docs[id];
      return doc ? { ...doc, _id: id } : null;
    },
  });
}

test('compile, list, test and deactivate a graph', async (t) => {
  stubGraphs({ [ID_A]: sample });

  t.after(() => {
    Graph.findById = originalFindById;
    activeGraphManager.disposeAll();
  });

  // Unknown id -> 404.
  assert.equal((await request(app).post(`/api/graphs/${ID_B}/compile`)).status, 404);
  // Bad id -> 400.
  assert.equal((await request(app).post('/api/graphs/not-an-id/compile')).status, 400);

  // Compile + activate.
  const compiled = await request(app).post(`/api/graphs/${ID_A}/compile`);
  assert.equal(compiled.status, 200);
  assert.equal(compiled.body.data.graphId, ID_A);
  assert.equal(compiled.body.data.nodeCount, 4);
  assert.equal(compiled.body.data.edgeCount, 3);
  assert.equal(compiled.body.data.sources[0].key, 'turbine-001:temperature');
  assert.equal(compiled.body.data.subscriptions, 1);

  // Listed as active.
  const active = await request(app).get('/api/graphs/active');
  assert.equal(active.status, 200);
  assert.equal(active.body.data.length, 1);
  assert.equal(active.body.data[0].name, 'Turbine overheat rule');

  // Dry run: 5-reading window, so six values produce two alerts.
  const dryRun = await request(app).post(`/api/graphs/${ID_A}/test`).send({ values: [70, 85, 90, 95, 99, 100] });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.data.dryRun, true);
  assert.equal(dryRun.body.data.delivered, 6);
  assert.equal(dryRun.body.data.alertCount, 2);
  assert.equal(dryRun.body.data.alerts[0].type, 'smsAlert');
  assert.equal(Number(dryRun.body.data.alerts[0].value.toFixed(2)), 87.8);

  // Bad test payloads.
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/test`).send({ values: [] })).status, 400);
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/test`).send({ values: [1, 2, 'x'] })).status, 400);
  assert.equal((await request(app).post(`/api/graphs/${ID_B}/test`).send({ values: [1] })).status, 404);

  // Deactivate twice: first ok, then 404.
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/deactivate`)).status, 200);
  assert.equal((await request(app).post(`/api/graphs/${ID_A}/deactivate`)).status, 404);
  assert.equal((await request(app).get('/api/graphs/active')).body.data.length, 0);
});

test('recompiling replaces the previous pipeline instead of leaking it', async (t) => {
  stubGraphs({ [ID_A]: sample });
  t.after(() => {
    Graph.findById = originalFindById;
    activeGraphManager.disposeAll();
  });

  await request(app).post(`/api/graphs/${ID_A}/compile`);
  await request(app).post(`/api/graphs/${ID_A}/compile`);
  const active = await request(app).get('/api/graphs/active');
  assert.equal(active.body.data.length, 1, 'recompiling must not create a second entry');
  assert.equal(active.body.data[0].subscriptions, 1);
});

test('compiling an invalid graph returns 400 with the validator issues', async (t) => {
  stubGraphs({
    [ID_B]: {
      name: 'broken',
      nodes: [
        { id: 'a', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
        { id: 'b', type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize: 3 } } },
        { id: 'c', type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator: '>', value: 1 } } },
      ],
      // a -> b -> c -> b : a genuine loop built from category-valid edges.
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
        { id: 'e3', source: 'c', target: 'b' },
      ],
    },
  });
  t.after(() => {
    Graph.findById = originalFindById;
    activeGraphManager.disposeAll();
  });

  const response = await request(app).post(`/api/graphs/${ID_B}/compile`);
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'Graph is not valid.');
  const codes = response.body.error.details.map((issue) => issue.code);
  assert.ok(codes.includes('cycle'), `expected a cycle error, got ${codes.join(', ')}`);
  assert.ok(codes.includes('too_many_inputs'), 'node b has two inputs');

  // An edge into a source node is rejected with a dedicated message.
  const intoSource = await request(app).post('/api/graphs/validate').send({
    nodes: [
      { id: 's1', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
      { id: 's2', type: 'sensor', position: { x: 0, y: 0 }, data: { config: {} } },
    ],
    edges: [{ id: 'e1', source: 's1', target: 's2' }],
  });
  assert.equal(intoSource.status, 200);
  assert.ok(intoSource.body.errors.some((issue) => issue.code === 'source_has_input'));
});

test('POST /api/graphs/validate checks raw JSON without saving', async () => {
  const valid = await request(app).post('/api/graphs/validate').send(sample);
  assert.equal(valid.status, 200);
  assert.equal(valid.body.valid, true);
  assert.equal(valid.body.summary.nodeCount, 4);

  const invalid = await request(app).post('/api/graphs/validate').send({ nodes: [{ id: 'a', type: 'nope' }], edges: [] });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.body.valid, false);
  assert.ok(invalid.body.errors.some((issue) => issue.code === 'unknown_type'));

  // Malformed bodies are 400, not 200.
  assert.equal((await request(app).post('/api/graphs/validate').send({ nodes: [] })).status, 400);
  assert.equal((await request(app).post('/api/graphs/validate').send({ nope: true })).status, 400);
});
```

## `server/test/compiler/graphValidator.test.js`

```js
import { describe, expect, it } from 'vitest';
import { validateGraph } from '../../src/compiler/index.js';

const source = (id, overrides = {}) => ({
  id,
  type: 'sensor',
  position: { x: 0, y: 0 },
  data: { config: { deviceId: 'turbine-001', sensorType: 'temperature' } },
  ...overrides,
});
const movingAverage = (id, windowSize = 3) => ({ id, type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize } } });
const threshold = (id = 'threshold-1') => ({ id, type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator: '>', value: 80 } } });
const logNode = (id = 'log-1') => ({ id, type: 'log', position: { x: 0, y: 0 }, data: { config: {} } });
const edge = (sourceId, targetId, id = `${sourceId}->${targetId}`) => ({ id, source: sourceId, target: targetId });

describe('graphValidator', () => {
  it('accepts the sample turbine graph', () => {
    const result = validateGraph({
      nodes: [source('sensor-1'), movingAverage('average-1', 5), threshold('threshold-1'), { id: 'sms-1', type: 'smsAlert', position: { x: 0, y: 0 }, data: { config: { phone: '+911234567890' } } }],
      edges: [edge('sensor-1', 'average-1'), edge('average-1', 'threshold-1'), edge('threshold-1', 'sms-1')],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(4);
  });

  it('reports unknown node types', () => {
    const result = validateGraph({ nodes: [{ id: 'n1', type: 'quantumFlux', data: {} }], edges: [] });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('unknown_type');
  });

  it('reports missing nodes referenced by an edge', () => {
    const result = validateGraph({ nodes: [source('sensor-1'), movingAverage('average-1')], edges: [edge('sensor-1', 'ghost')] });
    expect(result.errors.map((error) => error.code)).toContain('missing_target');
  });

  it('reports duplicate node and edge ids', () => {
    const result = validateGraph({
      nodes: [source('sensor-1'), source('sensor-1')],
      edges: [edge('sensor-1', 'sensor-1')],
    });
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(['duplicate_node', 'self_connection']));
  });

  it('rejects a cycle', () => {
    const result = validateGraph({
      nodes: [source('sensor-1'), movingAverage('average-1'), movingAverage('average-2')],
      edges: [edge('sensor-1', 'average-1'), edge('average-1', 'average-2'), edge('average-2', 'average-1')],
    });
    const cycle = result.errors.find((error) => error.code === 'cycle');
    expect(cycle).toBeDefined();
    expect(cycle.message).toContain('average-1');
  });

  it('rejects input into a source and output from an action', () => {
    const intoSource = validateGraph({ nodes: [source('sensor-1'), source('sensor-2')], edges: [edge('sensor-1', 'sensor-2')] });
    expect(intoSource.errors.map((error) => error.code)).toContain('source_has_input');

    const fromAction = validateGraph({ nodes: [source('sensor-1'), logNode('log-1'), movingAverage('average-1')], edges: [edge('sensor-1', 'log-1'), edge('log-1', 'average-1')] });
    expect(fromAction.errors.map((error) => error.code)).toContain('action_has_output');
  });

  it('requires at least one source and warns without an action', () => {
    const noSource = validateGraph({ nodes: [movingAverage('average-1')], edges: [] });
    expect(noSource.errors.map((error) => error.code)).toContain('no_source');

    const noAction = validateGraph({ nodes: [source('sensor-1'), movingAverage('average-1')], edges: [edge('sensor-1', 'average-1')] });
    expect(noAction.ok).toBe(true);
    expect(noAction.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['no_action', 'dangling_output']));
  });

  it('flags configuration errors per node type', () => {
    const result = validateGraph({ nodes: [source('sensor-1'), { id: 'average-1', type: 'movingAverage', data: { config: { windowSize: 0 } } }], edges: [edge('sensor-1', 'average-1')] });
    expect(result.errors.some((error) => error.code === 'invalid_config' && error.nodeId === 'average-1')).toBe(true);
  });

  it('rejects non-object graphs', () => {
    expect(validateGraph(null).ok).toBe(false);
    expect(validateGraph({ nodes: 'nope' }).errors[0].code).toBe('invalid_nodes');
    expect(validateGraph({ nodes: [] }).errors[0].code).toBe('empty_graph');
  });
});
```

## `server/test/compiler/operators.test.js`

```js
import { Subject, take } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { movingAverage } from '../../src/compiler/operators/movingAverage.js';
import { threshold } from '../../src/compiler/operators/threshold.js';
import { scale } from '../../src/compiler/operators/scale.js';

const event = (value, extra = {}) => ({ deviceId: 'turbine-001', sensorType: 'temperature', unit: '°C', value, ...extra });

/**
 * Push values through an operator and return every emission.
 *
 * `expected` uses `take()` instead of completing the Subject: `bufferCount` flushes its
 * partial window on completion, which never happens in production (source Subjects are hot).
 *
 * @param {(source$: any) => any} operator
 * @param {number[]} values
 * @param {number} expected how many emissions to wait for
 */
function collect(operator, values, expected) {
  const subject = new Subject();
  const results = [];
  const subscription = subject.pipe(operator, take(expected)).subscribe((next) => results.push(next));
  for (const value of values) subject.next(event(value));
  subscription.unsubscribe();
  return results;
}

describe('movingAverage', () => {
  it('emits one average per reading once the window is full', () => {
    expect(collect(movingAverage(3), [10, 20, 30, 40], 2).map((result) => result.value)).toEqual([20, 30]);
  });

  it('keeps the metadata of the newest reading and records the window', () => {
    const results = collect(movingAverage(2), [4, 8], 1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ deviceId: 'turbine-001', sensorType: 'temperature', unit: '°C', value: 6, samples: 2, window: [4, 8] });
  });

  it('supports a window of one (pass-through)', () => {
    expect(collect(movingAverage(1), [7, 9], 2).map((result) => result.value)).toEqual([7, 9]);
  });

  it('rounds nothing and keeps fractional averages', () => {
    expect(collect(movingAverage(3), [70, 85, 90], 1)[0].value).toBeCloseTo(81.6667, 4);
  });
});

describe('threshold', () => {
  it('passes only values matching the operator', () => {
    expect(collect(threshold('>', 80), [70, 81, 80, 95], 2).map((result) => result.value)).toEqual([81, 95]);
    expect(collect(threshold('>=', 80), [70, 80, 95], 2).map((result) => result.value)).toEqual([80, 95]);
    expect(collect(threshold('<', 80), [70, 80, 95], 1).map((result) => result.value)).toEqual([70]);
    expect(collect(threshold('<=', 80), [70, 80, 95], 2).map((result) => result.value)).toEqual([70, 80]);
    expect(collect(threshold('==', 80), [70, 80, 95], 1).map((result) => result.value)).toEqual([80]);
    expect(collect(threshold('!=', 80), [70, 80, 95], 2).map((result) => result.value)).toEqual([70, 95]);
  });

  it('rejects unsupported operators', () => {
    expect(() => threshold('~', 1)).toThrow(/Unsupported threshold operator/);
  });
});

describe('scale', () => {
  it('applies factor and offset', () => {
    expect(collect(scale(2, 1), [0, 5], 2).map((result) => result.value)).toEqual([1, 11]);
  });
});

describe('operator composition', () => {
  it('chains movingAverage then threshold like the compiler does', () => {
    const results = collect((source$) => source$.pipe(movingAverage(3), threshold('>', 80)), [70, 85, 90, 95], 2);
    // windows: [70,85,90] -> 81.67 (fires), [85,90,95] -> 90 (fires)
    expect(results.map((result) => Number(result.value.toFixed(2)))).toEqual([81.67, 90]);
  });
});
```

## `server/test/compiler/streamCompiler.test.js`

```js
import { describe, expect, it, vi } from 'vitest';
import { compileGraph, GraphValidationError } from '../../src/compiler/streamCompiler.js';
import { nodeRegistry } from '../../src/compiler/nodeRegistry.js';

const sourceNode = (id = 'sensor-1', config = { deviceId: 'turbine-001', sensorType: 'temperature' }) => ({ id, type: 'sensor', position: { x: 0, y: 0 }, data: { config } });
const averageNode = (id = 'average-1', windowSize = 3) => ({ id, type: 'movingAverage', position: { x: 0, y: 0 }, data: { config: { windowSize } } });
const thresholdNode = (id = 'threshold-1', operator = '>', value = 80) => ({ id, type: 'threshold', position: { x: 0, y: 0 }, data: { config: { operator, value } } });
const logAction = (id = 'log-1') => ({ id, type: 'log', position: { x: 0, y: 0 }, data: { config: { label: 'test' } } });
const smsAction = (id = 'sms-1') => ({ id, type: 'smsAlert', position: { x: 0, y: 0 }, data: { config: { phone: '+911234567890', messageTemplate: 'ALERT ${deviceId} = ${value}${unit}' } } });
const link = (source, target) => ({ id: `${source}->${target}`, source, target });

/** Sensor -> MovingAverage(3) -> Threshold(>80) -> Log */
const linearGraph = {
  nodes: [sourceNode(), averageNode(), thresholdNode(), logAction()],
  edges: [link('sensor-1', 'average-1'), link('average-1', 'threshold-1'), link('threshold-1', 'log-1')],
};

describe('streamCompiler', () => {
  it('registers the built-in node types', () => {
    expect(nodeRegistry.types().sort()).toEqual(['log', 'movingAverage', 'scale', 'sensor', 'smsAlert', 'threshold', 'webhook']);
  });

  it('fires the log action when the moving average crosses the threshold', async () => {
    const compiled = compileGraph(linearGraph, { graphId: 'test', dryRun: true });
    compiled.pushValues([70, 85, 90, 95]);
    await new Promise((resolve) => setImmediate(resolve));

    const alerts = compiled.getAlerts();
    // window [70,85,90] -> 81.67 (fires), window [85,90,95] -> 90 (fires)
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => Number(alert.value.toFixed(2)))).toEqual([81.67, 90]);
    expect(alerts[0]).toMatchObject({ type: 'log', nodeId: 'log-1', deviceId: 'turbine-001', delivered: true, dryRun: true });
    compiled.dispose();
  });

  it('does not fire below the threshold', async () => {
    const compiled = compileGraph(linearGraph, { dryRun: true });
    compiled.pushValues([10, 20, 30, 40]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(compiled.getAlerts()).toEqual([]);
    compiled.dispose();
  });

  it('keeps metadata and renders the SMS template', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode(), thresholdNode('threshold-1', '>', 50), smsAction()],
      edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'sms-1')],
    }, { dryRun: true });
    compiled.pushValues([{ value: 60, unit: '°C' }]);
    await new Promise((resolve) => setImmediate(resolve));

    const [alert] = compiled.getAlerts();
    expect(alert.message).toBe('ALERT turbine-001 = 60°C');
    expect(alert.to).toBe('+911234567890');
    compiled.dispose();
  });

  it('supports branching with share(): one source feeding two actions', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode(), thresholdNode('threshold-1', '>', 50), logAction('log-1'), smsAction('sms-1')],
      edges: [link('sensor-1', 'threshold-1'), link('threshold-1', 'log-1'), link('threshold-1', 'sms-1')],
    }, { dryRun: true });

    expect(compiled.subscriptions).toHaveLength(2);
    compiled.pushValues([55]);
    await new Promise((resolve) => setImmediate(resolve));

    const alerts = compiled.getAlerts();
    expect(alerts.map((alert) => alert.type).sort()).toEqual(['log', 'smsAlert']);
    compiled.dispose();
  });

  it('routes readings by deviceId and sensorType', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode('sensor-a', { deviceId: 'turbine-001', sensorType: 'temperature' }), logAction('log-a')],
      edges: [link('sensor-a', 'log-a')],
    }, { dryRun: true });

    compiled.publish({ metadata: { deviceId: 'turbine-001', sensorType: 'temperature' }, value: 10, unit: '°C' });
    compiled.publish({ metadata: { deviceId: 'turbine-002', sensorType: 'temperature' }, value: 99, unit: '°C' });
    compiled.publish({ metadata: { deviceId: 'turbine-001', sensorType: 'vibration' }, value: 99, unit: 'mm/s' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(compiled.getAlerts()).toHaveLength(1);
    compiled.dispose();
  });

  it('exposes source summaries for the compile response', () => {
    const compiled = compileGraph(linearGraph, { graphId: 'abc', dryRun: true });
    expect(compiled.sources).toEqual([{ nodeId: 'sensor-1', type: 'sensor', deviceId: 'turbine-001', sensorType: 'temperature', key: 'turbine-001:temperature' }]);
    expect(compiled.nodeCount).toBe(4);
    expect(compiled.edgeCount).toBe(3);
    compiled.dispose();
  });

  it('compiles a disconnected math node feeding an action as a dead branch instead of crashing', async () => {
    // average-1 has no input (validator: warning only) but feeds log-1.
    const graph = {
      nodes: [sourceNode('sensor-1'), averageNode('average-1', 3), logAction('log-1')],
      edges: [link('average-1', 'log-1')],
    };
    const compiled = compileGraph(graph, { dryRun: true });
    // Dry-run values reach the source; the dead branch emits nothing, so no crash and no alerts.
    compiled.pushValues([80, 90, 100]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(compiled.getAlerts()).toEqual([]);
    compiled.dispose();
  });

  it('refuses to compile an invalid graph', () => {
    expect(() => compileGraph({ nodes: [averageNode()], edges: [] }, { dryRun: true })).toThrow(GraphValidationError);
    const invalid = { nodes: [sourceNode(), averageNode()], edges: [link('sensor-1', 'average-1'), link('average-1', 'sensor-1')] };
    expect(() => compileGraph(invalid, { dryRun: true })).toThrow(/not valid/);
  });

  it('dispose() unsubscribes and stops the pipeline', async () => {
    const compiled = compileGraph(linearGraph, { dryRun: true });
    expect(compiled.disposed).toBe(false);
    compiled.dispose();
    expect(compiled.disposed).toBe(true);
    expect(compiled.subscriptions).toHaveLength(0);
    // Pushing after disposal must be a no-op, not a crash.
    expect(compiled.pushValues([100, 100, 100])).toBe(0);
    compiled.dispose(); // idempotent
  });

  it('never lets a failing action kill the pipeline', async () => {
    const compiled = compileGraph({
      nodes: [sourceNode(), logAction('log-1')],
      edges: [link('sensor-1', 'log-1')],
    }, { dryRun: true, onAlert: () => { throw new Error('listener exploded'); } });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    compiled.pushValues([1, 2]);
    await new Promise((resolve) => setImmediate(resolve));
    // Both events were still delivered to the action.
    expect(compiled.getAlerts()).toHaveLength(2);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
    compiled.dispose();
  });
});
```

## `client/package.json`

```json
{
  "name": "nexusflow-client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0"
  },
  "dependencies": {
    "@fontsource-variable/manrope": "^5.2.8",
    "@fontsource/dm-mono": "^5.2.7",
    "@xyflow/react": "^12.12.1",
    "axios": "^1.13.6",
    "lucide-react": "^0.577.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.7.0",
    "autoprefixer": "^10.4.27",
    "postcss": "^8.5.6",
    "tailwindcss": "^3.4.19",
    "vite": "^6.4.6"
  }
}
```

## `client/.env.example`

```dotenv
# Browser requests stay same-origin; Vite forwards them to the API in development.
VITE_API_BASE_URL=/api
VITE_PROXY_TARGET=http://localhost:5000
```

## `client/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#ffffff" />
    <meta name="description" content="NexusFlow visual IoT rule editor" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>NexusFlow — Visual IoT Workspace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

## `client/vite.config.js`

```js
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = env.VITE_PROXY_TARGET || 'http://localhost:5000';
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      // Required for proxied cloud previews. The proxy keeps browser requests same-origin.
      allowedHosts: true,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target, changeOrigin: true, ws: true },
      },
    },
    preview: { host: '0.0.0.0', allowedHosts: true },
  };
});
```

## `client/tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Manrope Variable', 'sans-serif'], mono: ['DM Mono', 'monospace'] },
      colors: { ink: '#203640', teal: '#187d7a' },
    },
  },
  plugins: [],
};
```

## `client/postcss.config.js`

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

## `client/src/main.jsx`

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource/dm-mono/400.css';
import '@xyflow/react/dist/style.css';
import './index.css';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>,
);
```

## `client/src/App.jsx`

```jsx
import { ReactFlowProvider } from '@xyflow/react';
import EditorPage from './pages/EditorPage.jsx';

export default function App() {
  return <ReactFlowProvider><EditorPage /></ReactFlowProvider>;
}
```

## `client/src/services/api.js`

```js
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 8000,
});

export const graphApi = {
  health: () => api.get('/health'),
  create: (graph) => api.post('/graphs', graph),
  list: () => api.get('/graphs'),
  get: (id) => api.get(`/graphs/${encodeURIComponent(id)}`),
  /** Validate raw graph JSON server-side without saving it. */
  validate: (graph) => api.post('/graphs/validate', graph),
  /** Compile + activate a saved graph (returns the pipeline summary). */
  compile: (id) => api.post(`/graphs/${encodeURIComponent(id)}/compile`),
  deactivate: (id) => api.post(`/graphs/${encodeURIComponent(id)}/deactivate`),
  active: () => api.get('/graphs/active'),
  /** Dry run: push sample values through the compiled pipeline. */
  test: (id, values) => api.post(`/graphs/${encodeURIComponent(id)}/test`, { values }),
};

export function errorMessage(error) {
  return error.response?.data?.error?.message
    || (error.code === 'ECONNABORTED' ? 'The request timed out.' : 'Cannot reach the backend. Check that the server and MongoDB are running.');
}

/** Backend validation issues, when the API returned a 400 with details. */
export function errorDetails(error) {
  return Array.isArray(error.response?.data?.error?.details) ? error.response.data.error.details : [];
}
```

## `client/src/services/useTelemetry.js`

```jsx
import { useEffect, useState } from 'react';

/** Same-origin WebSocket, with bounded UI updates and automatic reconnect. */
export function useTelemetry() {
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [readings, setReadings] = useState([]);

  useEffect(() => {
    let socket;
    let retry;
    let disposed = false;
    let attempts = 0;
    let pending = [];
    const flush = setInterval(() => {
      if (pending.length) {
        setReadings(pending.slice(-3).reverse());
        pending = [];
      }
    }, 500);

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket.onopen = () => { attempts = 0; if (!disposed) setSocketStatus('connected'); };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'telemetry') {
            const received = Array.isArray(message.data) ? message.data : [message.data];
            pending = [...pending, ...received.slice(-3)].slice(-3);
          }
        } catch { /* Ignore malformed messages from the server. */ }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (disposed) return;
        setSocketStatus('disconnected');
        const delay = Math.min(1000 * 2 ** attempts, 30_000);
        attempts += 1;
        retry = setTimeout(connect, delay);
      };
    }
    connect();
    return () => {
      disposed = true;
      clearInterval(flush);
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
  return { socketStatus, readings };
}
```

## `client/src/services/graphSerializer.js`

```js
/**
 * Graph serialization.
 *
 * The editor keeps a lot of runtime state on nodes and edges (measurements, selection,
 * dragging, styling). Only the fields the compiler needs are persisted, which keeps the
 * saved JSON clean and stable:
 *
 *   { name, nodes: [{ id, type, data, position }], edges: [{ id, source, target }], viewport }
 */

/** Keep only the persisted fields of a React Flow node. */
export function serializeNode(node) {
  return {
    id: node.id,
    type: node.type,
    position: { x: Number(node.position?.x ?? 0), y: Number(node.position?.y ?? 0) },
    data: {
      kind: node.data?.kind ?? node.type,
      label: node.data?.label,
      category: node.data?.category,
      description: node.data?.description,
      config: { ...(node.data?.config ?? {}) },
    },
  };
}

/** Keep only the persisted fields of a React Flow edge. */
export function serializeEdge(edge) {
  return { id: edge.id, source: edge.source, target: edge.target };
}

/**
 * Build the clean JSON that is sent to `POST /api/graphs`.
 *
 * @param {string} name graph name
 * @param {any[]} nodes React Flow nodes
 * @param {any[]} edges React Flow edges
 * @param {{x: number, y: number, zoom: number}} [viewport]
 */
export function serializeGraph(name, nodes, edges, viewport) {
  const payload = {
    name: (name ?? '').trim() || 'Untitled graph',
    nodes: nodes.map(serializeNode),
    edges: edges.map(serializeEdge),
  };
  if (viewport && Number.isFinite(viewport.zoom)) {
    payload.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  }
  return payload;
}

/** Pretty-printed JSON, ready to download or copy. */
export const toJsonString = (graph) => JSON.stringify(graph, null, 2);

/** Trigger a browser download for the graph JSON. */
export function downloadJson(graph, filename) {
  const blob = new Blob([toJsonString(graph)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Filesystem-safe filename derived from the graph name. */
export function graphFilename(name, extension = 'json') {
  const slug = (name ?? 'graph')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'nexusflow-graph'}.${extension}`;
}

/** Copy text to the clipboard, falling back to a hidden textarea on insecure origins. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
```

## `client/src/components/nodes/definitions.js`

```js
import { Activity, BellRing, ChartNoAxesCombined, Radio, Scale, ScrollText, Webhook } from 'lucide-react';

/**
 * Single source of truth for every node type the editor can place on the canvas.
 *
 * `type` matches the registry key used by the backend compiler, so the palette, the
 * canvas and the stream compiler always agree on what a node is.
 *
 * Node data shape (this is what gets persisted):
 *   { id, type, position, data: { kind, label, category, description, config: { ... } } }
 */

export const CATEGORIES = {
  source: { id: 'source', label: 'Data source', color: '#2f6fb3' },
  math: { id: 'math', label: 'Math operation', color: '#b57a1a' },
  action: { id: 'action', label: 'Action trigger', color: '#b9523a' },
};

/** @type {Record<string, any>} */
export const NODE_TYPES = {
  sensor: {
    type: 'sensor',
    category: 'source',
    label: 'Sensor',
    description: 'Emits telemetry for one device + sensor type',
    tag: 'SENSOR INPUT',
    icon: Radio,
    hasInput: false,
    hasOutput: true,
    defaultConfig: { deviceId: 'turbine-001', sensorType: 'temperature' },
    fields: [
      { key: 'deviceId', label: 'Device ID', type: 'text', placeholder: 'turbine-001' },
      { key: 'sensorType', label: 'Sensor type', type: 'text', placeholder: 'temperature' },
    ],
  },
  movingAverage: {
    type: 'movingAverage',
    category: 'math',
    label: 'Moving Average',
    description: 'Smooths readings over a sliding window',
    tag: 'TRANSFORM',
    icon: ChartNoAxesCombined,
    hasInput: true,
    hasOutput: true,
    defaultConfig: { windowSize: 5 },
    fields: [
      { key: 'windowSize', label: 'Window size', type: 'number', min: 1, max: 1000, step: 1 },
    ],
  },
  threshold: {
    type: 'threshold',
    category: 'math',
    label: 'Threshold',
    description: 'Passes readings that match a comparison',
    tag: 'CONDITION',
    icon: Activity,
    hasInput: true,
    hasOutput: true,
    defaultConfig: { operator: '>', value: 80 },
    fields: [
      { key: 'operator', label: 'Operator', type: 'select', options: ['>', '>=', '<', '<=', '==', '!='] },
      { key: 'value', label: 'Value', type: 'number', step: 'any' },
    ],
  },
  scale: {
    type: 'scale',
    category: 'math',
    label: 'Scale',
    description: 'Applies value * factor + offset',
    tag: 'TRANSFORM',
    icon: Scale,
    hasInput: true,
    hasOutput: true,
    defaultConfig: { factor: 1, offset: 0 },
    fields: [
      { key: 'factor', label: 'Factor', type: 'number', step: 'any' },
      { key: 'offset', label: 'Offset', type: 'number', step: 'any' },
    ],
  },
  smsAlert: {
    type: 'smsAlert',
    category: 'action',
    label: 'SMS Alert',
    description: 'Sends a mock SMS and stores an alert',
    tag: 'NOTIFICATION',
    icon: BellRing,
    hasInput: true,
    hasOutput: false,
    defaultConfig: { phone: '+911234567890', messageTemplate: 'ALERT ${deviceId} ${sensorType} = ${value}${unit}' },
    fields: [
      { key: 'phone', label: 'Phone', type: 'text', placeholder: '+911234567890' },
      { key: 'messageTemplate', label: 'Message', type: 'text', placeholder: 'ALERT ${deviceId} = ${value}${unit}' },
    ],
  },
  webhook: {
    type: 'webhook',
    category: 'action',
    label: 'Webhook',
    description: 'POSTs the reading to an HTTP endpoint',
    tag: 'HTTP REQUEST',
    icon: Webhook,
    hasInput: true,
    hasOutput: false,
    defaultConfig: { url: 'https://example.com/hook', method: 'POST' },
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/hook' },
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'PUT', 'PATCH'] },
    ],
  },
  log: {
    type: 'log',
    category: 'action',
    label: 'Log',
    description: 'Prints the reading to the server console',
    tag: 'DEBUG OUTPUT',
    icon: ScrollText,
    hasInput: true,
    hasOutput: false,
    defaultConfig: { label: 'pipeline', template: '${deviceId} ${sensorType} = ${value}${unit}' },
    fields: [
      { key: 'label', label: 'Prefix', type: 'text', placeholder: 'pipeline' },
      { key: 'template', label: 'Template', type: 'text', placeholder: '${deviceId} = ${value}${unit}' },
    ],
  },
};

/**
 * Palette groups. Several entries can share the same `type` with different starting
 * config (Turbine Sensor and Temperature Sensor are both `sensor` nodes).
 */
export const PALETTE_GROUPS = [
  {
    id: 'source',
    label: 'Data sources',
    items: [
      { type: 'sensor', label: 'Turbine Sensor', description: 'Turbine temperature stream', config: { deviceId: 'turbine-001', sensorType: 'temperature' } },
      { type: 'sensor', label: 'Temperature Sensor', description: 'Ambient temperature stream', config: { deviceId: 'temp-001', sensorType: 'temperature' } },
      { type: 'sensor', label: 'Vibration Sensor', description: 'Turbine vibration stream', config: { deviceId: 'turbine-001', sensorType: 'vibration' } },
    ],
  },
  {
    id: 'math',
    label: 'Math operations',
    items: [
      { type: 'movingAverage', label: 'Moving Average', description: 'Smooth over N readings', config: { windowSize: 5 } },
      { type: 'threshold', label: 'Threshold', description: 'Filter by comparison', config: { operator: '>', value: 80 } },
      { type: 'scale', label: 'Scale', description: 'Convert or calibrate values', config: { factor: 1, offset: 0 } },
    ],
  },
  {
    id: 'action',
    label: 'Action triggers',
    items: [
      { type: 'smsAlert', label: 'SMS Alert', description: 'Notify an operator', config: { phone: '+911234567890' } },
      { type: 'webhook', label: 'Webhook', description: 'Call an HTTP endpoint', config: { url: 'https://example.com/hook', method: 'POST' } },
      { type: 'log', label: 'Log', description: 'Debug the pipeline', config: { label: 'pipeline' } },
    ],
  },
];

export const getDefinition = (type) => NODE_TYPES[type] ?? null;
export const NODE_TYPE_KEYS = Object.keys(NODE_TYPES);

let counter = 0;
export function nextNodeId(type) {
  counter += 1;
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 6) ?? `${Date.now().toString(36)}${counter}`;
  return `${type}-${suffix}`;
}

/**
 * Build a React Flow node with a fully populated `data` object.
 *
 * @param {string} type registry key, e.g. "movingAverage"
 * @param {{x: number, y: number}} position
 * @param {string} [id]
 * @param {object} [config] overrides for the node defaults
 */
export function makeNode(type, position, id = nextNodeId(type), config = {}) {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`Unknown node type "${type}"`);
  return {
    id,
    type,
    position,
    data: {
      kind: type,
      label: definition.label,
      category: definition.category,
      description: definition.description,
      config: { ...definition.defaultConfig, ...config },
    },
  };
}

/** Day-2 seed graph: Turbine Sensor -> Moving Average -> Threshold -> SMS Alert. */
export const initialNodes = [
  makeNode('sensor', { x: 0, y: 96 }, 'sensor-turbine', { deviceId: 'turbine-001', sensorType: 'temperature' }),
  makeNode('movingAverage', { x: 320, y: 96 }, 'average-1', { windowSize: 5 }),
  makeNode('threshold', { x: 640, y: 96 }, 'threshold-1', { operator: '>', value: 80 }),
  makeNode('smsAlert', { x: 960, y: 96 }, 'sms-1', { phone: '+911234567890' }),
];

export const initialEdges = [
  { id: 'edge-sensor-average', source: 'sensor-turbine', target: 'average-1', type: 'smoothstep' },
  { id: 'edge-average-threshold', source: 'average-1', target: 'threshold-1', type: 'smoothstep' },
  { id: 'edge-threshold-sms', source: 'threshold-1', target: 'sms-1', type: 'smoothstep' },
];
```

## `client/src/components/nodes/fields.jsx`

```jsx
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { NODE_TYPES } from './definitions.js';

/**
 * Returns a setter that writes one key of `data.config` back into React Flow state.
 *
 * Uses `updateNodeData`, which merges into the node's data, so the rest of the node
 * (label, category, ...) and the other config keys are preserved.
 */
export function useNodeConfig(id, data) {
  const { updateNodeData } = useReactFlow();
  return useCallback((key, value) => {
    updateNodeData(id, { config: { ...(data?.config ?? {}), [key]: value } });
  }, [id, data?.config, updateNodeData]);
}

/**
 * A single labelled config input.
 *
 * `nodrag` / `nopan` keep React Flow from panning or starting a selection while the user
 * types or scrolls inside a node.
 */
export function ConfigField({ field, value, onChange }) {
  const inputClass = `node-input nodrag nopan ${field.type === 'select' ? 'is-select' : ''}`;
  return (
    <label className="node-field nodrag">
      <span>{field.label}</span>
      {field.type === 'select' ? (
        <select className={inputClass} value={value ?? ''} onChange={(event) => onChange(field.key, event.target.value)}>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : field.type === 'number' ? (
        <input
          className={inputClass}
          type="number"
          value={value ?? ''}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(field.key, raw === '' ? '' : Number(raw));
          }}
        />
      ) : (
        <input
          className={inputClass}
          type="text"
          value={value ?? ''}
          placeholder={field.placeholder}
          maxLength={field.key === 'messageTemplate' || field.key === 'template' ? 240 : 120}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
    </label>
  );
}

/** Renders the configured fields of a node definition. */
export function ConfigFields({ id, type, data }) {
  const definition = NODE_TYPES[type];
  const setConfig = useNodeConfig(id, data);
  if (!definition) return null;
  return (
    <div className="node-fields">
      {definition.fields.map((field) => (
        <ConfigField key={field.key} field={field} value={data?.config?.[field.key]} onChange={setConfig} />
      ))}
    </div>
  );
}
```

## `client/src/components/nodes/NodeCard.jsx`

```jsx
import { Handle, Position } from '@xyflow/react';
import { ArrowUpRight } from 'lucide-react';
import { CATEGORIES, getDefinition } from './definitions.js';

/**
 * Shared card shell for every custom node.
 *
 * Handles are driven by the node definition: sources expose only an output, actions only
 * an input, math nodes both. Children are the node's config fields.
 */
export default function NodeCard({ id, type, data, selected, children, badge }) {
  const definition = getDefinition(type);
  const category = definition?.category ?? data?.category ?? 'source';
  const meta = CATEGORIES[category] ?? CATEGORIES.source;
  const Icon = definition?.icon;

  return (
    <div className={`flow-node ${category} ${selected ? 'is-selected' : ''}`} data-node-type={type}>
      {definition?.hasInput && <Handle type="target" position={Position.Left} aria-label="Input connection" />}

      <div className="flow-node-top">
        <span><i style={{ background: meta.color }} />{meta.label.toUpperCase()}</span>
        <ArrowUpRight size={14} />
      </div>

      <div className="flow-node-main">
        {Icon && (
          <span className={`node-icon ${category}`}>
            <Icon size={20} strokeWidth={1.8} />
          </span>
        )}
        <div className="node-headings">
          <strong>{data?.label || definition?.label || 'Node'}</strong>
          <small>{badge ?? data?.description ?? definition?.description}</small>
        </div>
      </div>

      {children}

      <div className="flow-node-footer">
        <span>{definition?.tag ?? 'FLOW NODE'}</span>
        <span className="node-footer-dots">···</span>
      </div>

      {definition?.hasOutput && <Handle type="source" position={Position.Right} aria-label="Output connection" />}
    </div>
  );
}
```

## `client/src/components/nodes/SensorNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Data source: the entry point of a pipeline. Only has an output handle. */
export default function SensorNode({ id, data, selected }) {
  const deviceId = data?.config?.deviceId ?? 'unknown';
  const sensorType = data?.config?.sensorType ?? 'unknown';
  return (
    <NodeCard id={id} type="sensor" data={data} selected={selected} badge={`${deviceId} · ${sensorType}`}>
      <ConfigFields id={id} type="sensor" data={data} />
    </NodeCard>
  );
}
```

## `client/src/components/nodes/MovingAverageNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Math: sliding-window average over `windowSize` readings. */
export default function MovingAverageNode({ id, data, selected }) {
  const windowSize = data?.config?.windowSize ?? 5;
  return (
    <NodeCard id={id} type="movingAverage" data={data} selected={selected} badge={`average of last ${windowSize} readings`}>
      <ConfigFields id={id} type="movingAverage" data={data} />
    </NodeCard>
  );
}
```

## `client/src/components/nodes/ThresholdNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Math: forwards a reading only when `value <operator> threshold`. */
export default function ThresholdNode({ id, data, selected }) {
  const operator = data?.config?.operator ?? '>';
  const value = data?.config?.value ?? 0;
  return (
    <NodeCard id={id} type="threshold" data={data} selected={selected} badge={`fires when value ${operator} ${value}`}>
      <ConfigFields id={id} type="threshold" data={data} />
    </NodeCard>
  );
}
```

## `client/src/components/nodes/ScaleNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Math: unit conversion / calibration, `value * factor + offset`. */
export default function ScaleNode({ id, data, selected }) {
  const factor = data?.config?.factor ?? 1;
  const offset = data?.config?.offset ?? 0;
  return (
    <NodeCard id={id} type="scale" data={data} selected={selected} badge={`value × ${factor} + ${offset}`}>
      <ConfigFields id={id} type="scale" data={data} />
    </NodeCard>
  );
}
```

## `client/src/components/nodes/SmsAlertNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: mock SMS gateway (logs the message and stores an alert). */
export default function SmsAlertNode({ id, data, selected }) {
  const phone = data?.config?.phone ?? '';
  return (
    <NodeCard id={id} type="smsAlert" data={data} selected={selected} badge={phone ? `to ${phone}` : 'set a phone number'}>
      <ConfigFields id={id} type="smsAlert" data={data} />
    </NodeCard>
  );
}
```

## `client/src/components/nodes/WebhookNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: HTTP call with a 3 second timeout; failures never break the pipeline. */
export default function WebhookNode({ id, data, selected }) {
  const method = data?.config?.method ?? 'POST';
  const url = data?.config?.url ?? '';
  return (
    <NodeCard id={id} type="webhook" data={data} selected={selected} badge={`${method} ${url}`}>
      <ConfigFields id={id} type="webhook" data={data} />
    </NodeCard>
  );
}
```

## `client/src/components/nodes/LogNode.jsx`

```jsx
import NodeCard from './NodeCard.jsx';
import { ConfigFields } from './fields.jsx';

/** Action: prints the reading to the server console — the cheapest way to debug a graph. */
export default function LogNode({ id, data, selected }) {
  const prefix = data?.config?.label ?? 'pipeline';
  return (
    <NodeCard id={id} type="log" data={data} selected={selected} badge={`console · ${prefix}`}>
      <ConfigFields id={id} type="log" data={data} />
    </NodeCard>
  );
}
```

## `client/src/components/nodes/index.js`

```js
/**
 * Node type registry for React Flow.
 *
 * IMPORTANT: `nodeTypes` is created once at module scope. Defining it inside a component
 * would give React Flow a new object on every render and remount every node.
 */
import FlowNode from '../canvas/FlowNode.jsx';
import LogNode from './LogNode.jsx';
import MovingAverageNode from './MovingAverageNode.jsx';
import ScaleNode from './ScaleNode.jsx';
import SensorNode from './SensorNode.jsx';
import SmsAlertNode from './SmsAlertNode.jsx';
import ThresholdNode from './ThresholdNode.jsx';
import WebhookNode from './WebhookNode.jsx';

export const nodeTypes = {
  // "nexus" is the Day 1 generic node, kept so graphs saved before Day 2 still render.
  nexus: FlowNode,
  sensor: SensorNode,
  movingAverage: MovingAverageNode,
  threshold: ThresholdNode,
  scale: ScaleNode,
  smsAlert: SmsAlertNode,
  webhook: WebhookNode,
  log: LogNode,
};

export { default as NodeCard } from './NodeCard.jsx';
export { ConfigField, ConfigFields, useNodeConfig } from './fields.jsx';
export * from './definitions.js';
```

## `client/src/components/canvas/nodeLibrary.js`

```js
/**
 * Day 2: the node catalogue now lives in components/nodes/definitions.js (one place for
 * the palette, the canvas and the backend compiler).
 *
 * This module stays as the import path used by Day 1 components (palette, inspector and
 * the legacy generic node) so no earlier code had to change.
 */
export {
  CATEGORIES,
  NODE_TYPES as nodeDefinitions,
  PALETTE_GROUPS as groups,
  getDefinition,
  initialEdges,
  initialNodes,
  makeNode,
  nextNodeId,
} from '../nodes/definitions.js';
```

## `client/src/components/canvas/NodePalette.jsx`

```jsx
import { GripVertical, MousePointer2, Search, X } from 'lucide-react';
import { useState } from 'react';
import { PALETTE_GROUPS, getDefinition } from '../nodes/definitions.js';

/**
 * Left sidebar: every palette entry is draggable (HTML5 drag & drop, read by the canvas)
 * and clickable (drops the node in the middle of the viewport).
 */
export default function NodePalette({ onAddNode }) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const matches = PALETTE_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query)),
  })).filter((group) => group.items.length);

  function startDrag(event, item) {
    event.dataTransfer.setData('application/nexusflow-node', JSON.stringify({ type: item.type, config: item.config }));
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside className="palette" aria-label="Node palette">
      <div className="palette-heading">
        <span className="eyebrow"><span className="eyebrow-line" /> THE BUILDING BLOCKS</span>
        <h2>Node palette<span className="heading-period">.</span></h2>
        <p>Drag a node onto the canvas to start building your flow.</p>
        <label className="palette-search">
          <Search size={15} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a node..." aria-label="Find a node" />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
          {!search && <span className="search-shortcut">/</span>}
        </label>
      </div>

      <div className="palette-groups">
        {matches.length === 0 && <p className="palette-empty">No nodes match “{search}”.</p>}
        {matches.map((group) => (
          <section className="palette-group" key={group.id}>
            <div className="group-heading"><h3>{group.label}</h3><span>{String(group.items.length).padStart(2, '0')}</span></div>
            <div className="palette-items">
              {group.items.map((item) => {
                const definition = getDefinition(item.type);
                const Icon = definition?.icon;
                return (
                  <button
                    type="button"
                    className={`palette-item ${definition?.category ?? ''}`}
                    key={`${group.id}-${item.label}`}
                    draggable
                    onDragStart={(event) => startDrag(event, item)}
                    onClick={() => onAddNode(item.type, item.config)}
                    title={`Drag or click to add ${item.label}`}
                  >
                    <span className={`node-icon ${definition?.category ?? ''}`}>
                      {Icon ? <Icon size={18} strokeWidth={1.8} /> : null}
                    </span>
                    <span className="palette-item-copy">
                      <strong>{item.label}</strong>
                      <small className="truncate">{item.description}</small>
                    </span>
                    <GripVertical className="grip" size={15} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="palette-tip">
        <span className="tip-icon"><MousePointer2 size={15} /></span>
        <div><strong>A little tip</strong><p>Drag to add, or click a node to place it on your canvas.</p></div>
      </div>
      <div className="palette-footer"><span>YOUR IDEAS, CONNECTED</span><span>✳</span></div>
    </aside>
  );
}
```

## `client/src/components/canvas/FlowNode.jsx`

```jsx
import { Handle, Position } from '@xyflow/react';
import { ArrowUpRight, CircleDot } from 'lucide-react';
import { nodeDefinitions } from './nodeLibrary.js';

const categoryLabels = { source: 'DATA SOURCE', math: 'MATH OPERATION', action: 'ACTION TRIGGER' };

export default function FlowNode({ data, selected }) {
  const definition = nodeDefinitions[data.kind];
  const category = definition?.category || data.category || 'source';
  const Icon = definition?.icon || CircleDot;
  return (
    <div className={`flow-node ${category} ${selected ? 'is-selected' : ''}`}>
      {category !== 'source' && <Handle type="target" position={Position.Left} aria-label="Input connection" />}
      <div className="flow-node-top"><span><i />{categoryLabels[category] || 'NODE'}</span><ArrowUpRight size={14} /></div>
      <div className="flow-node-main">
        <span className={`node-icon ${category}`}><Icon size={20} strokeWidth={1.8} /></span>
        <div><strong>{data.label || definition?.label || 'Node'}</strong><small>{data.description || definition?.description || 'Flow component'}</small></div>
      </div>
      <div className="flow-node-footer"><span>{definition?.tag || 'FLOW NODE'}</span><span className="node-footer-dots">···</span></div>
      {category !== 'action' && <Handle type="source" position={Position.Right} aria-label="Output connection" />}
    </div>
  );
}
```

## `client/src/components/canvas/FlowCanvas.jsx`

```jsx
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import { MousePointer2, Sparkles } from 'lucide-react';
import { useCallback } from 'react';
import { nodeTypes } from '../nodes/index.js';
import { validateConnection } from './graphRules.js';

const edgeOptions = { type: 'smoothstep', style: { stroke: '#94aaa9', strokeWidth: 2 } };

/**
 * Central canvas.
 *
 * `nodeTypes` comes from a module-level constant (never recreated inside a component),
 * and `isValidConnection` refuses illegal links while the user is still dragging.
 */
export default function FlowCanvas({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onDrop, onInvalidConnection, canvasRef }) {
  // Pure: React Flow calls this repeatedly while dragging, so it must not have side effects.
  const isValidConnection = useCallback(
    (connection) => validateConnection(connection, nodes, edges).valid,
    [nodes, edges],
  );

  // Report *why* a link was refused only once, when the drag ends on an invalid target.
  const handleConnectEnd = useCallback((event, connectionState) => {
    if (connectionState?.isValid !== false) return;
    const source = connectionState?.fromNode?.id;
    const target = connectionState?.toNode?.id;
    if (!source || !target) return;
    const result = validateConnection({ source, target }, nodes, edges);
    onInvalidConnection?.(result.reason ?? 'That connection is not allowed.');
  }, [nodes, edges, onInvalidConnection]);

  return (
    <div className="canvas-wrap" ref={canvasRef} onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={edgeOptions}
        connectionLineStyle={{ stroke: '#418d8a', strokeWidth: 2 }}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#cbd8d7" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeStrokeWidth={3}
          nodeColor={(node) => (node.data?.category === 'math' ? '#cddff6' : node.data?.category === 'action' ? '#f5ddc4' : '#bfe4db')}
          maskColor="rgba(242, 247, 246, .72)"
        />
      </ReactFlow>
      <div className="canvas-label select-none"><span className="canvas-label-icon"><Sparkles size={13} /></span><span>YOUR WORKSPACE</span><i /><span>READY TO CREATE</span></div>
      <div className="canvas-hint select-none"><MousePointer2 size={14} /> <span>Drag to pan</span><i /> <span>Scroll to zoom</span></div>
    </div>
  );
}
```

## `client/src/components/canvas/graphRules.js`

```js
import { getDefinition } from '../nodes/definitions.js';

/**
 * Client-side graph rules.
 *
 * These mirror `server/src/compiler/graphValidator.js` so the editor can give instant
 * feedback; the backend always re-validates before compiling, so it stays authoritative.
 */

/** Is `to` reachable from `from` by following edges? (used for cycle prevention) */
export function hasPath(edges, from, to) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source).push(edge.target);
  }
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const current = queue.shift();
    if (current === to) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Can these two nodes be connected?
 *
 * Allowed flows: Source -> Math -> ... -> Math -> Action, and Source -> Action.
 *
 * @param {{ source: string, target: string }} connection
 * @param {any[]} nodes
 * @param {any[]} edges
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateConnection(connection, nodes, edges) {
  const { source, target } = connection ?? {};
  if (!source || !target) return { valid: false, reason: 'Incomplete connection.' };
  if (source === target) return { valid: false, reason: 'A node cannot connect to itself.' };

  const from = nodes.find((node) => node.id === source);
  const to = nodes.find((node) => node.id === target);
  if (!from || !to) return { valid: false, reason: 'Unknown node.' };

  const fromDefinition = getDefinition(from.type);
  const toDefinition = getDefinition(to.type);
  if (!fromDefinition || !toDefinition) return { valid: false, reason: 'Unknown node type.' };

  if (!fromDefinition.hasOutput) return { valid: false, reason: `${fromDefinition.label} nodes have no output.` };
  if (!toDefinition.hasInput) return { valid: false, reason: `${toDefinition.label} nodes have no input.` };

  if (edges.some((edge) => edge.source === source && edge.target === target)) {
    return { valid: false, reason: 'These nodes are already connected.' };
  }
  if (hasPath(edges, target, source)) {
    return { valid: false, reason: 'That connection would create a loop.' };
  }
  return { valid: true };
}

/**
 * Full graph check for the "Validate graph" button.
 *
 * @param {any[]} nodes
 * @param {any[]} edges
 * @returns {{ ok: boolean, errors: object[], warnings: object[] }}
 */
export function validateGraph(nodes, edges) {
  /** @type {object[]} */
  const errors = [];
  /** @type {object[]} */
  const warnings = [];

  if (nodes.length === 0) {
    return { ok: false, errors: [{ code: 'empty_graph', message: 'The canvas is empty. Add a data source to begin.' }], warnings };
  }

  for (const node of nodes) {
    const definition = getDefinition(node.type);
    if (!definition) {
      errors.push({ code: 'unknown_type', nodeId: node.id, message: `Node "${node.id}" has unknown type "${node.type}".` });
      continue;
    }
    const incoming = edges.filter((edge) => edge.target === node.id).length;
    const outgoing = edges.filter((edge) => edge.source === node.id).length;

    if (incoming > 1) {
      errors.push({ code: 'too_many_inputs', nodeId: node.id, message: `${definition.label} "${node.id}" has ${incoming} inputs; only one is supported.` });
    }
    if (definition.category !== 'source' && incoming === 0) {
      errors.push({ code: 'disconnected_node', nodeId: node.id, message: `${definition.label} is not connected to any input.` });
    }
    if (definition.category === 'source' && outgoing === 0) {
      warnings.push({ code: 'dangling_source', nodeId: node.id, message: `${definition.label} output is not connected to anything.` });
    }
    if (definition.category !== 'action' && outgoing === 0 && incoming > 0) {
      warnings.push({ code: 'dangling_output', nodeId: node.id, message: `${definition.label} output is not connected to anything.` });
    }
  }

  for (const edge of edges) {
    const check = { source: edge.source, target: edge.target };
    if (!(nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target))) {
      errors.push({ code: 'dangling_edge', edgeId: edge.id, message: `Edge "${edge.id}" points at a missing node.` });
      continue;
    }
    // Existing edges were created before the rules ran, so re-check them here.
    if (edge.source !== edge.target) {
      const result = validateConnection(check, nodes, edges.filter((item) => item.id !== edge.id));
      if (!result.valid && result.reason !== 'These nodes are already connected.') {
        errors.push({ code: 'invalid_edge', edgeId: edge.id, message: `Edge "${edge.id}" is not valid: ${result.reason}` });
      }
    }
  }

  const sources = nodes.filter((node) => getDefinition(node.type)?.category === 'source');
  const actions = nodes.filter((node) => getDefinition(node.type)?.category === 'action');
  if (sources.length === 0) errors.push({ code: 'no_source', message: 'Add at least one data source node.' });
  if (actions.length === 0) errors.push({ code: 'no_action', message: 'Add at least one action trigger (SMS, webhook or log).' });

  return { ok: errors.length === 0, errors, warnings };
}
```

## `client/src/components/layout/Navbar.jsx`

```jsx
import { ChevronRight, Download, FolderOpen, LoaderCircle, Save, ShieldCheck } from 'lucide-react';

/**
 * Top toolbar: health indicator, Load / Validate / Export / Save.
 */
export default function Navbar({ health, onSave, onLoad, onValidate, onExport, saving, validating }) {
  const healthText = health === 'online' ? 'Backend connected' : health === 'offline' ? 'Backend offline' : 'Checking backend';
  return (
    <header className="navbar">
      <div className="brand select-none">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="brand-copy"><strong>NexusFlow<span>.</span></strong><small>VISUAL IOT WORKSPACE</small></div>
      </div>
      <div className="nav-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>Flow editor</strong></div>
      <div className="nav-actions">
        <div className={`health ${health}`} role="status"><span className="health-dot" />{healthText}</div>
        <div className="nav-divider" />
        <button className="button button-ghost" onClick={onLoad}><FolderOpen size={16} /><span>Load graph</span></button>
        <button className="button button-ghost" onClick={onValidate} disabled={validating}>
          {validating ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
          <span>{validating ? 'Validating...' : 'Validate graph'}</span>
        </button>
        <button className="button button-ghost" onClick={onExport}><Download size={16} /><span>Export JSON</span></button>
        <button className="button button-primary" onClick={onSave} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}<span>{saving ? 'Saving...' : 'Save graph'}</span>
        </button>
      </div>
    </header>
  );
}
```

## `client/src/components/FlowInspector.jsx`

```jsx
import { ArrowUpRight, Check, Circle, Layers2, Radio, Trash2, Workflow } from 'lucide-react';
import { nodeDefinitions } from './canvas/nodeLibrary.js';

export default function FlowInspector({ nodes, edges, selectedNode, onRemoveNode, socketStatus, readings }) {
  const steps = [
    { label: 'Add a data source', complete: nodes.some((node) => node.data?.category === 'source') },
    { label: 'Add an operation', complete: nodes.some((node) => node.data?.category === 'math') },
    { label: 'Choose an action', complete: nodes.some((node) => node.data?.category === 'action') },
  ];
  const socketText = socketStatus === 'connected' ? 'LIVE' : socketStatus === 'connecting' ? 'CONNECTING' : 'OFFLINE';
  const selectedDefinition = selectedNode && nodeDefinitions[selectedNode.data?.kind];

  return (
    <aside className="inspector" aria-label="Flow details">
      <div className="inspector-heading"><span className="eyebrow">THE BIG PICTURE</span><span className="inspector-number">01 / 01</span></div>
      <div className="inspector-title"><div><h2>Flow overview<span className="heading-period">.</span></h2><p>A little clarity goes a long way.</p></div><ArrowUpRight size={17} /></div>
      <div className="stats-grid">
        <div className="stat-card"><span className="stat-icon"><Layers2 size={15} /></span><strong>{String(nodes.length).padStart(2, '0')}</strong><small>Nodes</small></div>
        <div className="stat-card"><span className="stat-icon"><Workflow size={15} /></span><strong>{String(edges.length).padStart(2, '0')}</strong><small>Connections</small></div>
      </div>

      {selectedNode ? (
        <section className="inspector-section selected-section">
          <div className="section-label"><span>SELECTED NODE</span><span>DETAILS</span></div>
          <div className="selected-node-title">{selectedNode.data?.label || 'Node'}</div>
          <p>{selectedNode.data?.description || selectedDefinition?.description || 'A component in your flow.'}</p>
          <button className="remove-node" onClick={() => onRemoveNode(selectedNode.id)}><Trash2 size={14} /> Remove node</button>
        </section>
      ) : (
        <section className="inspector-section">
          <div className="section-label"><span>BUILDING YOUR FLOW</span><span>03 STEPS</span></div>
          <div className="checklist">
            {steps.map((step) => <div className="checklist-row" key={step.label}>
              <span className={`check-circle ${step.complete ? 'done' : ''}`}>{step.complete ? <Check size={12} /> : <Circle size={10} />}</span>
              <span>{step.label}</span><span className="checklist-state">{step.complete ? 'ADDED' : 'TO DO'}</span>
            </div>)}
          </div>
        </section>
      )}

      <section className="inspector-section telemetry-section">
        <div className="section-label"><span>LIVE TELEMETRY</span><span className={`socket-badge ${socketStatus}`}><i />{socketText}</span></div>
        {readings.length ? (
          <div className="reading-list">
            {readings.map((reading, index) => <div className="reading-row" key={`${reading._id || reading.timestamp}-${index}`}>
              <span className="reading-icon"><Radio size={14} /></span>
              <span className="reading-copy"><strong>{reading.metadata?.sensorType || 'Sensor'}</strong><small>{reading.metadata?.deviceId || 'Device'}</small></span>
              <span className="reading-value tabular-nums">{typeof reading.value === 'number' ? reading.value.toFixed(1) : '—'} <small>{reading.unit}</small></span>
            </div>)}
          </div>
        ) : (
          <div className="telemetry-empty"><span className="telemetry-empty-icon"><Radio size={17} /></span><strong>Listening for data</strong><p>Run the simulator to see readings arrive here in real time.</p><code>npm run simulate</code></div>
        )}
      </section>
      <div className="inspector-note"><span className="note-star">✳</span><div><strong>Just the beginning.</strong><p>Graphs are saved today. Live rule execution is coming in a future milestone.</p></div></div>
    </aside>
  );
}
```

## `client/src/components/GraphPicker.jsx`

```jsx
import { ArrowRight, FolderOpen, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export default function GraphPicker({ graphs, loading, error, busyId, onSelect, onRetry, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll('button:not([disabled])') || [])];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="load-title">
        <div className="modal-heading"><div><span className="eyebrow">YOUR SAVED WORK</span><h2 id="load-title">Load a graph<span className="heading-period">.</span></h2><p>Pick up right where you left off.</p></div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
        <div className="modal-content">
          {loading && <div className="modal-state"><LoaderCircle className="spin" size={21} /><span>Finding your graphs...</span></div>}
          {!loading && error && <div className="modal-state"><span>{error}</span><button className="button button-secondary" onClick={onRetry}><RefreshCw size={14} /> Try again</button></div>}
          {!loading && !error && graphs.length === 0 && <div className="modal-state"><FolderOpen size={25} /><strong>No saved graphs yet</strong><span>Save your first flow and it will appear here.</span></div>}
          {!loading && !error && graphs.map((graph) => <button className="graph-option" key={graph._id} onClick={() => onSelect(graph._id)} disabled={Boolean(busyId)}>
            <span className="graph-option-icon"><FolderOpen size={18} /></span><span className="graph-option-copy"><strong>{graph.name}</strong><small>Updated {new Date(graph.updatedAt).toLocaleString()}</small></span>
            {busyId === graph._id ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
          </button>)}
        </div>
        <div className="modal-footer">Loading a graph replaces the current canvas.</div>
      </div>
    </div>
  );
}
```

## `client/src/components/ValidationPanel.jsx`

```jsx
import { CheckCircle2, ChevronDown, Info, TriangleAlert, X } from 'lucide-react';

/**
 * Result panel for the "Validate graph" button.
 *
 * Errors block compilation (they mirror the backend validator); warnings are advisory.
 */
export default function ValidationPanel({ result, source, onClose, onSelectNode }) {
  if (!result) return null;
  const { errors = [], warnings = [] } = result;
  const ok = errors.length === 0;

  return (
    <section className={`validation-panel ${ok ? 'is-valid' : 'is-invalid'}`} aria-live="polite">
      <header className="validation-head">
        <span className="validation-title">
          {ok ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
          <strong>{ok ? 'Graph is valid' : `${errors.length} problem${errors.length === 1 ? '' : 's'} found`}</strong>
          {source === 'backend' && <span className="validation-source">checked by backend</span>}
          {source === 'local' && <span className="validation-source">checked in browser</span>}
        </span>
        <button className="icon-button small" onClick={onClose} aria-label="Close validation panel"><X size={15} /></button>
      </header>

      {ok && warnings.length === 0 && (
        <p className="validation-ok">Every node is connected, there are no loops and the graph has a source and an action.</p>
      )}

      {errors.length > 0 && (
        <ul className="validation-list errors">
          {errors.map((issue, index) => (
            <li key={`error-${index}`}>
              <TriangleAlert size={13} />
              <span>{issue.message}</span>
              {issue.nodeId && onSelectNode && (
                <button className="validation-link" onClick={() => onSelectNode(issue.nodeId)}>Show node</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <details className="validation-warnings" open={errors.length === 0}>
          <summary><ChevronDown size={13} /> {warnings.length} warning{warnings.length === 1 ? '' : 's'}</summary>
          <ul className="validation-list warnings">
            {warnings.map((issue, index) => (
              <li key={`warning-${index}`}>
                <Info size={13} />
                <span>{issue.message}</span>
                {issue.nodeId && onSelectNode && (
                  <button className="validation-link" onClick={() => onSelectNode(issue.nodeId)}>Show node</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
```

## `client/src/pages/EditorPage.jsx`

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { addEdge, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, PencilLine, X } from 'lucide-react';
import FlowCanvas from '../components/canvas/FlowCanvas.jsx';
import NodePalette from '../components/canvas/NodePalette.jsx';
import { validateGraph } from '../components/canvas/graphRules.js';
import { getDefinition, initialEdges, initialNodes, makeNode } from '../components/nodes/definitions.js';
import FlowInspector from '../components/FlowInspector.jsx';
import GraphPicker from '../components/GraphPicker.jsx';
import Navbar from '../components/layout/Navbar.jsx';
import ValidationPanel from '../components/ValidationPanel.jsx';
import { errorMessage, graphApi } from '../services/api.js';
import { copyText, downloadJson, graphFilename, serializeGraph, toJsonString } from '../services/graphSerializer.js';
import { useTelemetry } from '../services/useTelemetry.js';

/** Dimensions of a node card, used to centre a dropped node under the cursor. */
const NODE_OFFSET = { x: 130, y: 46 };

export default function EditorPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [name, setName] = useState('Turbine overheat rule');
  const [health, setHealth] = useState('checking');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [graphs, setGraphs] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [loadingId, setLoadingId] = useState('');
  const [notice, setNotice] = useState(null);
  const canvasRef = useRef(null);
  const nameRef = useRef(null);
  const exportRef = useRef('');
  const flow = useReactFlow();
  const { socketStatus, readings } = useTelemetry();
  const selectedNode = nodes.find((node) => node.selected);

  // ------------------------------------------------------------- backend health
  useEffect(() => {
    let mounted = true;
    async function check() {
      try { await graphApi.health(); if (mounted) setHealth('online'); }
      catch { if (mounted) setHealth('offline'); }
    }
    check();
    const timer = setInterval(check, 15_000);
    window.addEventListener('focus', check);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), notice.action ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ------------------------------------------------------------------ graph ops
  const onConnect = useCallback((connection) => {
    setEdges((current) => addEdge({ ...connection, type: 'smoothstep' }, current));
  }, [setEdges]);

  function addNode(type, position, config) {
    if (!getDefinition(type)) return;
    setNodes((current) => [...current, makeNode(type, position, undefined, config)]);
  }

  /**
   * Palette drag payload: a JSON string `{ type, config }`.
   * A bare type string is still accepted (graphs dragged before Day 2 used that format).
   */
  function parseDragPayload(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type) return { type: parsed.type, config: parsed.config };
    } catch {
      // Not JSON: treat the payload as a plain node type.
    }
    return { type: raw, config: undefined };
  }

  function handleDrop(event) {
    event.preventDefault();
    const { type, config } = parseDragPayload(event.dataTransfer.getData('application/nexusflow-node')) ?? {};
    if (!type || !getDefinition(type)) return;
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(type, { x: position.x - NODE_OFFSET.x, y: position.y - NODE_OFFSET.y }, config);
  }

  function handlePaletteClick(type, config) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    addNode(type, { x: position.x - NODE_OFFSET.x, y: position.y - NODE_OFFSET.y }, config);
  }

  function removeNode(id) {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
  }

  function focusNode(nodeId) {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    flow.fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1.2, padding: 0.6 });
  }

  // ---------------------------------------------------------------- save / load
  async function saveGraph() {
    if (!name.trim()) {
      setNotice({ type: 'error', message: 'Give your graph a name before saving.' });
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const { viewport } = flow.toObject();
      const payload = serializeGraph(name, nodes, edges, viewport);
      await graphApi.create(payload);
      setName(payload.name);
      setNotice({ type: 'success', message: `Graph saved with ${payload.nodes.length} nodes and ${payload.edges.length} edges.` });
    } catch (error) {
      setNotice({ type: 'error', message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function fetchGraphs() {
    setListLoading(true);
    setListError('');
    try { setGraphs((await graphApi.list()).data.data); }
    catch (error) { setListError(errorMessage(error)); }
    finally { setListLoading(false); }
  }

  const openPicker = () => { setPickerOpen(true); fetchGraphs(); };
  const closePicker = useCallback(() => setPickerOpen(false), []);

  async function loadGraph(id) {
    setLoadingId(id);
    try {
      const graph = (await graphApi.get(id)).data.data;
      setNodes(graph.nodes ?? []);
      // Saved edges carry no `type`; re-apply the canvas default so the round trip is seamless.
      setEdges((graph.edges ?? []).map((edge) => ({ type: 'smoothstep', ...edge })));
      setName(graph.name ?? 'Untitled graph');
      setValidation(null);
      setPickerOpen(false);
      requestAnimationFrame(() => {
        if (graph.viewport) flow.setViewport(graph.viewport, { duration: 300 });
        else flow.fitView({ padding: 0.22, maxZoom: 1, duration: 300 });
      });
      setNotice({ type: 'success', message: 'Graph loaded onto your canvas.' });
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setLoadingId('');
    }
  }

  // ------------------------------------------------------------- validate / export
  async function runValidation() {
    setValidating(true);
    const local = validateGraph(nodes, edges);
    setValidation({ result: local, source: 'local' });
    try {
      const response = await graphApi.validate(serializeGraph(name, nodes, edges));
      setValidation({
        result: { errors: response.data.errors, warnings: response.data.warnings },
        source: 'backend',
      });
    } catch (error) {
      // Keep the local verdict; the backend is only reachable when MongoDB is up.
      if (error.response?.status === 400 && Array.isArray(error.response.data?.error?.details)) {
        setValidation({
          result: { errors: error.response.data.error.details, warnings: error.response.data.error.warnings ?? [] },
          source: 'backend',
        });
      }
    } finally {
      setValidating(false);
    }
  }

  function exportJson() {
    const { viewport } = flow.toObject();
    const payload = serializeGraph(name, nodes, edges, viewport);
    exportRef.current = toJsonString(payload);
    downloadJson(payload, graphFilename(payload.name));
    setNotice({
      type: 'success',
      message: `Exported ${payload.nodes.length} nodes and ${payload.edges.length} edges as JSON.`,
      action: {
        label: 'Copy JSON',
        onClick: async () => {
          const copied = await copyText(exportRef.current);
          setNotice({ type: copied ? 'success' : 'error', message: copied ? 'Graph JSON copied to your clipboard.' : 'Could not access the clipboard.' });
        },
      },
    });
  }

  const showInvalidConnection = useCallback((reason) => {
    setNotice({ type: 'error', message: reason ?? 'That connection is not allowed.' });
  }, []);

  return (
    <div className="app-shell">
      <Navbar
        health={health}
        onSave={saveGraph}
        onLoad={openPicker}
        onValidate={runValidation}
        onExport={exportJson}
        saving={saving}
        validating={validating}
      />

      <div className="editor-body">
        <NodePalette onAddNode={handlePaletteClick} />
        <main className="work-area">
          <div className="work-header">
            <div className="work-title">
              <div className="work-breadcrumb"><span>WORKSPACE</span><ChevronRight size={12} /><span>FLOW EDITOR</span></div>
              <div className="name-row">
                <input ref={nameRef} aria-label="Graph name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
                <PencilLine size={15} />
                <span className="draft-badge"><i /> DRAFT</span>
              </div>
              <p>Bring your data and ideas together, one node at a time.</p>
            </div>
            <div className="work-meta">
              <div><strong>{String(nodes.length).padStart(2, '0')}</strong><span>NODES</span></div>
              <i />
              <div><strong>{String(edges.length).padStart(2, '0')}</strong><span>CONNECTIONS</span></div>
            </div>
          </div>

          {validation && (
            <ValidationPanel
              result={validation.result}
              source={validation.source}
              onClose={() => setValidation(null)}
              onSelectNode={focusNode}
            />
          )}

          <FlowCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={handleDrop}
            onInvalidConnection={showInvalidConnection}
            canvasRef={canvasRef}
          />

          <div className="workspace-footer">
            <span><i /> CANVAS MODE <b> / </b> FLOW EDITOR</span>
            <span><CircleHelp size={14} /> Select a node or edge and press Delete to remove it.</span>
            <span>MADE TO FLOW <span className="footer-star">✳</span></span>
          </div>
        </main>
        <FlowInspector nodes={nodes} edges={edges} selectedNode={selectedNode} onRemoveNode={removeNode} socketStatus={socketStatus} readings={readings} />
      </div>

      {pickerOpen && (
        <GraphPicker graphs={graphs} loading={listLoading} error={listError} busyId={loadingId} onSelect={loadGraph} onRetry={fetchGraphs} onClose={closePicker} />
      )}

      {notice && (
        <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          <span>{notice.message}</span>
          {notice.action && <button className="toast-action" onClick={notice.action.onClick}>{notice.action.label}</button>}
          <button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
```
## `client/src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ---------------------------------------------------------------------------
   NexusFlow design tokens
   --------------------------------------------------------------------------- */
:root {
  --page: #f0f5f4;
  --panel: #fbfdfc;
  --line: #dde5e3;
  --ink: #203640;
  --ink-soft: #648c8b;
  --teal: #177b79;
  --teal-soft: #d3eae5;
  --amber: #e9a13b;
  --radius-lg: 18px;
  --radius-md: 12px;
  --shadow-panel: 0 1px 2px rgba(32, 54, 64, 0.05);
  --shadow-pop: 0 18px 40px rgba(32, 54, 64, 0.16);
}

@layer base {
  html,
  body,
  #root {
    height: 100%;
  }

  body {
    margin: 0;
    background:
      radial-gradient(circle at 12% 12%, rgba(255, 255, 255, 0.9), transparent 45%),
      radial-gradient(circle at 88% 0%, rgba(211, 234, 229, 0.75), transparent 40%),
      var(--page);
    color: var(--ink);
    font-family: 'Manrope Variable', 'Manrope', system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  h1,
  h2,
  h3 {
    margin: 0;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  button {
    font: inherit;
  }

  input {
    font: inherit;
    color: inherit;
  }

  code {
    font-family: 'DM Mono', ui-monospace, monospace;
  }
}

@layer components {
  /* ---------------- Shell ---------------- */
  .app-shell {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    overflow: hidden;
  }

  .editor-body {
    display: grid;
    grid-template-columns: 268px minmax(0, 1fr) 300px;
    gap: 14px;
    flex: 1 1 auto;
    min-height: 0;
    padding: 14px;
  }

  /* ---------------- Navbar ---------------- */
  .navbar {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px 22px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    box-shadow: var(--shadow-panel);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .brand-mark {
    display: grid;
    grid-template-columns: repeat(2, 12px);
    grid-template-rows: repeat(2, 12px);
    gap: 2px;
  }

  .brand-mark span {
    border-radius: 3px;
    background: var(--teal);
  }

  .brand-mark span:nth-child(2) {
    background: var(--amber);
  }

  .brand-copy strong {
    display: block;
    font-size: 18px;
    line-height: 1.1;
  }

  .brand-copy small {
    display: block;
    font-size: 9px;
    letter-spacing: 0.18em;
    color: var(--ink-soft);
  }

  .nav-breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 18px;
    border-left: 1px solid var(--line);
    font-size: 13px;
    color: var(--ink-soft);
  }

  .nav-breadcrumb strong {
    color: var(--ink);
    font-weight: 600;
  }

  .nav-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
  }

  .nav-divider {
    width: 1px;
    height: 24px;
    background: var(--line);
  }

  .health {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: #fff;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .health-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: #b6c4c3;
  }

  .health.online .health-dot {
    background: #2f9e6d;
    box-shadow: 0 0 0 3px rgba(47, 158, 109, 0.16);
  }

  .health.offline .health-dot {
    background: #d7654f;
    box-shadow: 0 0 0 3px rgba(215, 101, 79, 0.16);
  }

  .health.checking .health-dot {
    background: var(--amber);
    box-shadow: 0 0 0 3px rgba(233, 161, 59, 0.18);
  }

  /* ---------------- Buttons ---------------- */
  .button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 15px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: #fff;
    color: var(--ink);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
  }

  .button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(32, 54, 64, 0.12);
  }

  .button:disabled {
    opacity: 0.7;
    cursor: default;
  }

  .button:focus-visible,
  .icon-button:focus-visible,
  .palette-item:focus-visible,
  .graph-option:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }

  .button-primary {
    background: var(--teal);
    border-color: var(--teal);
    color: #fff;
  }

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: #fff;
    color: var(--ink-soft);
    cursor: pointer;
  }

  .icon-button:hover {
    color: var(--ink);
  }

  .spin {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ---------------- Panel base ---------------- */
  .palette,
  .inspector {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 18px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line);
    background: var(--panel);
    box-shadow: var(--shadow-panel);
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--ink-soft);
  }

  .eyebrow-line {
    width: 14px;
    height: 1px;
    background: var(--ink-soft);
  }

  .heading-period {
    color: var(--amber);
  }

  /* ---------------- Palette ---------------- */
  .palette-heading h2 {
    margin: 8px 0 6px;
    font-size: 22px;
  }

  .palette-heading p {
    margin: 0 0 14px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .palette-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 11px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: #fff;
    color: var(--ink-soft);
  }

  .palette-search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13px;
    color: var(--ink);
  }

  .palette-search button {
    display: inline-flex;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    color: var(--ink-soft);
  }

  .search-shortcut {
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--page);
    font-size: 10px;
    font-family: 'DM Mono', monospace;
  }

  .palette-groups {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 16px;
    overflow-y: auto;
    flex: 1 1 auto;
    min-height: 0;
    padding-right: 2px;
  }

  .palette-empty {
    margin: 0;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .group-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--ink-soft);
  }

  .group-heading h3 {
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .palette-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .palette-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: #fff;
    text-align: left;
    cursor: grab;
    transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
  }

  .palette-item:hover {
    transform: translateY(-1px);
    border-color: var(--teal-soft);
    box-shadow: 0 8px 18px rgba(32, 54, 64, 0.1);
  }

  .palette-item:active {
    cursor: grabbing;
  }

  .palette-item-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .palette-item-copy strong {
    font-size: 13px;
    font-weight: 600;
  }

  .palette-item-copy small {
    font-size: 11px;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .grip {
    color: #b6c4c3;
  }

  .node-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    border-radius: 10px;
    background: var(--page);
    color: var(--teal);
  }

  .node-icon.source {
    background: var(--teal-soft);
    color: #146a68;
  }

  .node-icon.math {
    background: #dfeaf9;
    color: #2f5f9e;
  }

  .node-icon.action {
    background: #fbead6;
    color: #a86a1a;
  }

  .palette-tip {
    display: flex;
    gap: 10px;
    margin-top: 14px;
    padding: 11px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: #fff;
  }

  .tip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    border-radius: 8px;
    background: var(--teal-soft);
    color: var(--teal);
  }

  .palette-tip strong {
    display: block;
    font-size: 12px;
  }

  .palette-tip p {
    margin: 2px 0 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--ink-soft);
  }

  .palette-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px dashed var(--line);
    font-size: 9px;
    letter-spacing: 0.18em;
    color: var(--ink-soft);
  }

  /* ---------------- Work area ---------------- */
  .work-area {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    gap: 12px;
  }

  .work-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line);
    background: var(--panel);
    box-shadow: var(--shadow-panel);
  }

  .work-breadcrumb {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--ink-soft);
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-top: 6px;
    color: var(--ink-soft);
  }

  .name-row input {
    min-width: 0;
    flex: 0 1 auto;
    padding: 2px 0;
    border: none;
    background: transparent;
    outline: none;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .name-row input:focus {
    border-bottom: 2px solid var(--teal);
  }

  .draft-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: #fff;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: var(--ink-soft);
  }

  .draft-badge i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--amber);
  }

  .work-header p {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .work-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    flex: 0 0 auto;
  }

  .work-meta div {
    text-align: center;
  }

  .work-meta strong {
    display: block;
    font-size: 20px;
  }

  .work-meta span {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--ink-soft);
  }

  .work-meta i {
    width: 1px;
    height: 26px;
    background: var(--line);
  }

  .canvas-wrap {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line);
    background: #f2f7f6;
    box-shadow: var(--shadow-panel);
    overflow: hidden;
  }

  .canvas-label {
    position: absolute;
    top: 14px;
    left: 16px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 11px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.9);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: var(--ink-soft);
    backdrop-filter: blur(6px);
  }

  .canvas-label i {
    width: 1px;
    height: 12px;
    background: var(--line);
  }

  .canvas-label-icon {
    color: var(--teal);
  }

  .canvas-hint {
    position: absolute;
    right: 16px;
    top: 14px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 11px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.9);
    font-size: 11px;
    color: var(--ink-soft);
  }

  .canvas-hint i {
    width: 1px;
    height: 12px;
    background: var(--line);
  }

  .workspace-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 16px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line);
    background: var(--panel);
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--ink-soft);
    box-shadow: var(--shadow-panel);
  }

  .workspace-footer i {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 999px;
    background: var(--teal);
    vertical-align: middle;
  }

  .workspace-footer b {
    color: var(--line);
  }

  .workspace-footer span:nth-child(2) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    letter-spacing: 0.06em;
    text-transform: none;
  }

  .footer-star {
    color: var(--amber);
  }

  /* ---------------- React Flow node ---------------- */
  .flow-node {
    width: 246px;
    padding: 12px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: #fff;
    box-shadow: 0 10px 24px rgba(32, 54, 64, 0.1);
    transition: box-shadow 0.15s ease, border-color 0.15s ease;
  }

  .flow-node.is-selected {
    border-color: var(--teal);
    box-shadow: 0 0 0 3px rgba(23, 123, 121, 0.16), 0 12px 26px rgba(32, 54, 64, 0.14);
  }

  .flow-node-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: var(--ink-soft);
  }

  .flow-node-top span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .flow-node-top i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--teal);
  }

  .flow-node.math .flow-node-top i {
    background: #3f76bd;
  }

  .flow-node.action .flow-node-top i {
    background: var(--amber);
  }

  .flow-node-main {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 0;
  }

  .flow-node-main strong {
    display: block;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
  }

  .flow-node-main small {
    display: block;
    font-size: 11px;
    color: var(--ink-soft);
  }

  .flow-node-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: var(--ink-soft);
  }

  .node-footer-dots {
    letter-spacing: 0.1em;
  }

  .react-flow__handle {
    width: 11px;
    height: 11px;
    border: 2px solid #fff;
    background: var(--teal);
  }

  .react-flow__controls-button {
    border-bottom: 1px solid var(--line);
    background: #fff;
    color: var(--ink-soft);
  }

  .react-flow__controls-button:hover {
    background: var(--page);
  }

  .react-flow__minimap {
    border-radius: 12px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.92);
  }

  .react-flow__edge-path {
    stroke-linecap: round;
  }

  /* ---------------- Inspector ---------------- */
  .inspector-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .inspector-number {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: var(--ink-soft);
  }

  .inspector-title {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin: 10px 0 14px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
    color: var(--ink-soft);
  }

  .inspector-title h2 {
    font-size: 20px;
  }

  .inspector-title p {
    margin: 4px 0 0;
    font-size: 12px;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .stat-card {
    position: relative;
    padding: 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: #fff;
  }

  .stat-card strong {
    display: block;
    margin-top: 8px;
    font-size: 24px;
    line-height: 1;
  }

  .stat-card small {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .stat-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--teal-soft);
    color: var(--teal);
  }

  .inspector-section {
    margin-top: 18px;
  }

  .section-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: var(--ink-soft);
  }

  .selected-section {
    padding: 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: #fff;
  }

  .selected-node-title {
    font-size: 15px;
    font-weight: 700;
  }

  .selected-section p {
    margin: 4px 0 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .remove-node {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 11px;
    border-radius: 9px;
    border: 1px solid #f0cfc5;
    background: #fdf2ef;
    color: #b9523a;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .remove-node:hover {
    background: #fbe6e0;
  }

  .checklist {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .checklist-row {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .check-circle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: #fff;
    color: #b6c4c3;
  }

  .check-circle.done {
    border-color: #bfe3d1;
    background: #e9f7f0;
    color: #2f9e6d;
  }

  .checklist-state {
    margin-left: auto;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.16em;
  }

  .telemetry-section {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1 1 auto;
  }

  .socket-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .socket-badge i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #b6c4c3;
  }

  .socket-badge.connected {
    color: #2f9e6d;
  }

  .socket-badge.connected i {
    background: #2f9e6d;
  }

  .socket-badge.connecting i,
  .socket-badge.checking i {
    background: var(--amber);
  }

  .socket-badge.disconnected {
    color: #b9523a;
  }

  .socket-badge.disconnected i {
    background: #b9523a;
  }

  .reading-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .reading-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: #fff;
  }

  .reading-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    border-radius: 8px;
    background: var(--teal-soft);
    color: var(--teal);
  }

  .reading-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .reading-copy strong {
    font-size: 12px;
    text-transform: capitalize;
  }

  .reading-copy small {
    font-size: 10px;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reading-value {
    font-family: 'DM Mono', monospace;
    font-size: 14px;
    font-weight: 500;
  }

  .reading-value small {
    font-size: 10px;
    color: var(--ink-soft);
  }

  .telemetry-empty {
    padding: 16px 14px;
    border-radius: var(--radius-md);
    border: 1px dashed var(--line);
    background: #fff;
    text-align: center;
  }

  .telemetry-empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 999px;
    background: var(--teal-soft);
    color: var(--teal);
  }

  .telemetry-empty strong {
    display: block;
    margin-top: 9px;
    font-size: 13px;
  }

  .telemetry-empty p {
    margin: 4px 0 10px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .telemetry-empty code {
    display: inline-block;
    padding: 5px 9px;
    border-radius: 7px;
    background: var(--page);
    font-size: 11px;
    color: var(--ink);
  }

  .inspector-note {
    display: flex;
    gap: 10px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px dashed var(--line);
  }

  .note-star {
    color: var(--amber);
  }

  .inspector-note strong {
    display: block;
    font-size: 12px;
  }

  .inspector-note p {
    margin: 3px 0 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  /* ---------------- Modal ---------------- */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(32, 54, 64, 0.32);
    backdrop-filter: blur(3px);
  }

  .modal {
    width: min(480px, 100%);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    border-radius: 20px;
    border: 1px solid var(--line);
    background: var(--panel);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }

  .modal-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    padding: 20px 20px 16px;
    border-bottom: 1px solid var(--line);
  }

  .modal-heading h2 {
    margin: 8px 0 4px;
    font-size: 22px;
  }

  .modal-heading p {
    margin: 0;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .modal-content {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 16px 20px;
    overflow-y: auto;
    min-height: 120px;
  }

  .modal-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 140px;
    text-align: center;
    font-size: 13px;
    color: var(--ink-soft);
  }

  .modal-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--line);
    font-size: 11px;
    color: var(--ink-soft);
  }

  .graph-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: #fff;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
  }

  .graph-option:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: var(--teal-soft);
    box-shadow: 0 8px 18px rgba(32, 54, 64, 0.1);
  }

  .graph-option:disabled {
    opacity: 0.7;
    cursor: default;
  }

  .graph-option-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    border-radius: 10px;
    background: var(--teal-soft);
    color: var(--teal);
  }

  .graph-option-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .graph-option-copy strong {
    font-size: 13px;
  }

  .graph-option-copy small {
    font-size: 11px;
    color: var(--ink-soft);
  }

  /* ---------------- Toast ---------------- */
  .toast {
    position: fixed;
    bottom: 22px;
    left: 50%;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: #fff;
    box-shadow: var(--shadow-pop);
    font-size: 13px;
    transform: translateX(-50%);
    animation: toast-in 0.18s ease-out;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }

  .toast.success {
    border-color: #bfe3d1;
    color: #1f7a52;
  }

  .toast.error {
    border-color: #f0cfc5;
    color: #b9523a;
  }

  .toast button {
    border: none;
    background: none;
    padding: 0;
    margin-left: 4px;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }
}

  /* ---------------- Node config fields (Day 2) ---------------- */
  .node-headings {
    min-width: 0;
  }

  .node-headings strong {
    display: block;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
  }

  .node-headings small {
    display: block;
    font-size: 11px;
    color: var(--ink-soft);
    overflow-wrap: anywhere;
  }

  .node-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }

  .node-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .node-field > span {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .node-input {
    width: 100%;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--page);
    font-size: 12px;
    font-weight: 500;
    color: var(--ink);
    outline: none;
    transition: border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
  }

  .node-input:focus {
    border-color: var(--teal);
    background: #fff;
    box-shadow: 0 0 0 3px rgba(23, 123, 121, 0.12);
  }

  .node-input.is-select {
    appearance: none;
    cursor: pointer;
    background-image: linear-gradient(45deg, transparent 50%, var(--ink-soft) 50%), linear-gradient(135deg, var(--ink-soft) 50%, transparent 50%);
    background-position: calc(100% - 14px) 13px, calc(100% - 9px) 13px;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
  }

  .flow-node.source {
    border-top: 3px solid #2f6fb3;
  }

  .flow-node.math {
    border-top: 3px solid #b57a1a;
  }

  .flow-node.action {
    border-top: 3px solid #b9523a;
  }

  .button-ghost {
    background: #fff;
  }

  .icon-button.small {
    width: 26px;
    height: 26px;
  }

  /* ---------------- Validation panel (Day 2) ---------------- */
  .validation-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: #fff;
    box-shadow: var(--shadow-panel);
  }

  .validation-panel.is-valid {
    border-color: #bfe3d1;
    background: #f4fbf7;
  }

  .validation-panel.is-invalid {
    border-color: #f0cfc5;
    background: #fdf5f2;
  }

  .validation-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .validation-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .validation-panel.is-valid .validation-title {
    color: #1f7a52;
  }

  .validation-panel.is-invalid .validation-title {
    color: #b9523a;
  }

  .validation-source {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .validation-ok {
    margin: 0;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .validation-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .validation-list li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.45;
  }

  .validation-list.errors li {
    color: #a4442e;
  }

  .validation-list.warnings li {
    color: #8a6a20;
  }

  .validation-link {
    margin-left: auto;
    border: none;
    background: none;
    padding: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--teal);
    text-decoration: underline;
    white-space: nowrap;
    cursor: pointer;
  }

  .validation-warnings summary {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ink-soft);
    cursor: pointer;
  }

  .validation-warnings .validation-list {
    margin-top: 8px;
  }

  .toast-action {
    border: 1px solid currentColor;
    border-radius: 8px;
    padding: 4px 9px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .toast-action:hover {
    background: rgba(32, 54, 64, 0.06);
  }

@media (max-width: 1180px) {
  .editor-body {
    grid-template-columns: 240px minmax(0, 1fr);
  }

  /* Keep the canvas in view; the inspector scrolls below the editor. */
  .inspector {
    display: none;
  }
}

@media (max-width: 900px) {
  .editor-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .palette {
    max-height: 280px;
  }

  .nav-breadcrumb {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

