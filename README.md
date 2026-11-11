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
