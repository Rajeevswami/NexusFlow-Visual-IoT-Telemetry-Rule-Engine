# NexusFlow: Visual IoT Telemetry & Rule Engine

Visual IoT telemetry rules, compiled and evaluated as live RxJS streams.

[![Node.js](https://img.shields.io/badge/Node.js-22.22.2%2B-339933)](https://nodejs.org/) [![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/) [![MongoDB](https://img.shields.io/badge/MongoDB-Time--Series-47A248)](https://www.mongodb.com/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

NexusFlow is a browser-based, no-code graph editor and live dashboard for IoT telemetry. Users compose sensor, transformation, condition and action nodes; a server-side RxJS compiler evaluates the resulting graph against incoming readings. Alerts can trigger audited webhook, SMS and email deliveries.

> **Screenshot/GIF placeholder:** add authentic captures at `docs/screenshots/` (the expected filenames are listed in [the demo recording guide](docs/DEMO_VIDEO_SCRIPT.md)).

**Features:** visual React Flow authoring; HTTP/WebSocket ingestion; MongoDB time-series history; RxJS rules; live dashboard and alerts; mock and optional outbound actions with delivery auditing.

```text
 HTTP / WS ingestion -> validation -> MongoDB time-series
                            |             |
                            v             v
                     telemetryBus      history / stats
                            |
                   ruleExecutor routes by device + sensor
                            |
                     active RxJS graphs
                      /      |       \
                activity   alerts    bounded outbound queue
                   |         |        -> webhook / SMS / email
                   |         |        -> DeliveryLog / retry
                   v         v
              WebSocket channels -> editor glow / dashboard / alerts
```

## Features

- Batch and single-reading ingestion, time-series storage, historical queries and throughput benchmark.
- Visual React Flow rule authoring, validation, activation, test data, templates, undo/redo, duplicate and auto-layout.
- Live chart and alert feed; activity-enabled animated edges and nodes, value badges, light/dark themes, Live Mode and split-view demo.
- Templated webhooks with custom headers, mock SMS/email, optional Twilio/SMTP, cooldowns, bounded queue, per-graph limits, retry and delivery audit.
- Private-network SSRF blocking by default, ingestion API key, request limits, security headers, structured logging and graceful shutdown.
- Active graphs are re-hydrated from MongoDB on boot, with boot-time rehydration (see persistence limits below).

## Live demo

| | |
|---|---|
| Frontend | <https://your-app.vercel.app> *(placeholder — deploy with [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md))* |
| API health | <https://your-api.onrender.com/api/health> *(placeholder)* |
| API base URL | `https://your-api.onrender.com/api` *(placeholder)* |

No deployed instance was verified here. Configure mock SMS/email and the local mock receiver
for a credential-free demo; arbitrary webhook targets can still send data off-machine. Free-tier hosts sleep when idle — see
[Waking the server](docs/DEPLOYMENT.md#7-waking-the-server-before-a-demo).

## Screenshots

> Placeholders — replace each file with a real capture (1920×1080, dark theme) before
> submission. Keep the same filenames so the links keep working.

| Editor | Dashboard |
|---|---|
| `docs/screenshots/editor.png` (capture pending) | `docs/screenshots/dashboard.png` (capture pending) |

| Alerts & deliveries | Glowing wires during the demo |
|---|---|
| `docs/screenshots/alerts-delivery.png` (capture pending) | `docs/screenshots/canvas-glow.png` (capture pending) |

**Stack:** Node 22.22.2+ (22.x), Express, MongoDB 5.0+ (time-series), Mongoose, RxJS, WebSocket, React, Vite, React Flow, Recharts and Dagre.

## Quick start: Docker demo

```sh
docker compose up --build
# Open http://localhost:8080 ; click Run Demo in the editor.
# Optional historical data:
docker compose exec server npm run seed
# Stop; append -v only if you also want to delete MongoDB data.
docker compose down
```

The compose file explicitly enables private webhook destinations to let the server call its own mock receiver. **This is a local demo configuration, not a secure internet-facing deployment.** It has no user authentication or authorization; do not expose it or use real secrets. The demo runs for two minutes, raises a turbine temperature alarm and sends a webhook and mock SMS. Stop Demo ends it early. Starting the demo updates the saved turbine template graph. Mock SMS is the default and needs no credentials.

## Local development

Prerequisites: Node **22.22.2+ on the 22.x LTS line** (verified with 22.22.3), npm,
and MongoDB 7 running on port 27017. The declared engines also permit compatible
24.x/26+ versions, which were not tested here. Node 20 is no longer supported by
the installed test tools. From the repository root:

```sh
npm run install:all
cp server/.env.example server/.env
cp client/.env.example client/.env
npm run dev
# In a SECOND terminal at the repository root:
npm run dev:client
```

Open http://localhost:5173. On Windows use `copy` instead of `cp`.
For the local mock webhook demo only, edit `server/.env` to set
`ALLOW_PRIVATE_WEBHOOKS=true`; keep `SMS_PROVIDER=mock`, `MOCK_RECEIVER_ENABLED=true`
and `NODE_ACTIVITY_ENABLED=true`. Restart the API after changing its environment.
Optional seeding: `npm run seed` from the repository root.

The Vite proxy forwards `/api` and `/ws` to the backend. Set `VITE_PROXY_TARGET` in the client environment if the backend is elsewhere; browser requests remain same-origin. `VITE_API_BASE_URL` and `VITE_WS_URL` are optional overrides for separately hosted services. An ingestion key is required in production and must be sent as `x-api-key`; the editor's test-data button does not supply one, so use the simulator/API client when a key is enabled.

## Server environment

Defaults are shown; see `server/.env.example`. Never commit real credentials.

| Variable | Default / purpose |
|---|---|
| `NODE_ENV`, `PORT`, `MONGODB_URI`, `CLIENT_ORIGIN` | `development`, `5000`, local MongoDB, `http://localhost:5173`; origins comma-separated |
| `TELEMETRY_RETENTION_SECONDS` | unset; TTL at initial time-series collection creation |
| `NODE_ACTIVITY_ENABLED`, `LOG_LEVEL` | `true`, `info` |
| `REQUEST_SIZE_LIMIT` | `1mb` |
| `API_RATE_LIMIT`, `INGEST_RATE_LIMIT` | per-IP requests/minute: `300`, `6000` respectively |
| `INGEST_API_KEY` | empty in development; required in production for HTTP/WS ingestion |
| `ALLOW_PRIVATE_WEBHOOKS` | `false`; local demo override also permits other private destinations |
| `OUTBOUND_CONCURRENCY`, `OUTBOUND_QUEUE_LIMIT`, `OUTBOUND_RATE_PER_MINUTE` | `4`, `1000`, `30` per graph |
| `OUTBOUND_RETRY_BASE_MS` | `250` (backoffs 250 ms, 500 ms; max three attempts) |
| `SMS_PROVIDER` | `mock` or `twilio`; Twilio requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |
| `EMAIL_PROVIDER` | `mock` or `smtp`; SMTP uses `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` |
| `MOCK_RECEIVER_ENABLED`, `DEMO_ENABLED` | enabled outside production, otherwise opt in; do not expose demo endpoints publicly |
| `DEMO_WEBHOOK_URL` | local server mock receiver; private destinations require explicit opt-in |
| `TEST_MONGODB_URI` | dedicated disposable database for integration tests |

Non-HTTP(S) URLs are rejected even with the local-testing override. Webhook DNS is validated and pinned for each attempt; redirects are not followed. GET requests have no JSON body. Requests time out after 5 seconds; network and 5xx failures retry, not 4xx. The receiver is in-memory and intended only for demos. Delivery request snapshots are persisted for manual retry and can contain credentials or message content: protect the database and its backups, and use dedicated non-sensitive demo values. API responses mask targets and do not return snapshots.

## API reference

JSON unless noted. Errors have `{ "error": { "message", "code", "requestId", "details"? } }`; most endpoints return `{data: ...}`. Consult the route validators for exact fields and limits.

| Method and path | Purpose |
|---|---|
| GET `/api/health` | Database and service health |
| POST `/api/telemetry`, POST `/api/telemetry/batch` | Ingest one or an array of readings; optional `x-api-key` |
| GET `/api/telemetry?deviceId=&from=&to=&limit=` | Historical readings |
| GET `/api/telemetry/stats?deviceId=&window=5m` | Aggregated statistics |
| GET/POST `/api/graphs`; GET/PUT/DELETE `/api/graphs/:id` | Graph CRUD |
| POST `/api/graphs/validate` | Validate raw graph |
| GET `/api/graphs/active` | Active graphs |
| POST `/api/graphs/:id/compile`, `/deactivate`, `/test` | Activate, stop, or test a saved graph |
| GET `/api/templates` | Prebuilt graphs |
| GET `/api/alerts?graphId=&deviceId=&from=&to=&limit=` | Alert history |
| GET `/api/deliveries?graphId=&status=&limit=` | Delivery history; limit 1–500 |
| POST `/api/deliveries/:id/retry` | Queue failed delivery again (202; 409 if not failed) |
| POST `/api/nodes/test` | Test action with `{type, config, event}`; may perform a real outbound call |
| GET/POST `/api/mock/webhook-receiver` | Inspect / receive demo webhook JSON |
| GET `/api/demo/status`; POST `/api/demo/start`, `/stop` | Start (`durationSeconds` 10–600, default 120) and stop the demo |
| GET `/api/engine/status` | Engine and queue statistics |

Example reading: `{"timestamp":"2026-01-01T00:00:00Z","metadata":{"deviceId":"turbine-001","sensorType":"temperature","location":"Site 1"},"value":90,"unit":"°C"}`.

## WebSocket protocol

Connect to `/ws`. Send `{ "type":"subscribe", "channels":["telemetry:turbine-001", "alerts", "graph:<id>"] }`; `unsubscribe` uses the same shape. Other client messages are `ping` and `telemetry` with a reading in `data` (ingestion key applies). Messages include `connected`, `subscribed`, `unsubscribed`, `ack`, `pong`, and `error`. Channel events have `{type, data}`:

| Type | Data / channel |
|---|---|
| `telemetry` | reading; `telemetry` and `telemetry:<deviceId>` |
| `alert` | alert including graph/node/device, value and delivery IDs/status; `alerts`, `graph:<id>` |
| `node_activity` | graphId, nodeId, value, timestamp and optional tone/label/unit; `graph:<id>` |
| `edge_activity` | graphId, edgeId, timestamp; `graph:<id>`, throttled per edge to ~10 Hz |
| `delivery` | masked delivery status; `alerts`, `graph:<id>` |
| `graph_status` | graph activation state; `graph:<id>` |

## Tests and tools

```sh
# Server
cd server
npm test                 # unit (Vitest) + HTTP/WebSocket/security suites
npm run test:coverage    # unit suite with a coverage summary
npm run test:db          # everything, with a throwaway mongodb-memory-server
npm run benchmark -- --duration 45 --target 5000   # writes/sec + p50/p95/p99 + errors
npm run storage-report   # time-series vs an equivalent regular collection
npm run rule-latency -- --samples 50                # POST -> alert over WebSocket
npm run seed             # devices + template graphs + history
npm run bootstrap        # the same, plus flag the primary rule active
npm run simulate -- --devices 10 --interval 1000 --transport http --spikes 0.04
npm run engine-check     # end-to-end PASS/FAIL against a running server

# Client
cd ../client
npm test                 # logic suite (Node) + canvas smoke tests (Vitest + RTL)
npm run build
```

Everything from the repository root:

```sh
npm test        # runs the server and client suites in sequence
npm run test:coverage
npm run build
```

The unit suite covers the validator, the operators, the stream compiler, the webhook
service, the rule executor and the boot-time re-hydration. The HTTP suites cover telemetry
ingestion, graph CRUD, compile/deactivate, alerts, deliveries, the WebSocket protocol and
security hardening; the integration and end-to-end suites need a database.
`TEST_MONGODB_URI` must point at a **disposable** database — integration tests modify data.
The automatic binary download needs network access to MongoDB's download host.
Set `INGEST_API_KEY` in the shell for the simulator and benchmark if enabled. For Docker,
add `--url http://localhost:8080` to simulator/benchmark commands run from the host.
Benchmark results depend on hardware and configuration; no throughput guarantee is implied.

## Day 6 verification and live E2E

On 2026-11-16, Node 22.22.3/npm 10.9.8: installs, unit/HTTP tests without a DB,
client build and both coverage commands passed. Server: 84 unit tests plus 15 HTTP
tests passed, **5 Mongo-backed tests skipped**. Client: 1 logic + 4 smoke tests passed. Three checker contract tests also pass against
a fake HTTP/WebSocket fixture; they do not verify the real application stack.
Both dependency audits report zero advisories at this check (not a security guarantee).
See [FIXES_LOG](docs/FIXES_LOG.md) for evidence, causes and outstanding gates.

Against a **disposable local demo database**, with the server running and mock flags
above enabled (the check creates telemetry/audit records and deletes its test graph):

```sh
node --env-file=server/.env scripts/e2eCheck.js
# Docker: install server dependencies on the host first; the receiver URL is server-relative.
E2E_URL=http://localhost:8080 node scripts/e2eCheck.js
# Full DB suites, using a DIFFERENT disposable database:
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/nexusflow_test npm run test:db
```

The API check uses a unique device, MA(5), threshold >80, mock SMS and a webhook
receiver. It checks settings/edge round-trip, activation, normal readings then spikes,
both successful delivery channels, receiver evidence, WebSocket events and a two-second
no-alert observation after deactivation. `E2E_URL` is the host-accessible API origin;
`DEMO_WEBHOOK_URL` must be reachable **from the server**, not just your browser.
Only run against mock providers: the script cannot override a running server's provider.
It does not prove visual animation, a browser reload, or process-restart persistence.

Manual release gates:
1. Build/save the exact graph in the editor, reload, Load, and inspect all five node settings and four edges.
2. Activate, enable Live Mode, run `npm --prefix server run simulate -- --devices 1 --interval 500 --spikes 1`.
   Show canvas, Dashboard and Alerts with successful deliveries; inspect browser/server consoles.
3. Deactivate while ingestion continues; distinguish already-queued deliveries from new alerts. Stop simulator.
4. Activate again, wait until the stored graph's `isActive` is true, restart the **API process**
   (`docker compose restart server` for Docker), check `/api/graphs/active`, then ingest again.
   Finally deactivate and restart once more to verify it stays inactive.
5. Inspect `db.getCollectionInfos({name: "telemetry"})` in mongosh: timeField `timestamp`,
   metaField `metadata`, granularity `seconds`; inspect a reading's BSON Date and `device_timestamp` index.

## Known Issues / verification limits

- **NO-GO for complete Day 6 sign-off:** MongoDB, Docker and mongosh are unavailable in this workspace.
  API startup failed with `ECONNREFUSED`; `npm run test:db` failed downloading MongoDB
  (`fastdl.mongodb.org` is blocked). No collection-creation or real restart result is claimed.
- `scripts/e2eCheck.js` currently exits FAIL here because no live API exists. Its successful
  path must still be run against MongoDB. Docker Compose configuration was reviewed, not built/run.
- Client dev server returned HTTP 200, but `/api/health` through its proxy returned 500
  because the backend was down. Browser rendering, glow, chart updates, reconnect behavior,
  console cleanliness and deployed HTTPS/WSS/CORS remain manual verification gates.
- Active flags are currently best-effort asynchronous writes. A failed write or rapid
  recompile/deactivate/restart may leave persisted intent inconsistent with runtime state.
  Do not claim crash-safe activation or guaranteed rehydration.
- A transform error is isolated from siblings but ends that branch until reactivation;
  action errors are caught per event. Deactivation does not cancel deliveries already queued.
- No authentication/tenant isolation; local demo permits private webhooks. Do not expose
  this demo configuration publicly or use real credentials. No full-history secret audit:
  this checkout is shallow. No tracked real `.env` file or obvious secret was found locally.
- Screenshots, benchmarks and storage measurements are pending; no invented captures or values.

**GitHub metadata suggestion:** description: “Visual IoT telemetry rule engine with React Flow, RxJS, MongoDB time-series and WebSockets.” Topics: `iot`, `rxjs`, `react-flow`, `mongodb-time-series`, `rule-engine`, `websocket`, `nodejs`, `react`. Pinned-repo tagline: “Turn live IoT telemetry into observable, visual rules.”

**Commit messages:** use Conventional Commits, e.g. `fix(server): dispose subscriptions on graph deactivation` or `docs: record stabilization verification`.

See [Architecture](docs/ARCHITECTURE.md), [Deployment](docs/DEPLOYMENT.md),
[Final report](docs/FINAL_REPORT.md), [Audit report](docs/AUDIT_REPORT.md),
[Performance report](docs/PERFORMANCE_REPORT.md), [Viva Q&A](docs/VIVA_QA.md),
[Presentation outline](docs/PRESENTATION_OUTLINE.md), [Demo checklist](docs/DEMO_CHECKLIST.md)
and the [five-minute demo script](docs/DEMO_SCRIPT.md).

## Project structure

```text
NexusFlow-Visual-IoT-Telemetry-Rule-Engine/
├── docker-compose.yml            # local stack: mongo + server + client (nginx)
├── render.yaml                   # Render blueprint for the API
├── package.json                  # root scripts: test / test:coverage / build
├── client/                       # React + Vite frontend
│   ├── vercel.json               # SPA rewrites + asset caching for Vercel
│   ├── public/_redirects         # SPA fallback for Netlify
│   ├── .env.example              # dev: VITE_API_BASE_URL / VITE_PROXY_TARGET
│   └── src/
│       ├── pages/                # EditorPage, DashboardPage, AlertsPage
│       ├── components/
│       │   ├── canvas/           # FlowCanvas, NodePalette, AnimatedEdge, ActivityProvider
│       │   ├── nodes/            # node cards + definitions.js (shared node registry)
│       │   ├── dashboard/        # LiveLineChart, StatCards, AlertFeed, EngineStatus
│       │   └── layout/ demo/     # navbar, theme, toasts, demo split view
│       ├── hooks/                # useTelemetrySeries, useGraphHistory
│       ├── services/             # api, graphSerializer, autoLayout, activityStore
│       ├── ws/                   # WebSocketProvider, useChannel
│   └── test/                     # logic suite + Vitest/RTL canvas smoke tests
├── server/                       # Express + Mongoose + RxJS API
│   ├── Procfile                  # Railway / Heroku start command
│   ├── .env.example              # development configuration
│   ├── samples/                  # turbine-graph.json
│   ├── scripts/                  # seed/bootstrap, simulator, benchmark, storageReport,
│   │                             # ruleLatency, engineCheck, testWithMongo
│   ├── src/
│   │   ├── app.js  server.js     # Express wiring + boot (incl. re-hydration)
│   │   ├── config/               # env (zod), db (time-series contract), logger (pino)
│   │   ├── compiler/             # graphValidator, streamCompiler, nodeRegistry,
│   │   │                         # operators/, actions/, sources/
│   │   ├── controllers/ routes/  # HTTP layer (zod-validated)
│   │   ├── integrations/         # webhookService, urlSafety (SSRF), sms/email, template
│   │   ├── middleware/           # security (helmet/cors/limits), validate, errorHandler
│   │   ├── models/               # Telemetry (time-series), Graph, Alert, DeliveryLog, Device
│   │   ├── services/             # telemetryBus, ruleExecutor, activeGraphManager,
│   │   │                         # websocket, deliveryService, outboundQueue, demoService
│   │   ├── validation/           # zod schemas per route
│   │   └── utils/                # httpError, sanitize, mongoErrors
│   └── test/                     # Vitest unit suites + node --test HTTP/DB suites
└── docs/
    ├── ARCHITECTURE.md  DEMO_SCRIPT.md
    ├── AUDIT_REPORT.md  PERFORMANCE_REPORT.md
    ├── DEPLOYMENT.md  FINAL_REPORT.md  VIVA_QA.md
    └── PRESENTATION_OUTLINE.md  DEMO_CHECKLIST.md
```

## Submission gate

- [x] Dependency installation, non-DB tests, client build and coverage commands pass.
- [x] Environment examples, MIT license, fixes log, demo script and portfolio text exist.
- [x] Dependency audit is clean at the recorded check.
- [ ] Fresh Mongo-backed start, time-series creation and all DB tests pass without skips.
- [ ] Live `scripts/e2eCheck.js` passes every step.
- [ ] Docker stack build/start and browser save/reload/live flow are verified.
- [ ] Actual API restart restores active graphs; inactive graphs stay inactive.
- [ ] Capture genuine screenshots/results and review full Git history for secrets.

**Decision: NO-GO for full submission sign-off until unchecked gates are evidenced.**
See [demo recording guide](docs/DEMO_VIDEO_SCRIPT.md) and [portfolio text](docs/PORTFOLIO_TEXT.md).
