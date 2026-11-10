# NexusFlow — Visual IoT Telemetry & Rule Engine

NexusFlow lets non-technical users build IoT rules visually on a drag-and-drop canvas
(for example **Turbine Sensor → Moving Average → SMS Alert**). Later milestones compile that
graph into RxJS streams and run it against high-frequency telemetry.

**Day 1 scope (this repository):** the time-series storage layer, the high-speed ingestion API,
the WebSocket fan-out, and the React Flow editor scaffold with graph persistence.

---

## 1. Tech stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 20+ (ES modules everywhere) |
| API | Express 4, Mongoose 8 |
| Validation | Zod |
| Realtime | `ws` (attached to the same HTTP server on `/ws`) |
| Database | MongoDB **5.0+** native **time-series** collections |
| Frontend | React 19 + Vite 6, `@xyflow/react` 12, Axios, Tailwind CSS 3 |
| Utilities | dotenv, cors, helmet, morgan |

---

## 2. Folder structure

```
NexusFlow-Visual-IoT-Telemetry-Rule-Engine
├── README.md
├── .gitignore
│
├── server/
│   ├── package.json
│   ├── .env.example
│   ├── scripts/
│   │   ├── simulator.js            # mock hardware: N devices, anomaly spikes, batched POSTs
│   │   └── benchmark.js            # throughput harness (target: 5,000 writes/sec)
│   ├── test/
│   │   ├── validation.test.js      # runs with no database (schema + HTTP behaviour)
│   │   └── integration.test.js     # real MongoDB, skipped unless TEST_MONGODB_URI is set
│   └── src/
│       ├── server.js               # HTTP server bootstrap, WebSocket attach, graceful shutdown
│       ├── app.js                  # Express app: helmet, cors, morgan, routes, error handler
│       ├── config/
│       │   ├── env.js              # Zod-validated environment
│       │   └── db.js               # connection + time-series collection provisioning
│       ├── models/
│       │   ├── Telemetry.js        # points at the native `telemetry` time-series collection
│       │   ├── Device.js           # deviceId, name, type, location, createdAt
│       │   └── Graph.js            # name, nodes[], edges[], viewport, timestamps
│       ├── controllers/
│       │   ├── telemetryController.js
│       │   └── graphController.js
│       ├── routes/
│       │   ├── telemetryRoutes.js
│       │   └── graphRoutes.js
│       ├── services/
│       │   └── websocket.js        # /ws server, heartbeat, best-effort broadcast
│       ├── middleware/
│       │   ├── validate.js         # Zod validate + asyncHandler
│       │   └── errorHandler.js     # 404 + central error middleware
│       └── validation/
│           ├── telemetry.js        # reading / batch / query schemas
│           └── graph.js            # raw React Flow JSON schema
│
└── client/
    ├── package.json
    ├── .env.example
    ├── index.html
    ├── vite.config.js              # dev server + /api and /ws proxy
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── public/favicon.svg
    └── src/
        ├── main.jsx
        ├── App.jsx                 # <ReactFlowProvider>
        ├── index.css               # design tokens + component styles
        ├── pages/
        │   └── EditorPage.jsx      # full-screen editor, save/load, toasts
        ├── components/
        │   ├── canvas/
        │   │   ├── FlowCanvas.jsx  # React Flow: drop, connect, delete, zoom/pan
        │   │   ├── FlowNode.jsx    # custom node with handles
        │   │   ├── NodePalette.jsx # grouped, draggable palette
        │   │   └── nodeLibrary.js  # node definitions + seed graph
        │   ├── layout/
        │   │   └── Navbar.jsx      # brand, health pill, Save / Load
        │   ├── FlowInspector.jsx   # stats, checklist, live telemetry panel
        │   └── GraphPicker.jsx     # accessible "Load graph" modal
        └── services/
            ├── api.js              # Axios client + error normaliser
            └── useTelemetry.js     # same-origin WebSocket hook w/ reconnect
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

## 5. API reference

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
```

Clients that buffer more than 1 MB are skipped rather than slowing ingestion, and dead sockets are
reaped by a 30-second ping/pong heartbeat.

---

## 6. Simulator and benchmark

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

## 7. Frontend behaviour

* **Palette** — three groups (Data Sources, Math Operations, Action Triggers). Drag an item onto
  the canvas, or click it to drop it in the centre. Search box filters as you type.
* **Canvas** — drag to pan, scroll to zoom, MiniMap, Controls, dotted Background, smooth-step
  edges. Select a node or edge and press <kbd>Delete</kbd> / <kbd>Backspace</kbd> to remove it.
* **Toolbar** — editable graph name, live backend health pill, **Save graph** (`POST /api/graphs`
  with `flow.toObject()`) and **Load graph** (modal listing saved graphs; restores nodes, edges and
  viewport).
* **Inspector** — node/edge counts, a three-step build checklist, selected-node details with a
  remove action, and a live telemetry feed driven by the WebSocket.

---

## 8. Verification checklist

### 8.1 Start MongoDB, server and client

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

### 8.2 Confirm the time-series collection exists

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

### 8.3 Ingest a single reading and a batch

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

### 8.4 Verify the WebSocket endpoint

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

### 8.5 Save and load a graph from the UI

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

### 8.6 Automated tests

```bash
cd server
npm test                                   # schema + HTTP tests, no database needed
TEST_MONGODB_URI="mongodb://127.0.0.1:27017" npm test
# the integration suite creates a throwaway database and asserts the time-series
# options, the compound index, single/batch ingestion, the query endpoint,
# graph CRUD and the WebSocket connected/telemetry messages
```

---

## 9. Files

Every file's complete source, in the same order as the folder tree above, is collected in
[`CODE.md`](CODE.md).

## 10. Notes on this build

* Ingestion acknowledgment is tied to a successful database write; the WebSocket broadcast is
  separate and best-effort by design.
* `Device` is modelled now and left unused for Day 1 — device registration endpoints land with the
  rule compiler.
* The graph is stored as raw React Flow JSON (`Mixed`), so new node fields survive a round trip
  without a migration.
* The integration test is skipped unless `TEST_MONGODB_URI` is set, so `npm test` stays useful
  offline.
