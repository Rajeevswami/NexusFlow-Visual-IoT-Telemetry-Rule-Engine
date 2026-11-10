# NexusFlow — complete source, file by file

Every file in this repository is reproduced below in the same order as the folder tree
in `README.md`. Generated from the working tree on branch
`arena/4ef990b6-nexusflow-visual-iot-telemetry` — `README.md` is the first entry.

## `README.md`

```md
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

## 9. Notes on this build

* Ingestion acknowledgment is tied to a successful database write; the WebSocket broadcast is
  separate and best-effort by design.
* `Device` is modelled now and left unused for Day 1 — device registration endpoints land with the
  rule compiler.
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
    "test": "node --test"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.6.1",
    "express": "^4.22.1",
    "helmet": "^8.1.0",
    "mongoose": "^8.24.8",
    "morgan": "^1.10.1",
    "ws": "^8.22.2",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "nodemon": "^3.1.11",
    "supertest": "^7.2.2"
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

## `server/src/controllers/telemetryController.js`

```js
import { Telemetry } from '../models/Telemetry.js';
import { broadcastTelemetry } from '../services/websocket.js';

async function insertAndAccept(readings, res, single = false) {
  // Zod has already validated/cast the complete payload. lean avoids a second
  // Mongoose hydration/validation pass on this high-throughput path.
  const inserted = await Telemetry.insertMany(readings, { ordered: false, lean: true });
  res.status(202).json({ accepted: inserted.length });
  // WebSocket notifications are best-effort and must not delay the HTTP response.
  setImmediate(() => {
    try { broadcastTelemetry(single ? inserted[0] : inserted); }
    catch (error) { console.error('WebSocket broadcast failed:', error.message); }
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
import { createGraph, deleteGraph, getGraph, listGraphs, updateGraph } from '../controllers/graphController.js';
import { asyncHandler, validate } from '../middleware/validate.js';
import { graphIdSchema, graphSchema } from '../validation/graph.js';

const router = Router();
router.route('/').post(validate(graphSchema), asyncHandler(createGraph)).get(asyncHandler(listGraphs));
router.route('/:id')
  .all(validate(graphIdSchema, 'params'))
  .get(asyncHandler(getGraph))
  .put(validate(graphSchema), asyncHandler(updateGraph))
  .delete(asyncHandler(deleteGraph));
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

/** Best-effort delivery: a slow client must never block ingestion or consume unbounded memory. */
export function broadcastTelemetry(data) {
  if (!socketServer || socketServer.clients.size === 0) return;
  const message = JSON.stringify({ type: 'telemetry', data });
  for (const socket of socketServer.clients) {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > maxBufferedBytes) continue;
    socket.send(message, (error) => {
      if (error) console.error('WebSocket broadcast failed:', error.message);
    });
  }
}
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
};

export function errorMessage(error) {
  return error.response?.data?.error?.message || (error.code === 'ECONNABORTED' ? 'The request timed out.' : 'Cannot reach the backend. Check that the server and MongoDB are running.');
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

## `client/src/components/canvas/nodeLibrary.js`

```js
import { Activity, BellRing, ChartNoAxesCombined, Fan, Thermometer, Webhook } from 'lucide-react';

export const groups = [
  { id: 'source', label: 'Data sources', nodes: [
    { kind: 'turbine', label: 'Turbine Sensor', description: 'Stream turbine data', icon: Fan, tag: 'SENSOR INPUT', category: 'source' },
    { kind: 'temperature', label: 'Temperature Sensor', description: 'Monitor temperature', icon: Thermometer, tag: 'SENSOR INPUT', category: 'source' },
  ] },
  { id: 'math', label: 'Math operations', nodes: [
    { kind: 'average', label: 'Moving Average', description: 'Smooth out readings', icon: ChartNoAxesCombined, tag: 'TRANSFORM', category: 'math' },
    { kind: 'threshold', label: 'Threshold', description: 'Set a trigger point', icon: Activity, tag: 'CONDITION', category: 'math' },
  ] },
  { id: 'action', label: 'Action triggers', nodes: [
    { kind: 'sms', label: 'SMS Alert', description: 'Send a notification', icon: BellRing, tag: 'NOTIFICATION', category: 'action' },
    { kind: 'webhook', label: 'Webhook', description: 'Send data to a URL', icon: Webhook, tag: 'HTTP REQUEST', category: 'action' },
  ] },
];

export const nodeDefinitions = Object.fromEntries(groups.flatMap((group) => group.nodes.map((node) => [node.kind, node])));

export function makeNode(kind, position, id) {
  const definition = nodeDefinitions[kind];
  return {
    id,
    type: 'nexus',
    position,
    data: { kind, label: definition.label, category: definition.category, description: definition.description },
  };
}

export const initialNodes = [
  makeNode('turbine', { x: 0, y: 70 }, 'sample-turbine'),
  makeNode('average', { x: 300, y: 70 }, 'sample-average'),
  makeNode('sms', { x: 600, y: 70 }, 'sample-sms'),
];
export const initialEdges = [
  { id: 'sample-edge-1', source: 'sample-turbine', target: 'sample-average', type: 'smoothstep' },
  { id: 'sample-edge-2', source: 'sample-average', target: 'sample-sms', type: 'smoothstep' },
];
```

## `client/src/components/canvas/NodePalette.jsx`

```jsx
import { GripVertical, MousePointer2, Search, X } from 'lucide-react';
import { useState } from 'react';
import { groups } from './nodeLibrary.js';

export default function NodePalette({ onAddNode }) {
  const [search, setSearch] = useState('');
  const matches = groups.map((group) => ({
    ...group,
    nodes: group.nodes.filter((node) => `${node.label} ${node.description}`.toLowerCase().includes(search.toLowerCase().trim())),
  })).filter((group) => group.nodes.length);

  function startDrag(event, kind) {
    event.dataTransfer.setData('application/nexusflow-node', kind);
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
            <div className="group-heading"><h3>{group.label}</h3><span>{String(group.nodes.length).padStart(2, '0')}</span></div>
            <div className="palette-items">
              {group.nodes.map((node) => (
                <button type="button" className="palette-item" key={node.kind} draggable
                  onDragStart={(event) => startDrag(event, node.kind)} onClick={() => onAddNode(node.kind)}
                  title={`Drag or click to add ${node.label}`}>
                  <span className={`node-icon ${node.category}`}><node.icon size={18} strokeWidth={1.8} /></span>
                  <span className="palette-item-copy"><strong>{node.label}</strong><small className="truncate">{node.description}</small></span>
                  <GripVertical className="grip" size={15} aria-hidden="true" />
                </button>
              ))}
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
import FlowNode from './FlowNode.jsx';

const nodeTypes = { nexus: FlowNode };
const edgeOptions = { type: 'smoothstep', style: { stroke: '#94aaa9', strokeWidth: 2 } };

export default function FlowCanvas({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onDrop, canvasRef }) {
  return (
    <div className="canvas-wrap" ref={canvasRef} onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange} onConnect={onConnect} defaultEdgeOptions={edgeOptions}
        connectionLineStyle={{ stroke: '#418d8a', strokeWidth: 2 }}
        isValidConnection={(connection) => connection.source !== connection.target}
        fitView fitViewOptions={{ padding: 0.24, maxZoom: 1 }} minZoom={0.25} maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: false }}>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#cbd8d7" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={3}
          nodeColor={(node) => node.data.category === 'math' ? '#cddff6' : node.data.category === 'action' ? '#f5ddc4' : '#bfe4db'}
          maskColor="rgba(242, 247, 246, .72)" />
      </ReactFlow>
      <div className="canvas-label select-none"><span className="canvas-label-icon"><Sparkles size={13} /></span><span>YOUR WORKSPACE</span><i /><span>READY TO CREATE</span></div>
      <div className="canvas-hint select-none"><MousePointer2 size={14} /> <span>Drag to pan</span><i /> <span>Scroll to zoom</span></div>
    </div>
  );
}
```

## `client/src/components/layout/Navbar.jsx`

```jsx
import { ChevronRight, FolderOpen, LoaderCircle, Save } from 'lucide-react';

export default function Navbar({ health, onSave, onLoad, saving }) {
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
        <button className="button button-secondary" onClick={onLoad}><FolderOpen size={16} /><span>Load graph</span></button>
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

## `client/src/pages/EditorPage.jsx`

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { addEdge, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, PencilLine, X } from 'lucide-react';
import FlowCanvas from '../components/canvas/FlowCanvas.jsx';
import NodePalette from '../components/canvas/NodePalette.jsx';
import { initialEdges, initialNodes, makeNode, nodeDefinitions } from '../components/canvas/nodeLibrary.js';
import FlowInspector from '../components/FlowInspector.jsx';
import GraphPicker from '../components/GraphPicker.jsx';
import Navbar from '../components/layout/Navbar.jsx';
import { errorMessage, graphApi } from '../services/api.js';
import { useTelemetry } from '../services/useTelemetry.js';

export default function EditorPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [name, setName] = useState('Turbine monitoring');
  const [health, setHealth] = useState('checking');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [graphs, setGraphs] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [loadingId, setLoadingId] = useState('');
  const [notice, setNotice] = useState(null);
  const canvasRef = useRef(null);
  const nameRef = useRef(null);
  const flow = useReactFlow();
  const { socketStatus, readings } = useTelemetry();
  const selectedNode = nodes.find((node) => node.selected);

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
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const onConnect = useCallback((connection) => setEdges((current) => addEdge({ ...connection, type: 'smoothstep' }, current)), [setEdges]);

  function addNode(kind, position) {
    if (!nodeDefinitions[kind]) return;
    const id = `${kind}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    setNodes((current) => [...current, makeNode(kind, position, id)]);
  }

  function handleDrop(event) {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/nexusflow-node');
    if (!nodeDefinitions[kind]) return;
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(kind, { x: position.x - 110, y: position.y - 40 });
  }

  function handlePaletteClick(kind) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    addNode(kind, { x: position.x - 110, y: position.y - 40 });
  }

  function removeNode(id) {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
  }

  async function saveGraph() {
    if (!name.trim()) {
      setNotice({ type: 'error', message: 'Give your graph a name before saving.' });
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const { nodes: savedNodes, edges: savedEdges, viewport } = flow.toObject();
      await graphApi.create({ name: name.trim(), nodes: savedNodes, edges: savedEdges, viewport });
      setName(name.trim());
      setNotice({ type: 'success', message: 'Graph saved. Nice work!' });
    } catch (error) { setNotice({ type: 'error', message: errorMessage(error) }); }
    finally { setSaving(false); }
  }

  async function fetchGraphs() {
    setListLoading(true);
    setListError('');
    try { const response = await graphApi.list(); setGraphs(response.data.data); }
    catch (error) { setListError(errorMessage(error)); }
    finally { setListLoading(false); }
  }

  function openPicker() { setPickerOpen(true); fetchGraphs(); }
  const closePicker = useCallback(() => setPickerOpen(false), []);

  async function loadGraph(id) {
    setLoadingId(id);
    try {
      const response = await graphApi.get(id);
      const graph = response.data.data;
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setName(graph.name);
      setPickerOpen(false);
      // Wait for controlled nodes to render before restoring the saved viewport.
      requestAnimationFrame(() => {
        if (graph.viewport) flow.setViewport(graph.viewport, { duration: 300 });
        else flow.fitView({ padding: 0.24, maxZoom: 1, duration: 300 });
      });
      setNotice({ type: 'success', message: 'Graph loaded onto your canvas.' });
    } catch (error) { setListError(errorMessage(error)); }
    finally { setLoadingId(''); }
  }

  return (
    <div className="app-shell">
      <Navbar health={health} onSave={saveGraph} onLoad={openPicker} saving={saving} />
      <div className="editor-body">
        <NodePalette onAddNode={handlePaletteClick} />
        <main className="work-area">
          <div className="work-header">
            <div className="work-title">
              <div className="work-breadcrumb"><span>WORKSPACE</span><ChevronRight size={12} /><span>FLOW EDITOR</span></div>
              <div className="name-row"><input ref={nameRef} aria-label="Graph name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /><PencilLine size={15} /><span className="draft-badge"><i /> DRAFT</span></div>
              <p>Bring your data and ideas together, one node at a time.</p>
            </div>
            <div className="work-meta"><div><strong>{String(nodes.length).padStart(2, '0')}</strong><span>NODES</span></div><i /><div><strong>{String(edges.length).padStart(2, '0')}</strong><span>CONNECTIONS</span></div></div>
          </div>
          <FlowCanvas nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onDrop={handleDrop} canvasRef={canvasRef} />
          <div className="workspace-footer"><span><i /> CANVAS MODE <b> / </b> FLOW EDITOR</span><span><CircleHelp size={14} /> Select a node or edge and press Delete to remove it.</span><span>MADE TO FLOW <span className="footer-star">✳</span></span></div>
        </main>
        <FlowInspector nodes={nodes} edges={edges} selectedNode={selectedNode} onRemoveNode={removeNode} socketStatus={socketStatus} readings={readings} />
      </div>
      {pickerOpen && <GraphPicker graphs={graphs} loading={listLoading} error={listError} busyId={loadingId} onSelect={loadGraph} onRetry={fetchGraphs} onClose={closePicker} />}
      {notice && <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'error' ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}<span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={16} /></button></div>}
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
    width: 220px;
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

