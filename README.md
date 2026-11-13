# NexusFlow: Visual IoT Telemetry & Rule Engine

NexusFlow is a browser-based, no-code graph editor and live dashboard for IoT telemetry. Users compose sensor, transformation, condition and action nodes; a server-side RxJS compiler evaluates the resulting graph against incoming readings. Alerts can trigger audited webhook, SMS and email deliveries.

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

**Stack:** Node 20+, Express, MongoDB 5.0+ (time-series), Mongoose, RxJS, WebSocket, React, Vite, React Flow, Recharts and Dagre.

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

1. Install Node 20+ and start MongoDB 5.0+ on port 27017.
2. `cd server && npm ci && cp .env.example .env` (Windows: copy the file). For the local mock webhook demo only, set `ALLOW_PRIVATE_WEBHOOKS=true` in `.env`. Leave it false otherwise.
3. `npm run seed` (optional), then `npm run dev`.
4. In another terminal, `cd client && npm ci && npm run dev`. Open http://localhost:5173.

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
| GET `/api/telemetry?deviceId=&sensorType=&from=&to=&limit=` | Historical readings |
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

Example reading: `{"timestamp":"2026-01-01T00:00:00Z","metadata":{"deviceId":"turbine-001","sensorType":"temperature"},"value":90,"unit":"°C"}`.

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
cd server
npm test                 # unit + HTTP; DB tests skip without TEST_MONGODB_URI
npm run test:compiler    # Vitest compiler, delivery and SSRF tests
npm run test:db          # uses TEST_MONGODB_URI or downloads a temporary MongoDB binary
npm run simulate -- --devices 10 --interval 1000 --transport http --spikes 0.04
npm run engine-check     # requires running server and MongoDB
npm run benchmark -- --requests 100 --batch-size 100 --concurrency 10
cd ../client && npm test && npm run build
```

`TEST_MONGODB_URI` must point to a **disposable** database: integration tests modify data. The automatic binary download needs network access to MongoDB's download host. Set `INGEST_API_KEY` in the shell for the simulator and benchmark if enabled. For Docker, add `--url http://localhost:8080` to simulator/benchmark commands run from the host. Benchmark results depend on hardware and configuration; no throughput guarantee is implied.

See [Architecture](docs/ARCHITECTURE.md) and [five-minute demo](docs/DEMO_SCRIPT.md).
