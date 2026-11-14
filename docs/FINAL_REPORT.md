# NexusFlow: Visual IoT Telemetry & Rule Engine — Final Report

**Stack:** MongoDB 5.0+ (time-series) · Express · Mongoose · RxJS · `ws` · React 19 · Vite ·
React Flow · Recharts · Zod · Pino · Docker
**Repository:** `Rajeevswami/NexusFlow-Visual-IoT-Telemetry-Rule-Engine`
**Milestone:** Days 1–5 (ingestion → stream compiler → live execution → dashboards and
delivery → audit, tests, performance verification, deployment, submission package)

---

## 1. Abstract

NexusFlow is a no-code platform for turning raw IoT telemetry into actions. A user composes
a rule by wiring nodes on a canvas — a *Sensor Source* that selects a device and sensor
type, optional *math* nodes (moving average, scale, threshold), and one or more *action*
nodes (webhook, SMS, email, log). Saving and activating that graph compiles it into a live
RxJS pipeline on the server: every ingested reading is persisted in a MongoDB time-series
collection, published onto an in-memory event bus, routed in O(1) to the graphs whose
sources match it, and pushed through each graph's operator chain. When a threshold is
crossed the action node fires, an `Alert` document is written, and an audited delivery
(webhook / SMS / email) is queued with retries and a per-graph rate limit. A second
WebSocket channel streams telemetry, alerts, delivery results and per-node activity back
to the browser, where the same graph glows as data flows through it.

The project is a complete vertical slice: visual authoring, a JSON-to-Observable compiler,
time-series storage, a hot-path ingestion API, a live dashboard, an audit trail, a device
simulator, a benchmark harness, a Docker stack and a deployment path.

## 2. Problem statement

Teams that need "alert me when turbine 001's temperature stays above 80 °C for three
readings" usually end up writing glue code: a script per rule, a cron job, a dashboard
that is stale by the time someone looks at it, and no record of what was actually sent to
whom. The friction is not the threshold — it is everything around it.

Three problems make this worse in an IoT context specifically:

1. **Volume.** High-frequency sensors produce far more data than a row-per-reading
   relational store makes cheap to keep.
2. **Rule churn.** Operators want to add, edit and disable rules without a deploy, and
   they want to see the rule, not read code.
3. **Trust.** When an alert fires, someone must be able to answer "was it really sent, to
   whom, how many times, and why did it fail?".

## 3. Objectives

1. Author rules visually, with immediate validation feedback, undo/redo, templates and
   auto-layout.
2. Compile the saved graph JSON into a live, observable stream pipeline at runtime, with
   no code generation and no redeploy.
3. Ingest high-rate telemetry over HTTP and WebSocket into a storage engine designed for
   it, and keep the write path fast enough to be used in production.
4. Fire actions reliably: audited, retried, rate-limited and never blocking ingestion.
5. Stream results back to the browser in real time, including per-node visualisation of
   data flowing through the rule.
6. Be honest about performance: measure it, and publish the measurements.
7. Be deployable: configuration, health checks, seed/bootstrap and documentation for a
   free-tier stack.

## 4. System architecture

```text
                       ┌─────────────────────────────┐
  device / simulator → │  Express API                │
  POST /api/telemetry  │  helmet · cors · rate limit │
  WS  /ws  (ingest)    │  zod validation             │
                       └───────────┬─────────────────┘
                                   │ insertMany (lean, ordered:false)
                                   ▼
                       ┌─────────────────────────────┐
                       │  telemetry (time-series)    │  metadata: deviceId, sensorType, location
                       └───────────┬─────────────────┘
                                   │ 202 returned here
                                   ▼ setImmediate
                       ┌─────────────────────────────┐
                       │  telemetryBus (RxJS Subject)│  counters + messages/sec
                       └───────┬─────────────┬───────┘
                               │             └──────────────┐
                               ▼                            ▼
                  ┌────────────────────┐        ┌───────────────────────┐
                  │ ruleExecutor       │        │ WebSocket channel fan- │
                  │ exact Map lookup   │        │ out (throttled 10 Hz) │
                  │ + wildcard list    │        └───────────────────────┘
                  └─────────┬──────────┘
                            ▼ one Subject per source node
        ┌───────────────────────────────────────────────────────┐
        │  compiled graph:  sensor → movingAverage → threshold ─┼→ action
        │  share() at every fan-out, catchError per branch      │
        └───────────────────┬───────────────────────────────────┘
                            ▼ onAlert
              ┌──────────────────────────┐        ┌──────────────────────┐
              │ Alert (persisted)        │───────▶│ bounded outbound      │
              │ broadcast over /ws       │        │ queue → webhook/SMS/  │
              └──────────────────────────┘        │ email + DeliveryLog   │
                                                  └──────────────────────┘
```

### Data model

| Collection | Kind | Notes |
|---|---|---|
| `telemetry` | **time-series** (`timeField: timestamp`, `metaField: metadata`, `granularity: seconds`) | optional TTL; index `{metadata.deviceId: 1, timestamp: -1}` |
| `graphs` | ordinary | raw React Flow JSON, `templateKey` (unique, sparse), `isActive` |
| `alerts` | ordinary | low volume, read by graph/device/time |
| `deliverylogs` | ordinary | audit trail; the request snapshot is `select: false` |
| `devices` | ordinary | demo inventory |

### Request lifecycle (the hot path)

`POST /api/telemetry/batch` → rate limit → optional `x-api-key` → Zod parse (rejects
non-numeric extra measurements and operator-shaped keys) → `insertMany(..., { lean: true,
ordered: false })` → **`202 { accepted: n }`** → `setImmediate` → `telemetryBus` →
`ruleExecutor` → each matching graph's source `Subject`.

Everything after the 202 is off the response path: a slow webhook, a dropped database
connection during rule evaluation or a stalled browser cannot make ingestion slow.

## 5. Module-wise implementation

### 5.1 Visual Graph Builder (client)

- **Canvas** — React Flow with a custom `glowEdge` edge type and typed node cards.
  `isValidConnection` refuses illegal links while the user is still dragging, and
  `onConnectEnd` explains *why* a link was refused.
- **Palette** — every node type comes from one `definitions.js` table that mirrors the
  server registry (`type` is the shared key), so the palette, the canvas and the compiler
  cannot drift apart. Palette entries may pre-fill a config (Turbine Sensor, Vibration
  Sensor…).
- **Node cards** — typed fields (text, number, select, email, url, headers editor) with
  server-side validation surfaced on the card.
- **Editor** — name, save/load, export JSON, undo/redo (debounced structural history),
  duplicate, auto-layout (Dagre, lazily imported), templates, validation panel that
  focuses the offending node.
- **Activation** — compile (which returns the pipeline summary), deactivate, dry run with
  sample values, "Send Test Data" which pushes a real anomaly through the real API, and a
  one-click two-minute demo with a split live view.
- **Rendering budget** — `useTelemetrySeries` and `useTelemetry` buffer incoming frames
  and flush into React state at most every 200 ms / 500 ms; `CanvasActivityStore` keeps
  glow state outside React and notifies only the affected node/edge through
  `useSyncExternalStore`.

### 5.2 Time-Series database (server)

`ensureTelemetryCollection()` runs before the first write: it creates `telemetry` with the
time-series options if missing, **refuses to start** if an existing collection has
different options (rather than silently writing measurements into a normal collection),
warns when the requested TTL differs from the stored one (retention is creation-only —
changing it could delete data), and creates the compound index. Mongoose is configured with
`bufferCommands: false` so operations fail fast during a disconnect instead of hanging.

### 5.3 Stream Compiler (server)

`compileGraph(graph, options)` is the heart of the project:

1. `validateGraph()` checks shape, unknown types, duplicate ids, dangling endpoints,
   self-loops, cardinality (one input per node, sources only emit, actions are terminal),
   and detects **cycles** with an iterative three-colour DFS that also reports the cycle
   path. Disconnected nodes and dangling outputs are *warnings*, not errors.
2. Every **source** node gets a `Subject`; every **math** node wraps its parent's stream
   with the operator from the registry; **actions** subscribe at the leaves.
3. Streams with more than one child are `share()`d, so a fan-out to two action nodes runs
   the upstream chain once, not twice.
4. Each branch is wrapped in `catchError`, so a failing operator or action logs and
   terminates *its own* branch instead of the whole pipeline.
5. `concatMap` keeps event order even when a handler is async; an optional
   `cooldownSeconds` suppresses repeat firings per device.
6. `dispose()` unsubscribes every action and completes every source `Subject`, which is
   what makes hot-swapping a graph safe.

The compiler contains **no node-specific logic**: node types register themselves with
`registerNode()`, so adding a node means dropping a file into `operators/` or `actions/`.

### 5.4 Ingestion API (server)

Single and batch endpoints share one handler. Batch writes use `ordered: false` and, since
Day 5, recover the documents that a partial failure still committed — the response is
honest about what is durable, and the rule engine only ever sees durable readings. A
matching WebSocket ingestion path runs the identical validation, persistence and fan-out;
only the transport differs. Both are rate-limited separately (`INGEST_RATE_LIMIT`) and
optionally key-protected.

### 5.5 Rule execution and delivery

- `ruleExecutor` keeps an exact `deviceId:sensorType → Set<route>` Map plus a small
  wildcard side table, so routing a reading is O(1) in the common case and never loops over
  all graphs. Each graph gets its own `Subject` wrapped in `catchError`, so a broken
  pipeline logs, resubscribes and keeps running.
- `activeGraphManager` owns the lifecycle: compile → register → broadcast. Activating twice
  disposes the previous pipeline instead of leaking it, and a failed recompile leaves the
  running pipeline untouched.
- `deliveryService` persists the audit **before** any network I/O, then returns
  immediately. A bounded queue (`OUTBOUND_CONCURRENCY`, `OUTBOUND_QUEUE_LIMIT`) and a
  per-graph sliding-window limiter (`OUTBOUND_RATE_PER_MINUTE`) protect the host; webhooks
  retry three times with exponential backoff, 4xx never retries.
- **SSRF protection** resolves the hostname once, rejects the request if *any* answer is a
  private/loopback/link-local/metadata address, and pins that answer into a dedicated
  agent so DNS cannot be rebound between the check and the connection. Redirects are not
  followed, credentials in URLs are rejected, and a fixed header block-list prevents
  smuggling. Private destinations require an explicit `ALLOW_PRIVATE_WEBHOOKS=true`.

### 5.6 WebSocket layer

One socket per browser tab, channel-based fan-out (`telemetry`, `telemetry:<deviceId>`,
`alerts`, `graph:<id>`) — never a blanket broadcast. A socket buffering more than 1 MB is
skipped (slow-consumer protection) and dead sockets are reaped by a 30 s ping/pong
heartbeat. Per-device adaptive throttling samples a hot device to 10 Hz on the *broadcast*
path only; saving and rule evaluation always see every reading.

## 6. Week-wise progress summary

### Week 1 — Time-series ingestion and storage

MongoDB time-series collection with a strict creation contract, Mongoose models, Zod
validation at the boundary, single/batch ingestion, historical queries and a per-minute
aggregation endpoint, plus the first benchmark and the device simulator.

### Week 2 — The RxJS stream compiler

Node registry with self-registering definitions, graph validation (including cycle
detection), `compileGraph` with `share()` fan-out and per-branch error isolation, the
three math operators and the first action (log), and the dry-run test endpoint.

### Week 3 — Live rule execution

`telemetryBus` + `ruleExecutor` routing, activation/deactivation with disposal, per-node
activity taps and the alert cooldown, the WebSocket channel layer with adaptive throttling,
and the engine status endpoint.

### Week 4 — Actions, dashboards and delivery

Audited webhook/SMS/email delivery with a bounded queue, per-graph rate limiting, retries,
`DeliveryLog` and manual retry, the mock receiver, the live dashboard (chart, stat cards,
alert feed, engine panel), glowing wires and value badges on the canvas, themes, toasts,
the one-click demo, Docker Compose and the first documentation set.

### Week 5 — Stability, verification and submission (this branch)

- **Audit:** 24 findings (2 Critical, 7 Major, 15 Minor); all Critical and Major fixed.
- **Tests:** 83 unit tests (Vitest) + 9 Node-test suites covering HTTP, WebSockets,
  security, integration and end-to-end; a Vitest + React Testing Library smoke suite for
  the canvas; coverage reporting.
- **Performance:** rewritten benchmark (percentiles + error count), a new storage report
  and a new rule-latency probe, all feeding `docs/PERFORMANCE_REPORT.md`.
- **Deployment:** `render.yaml`, `Procfile`, `vercel.json`, `_redirects`, production
  `.env` examples and `docs/DEPLOYMENT.md`.
- **Re-hydration:** active graphs are recompiled automatically on boot.
- **Submission package:** final report, viva Q&A, presentation outline, demo checklist and
  an updated README.

## 7. Challenges and solutions

| Challenge | Solution |
|---|---|
| Making a JSON graph executable without code generation | A node registry: each node type registers a `createOperator`/`createAction`; the compiler only walks the graph. New node = new file + one import. |
| Fan-out without duplicating work | `share()` on every stream with more than one child, memoised per node, so the upstream chain subscribes once. |
| One broken node must not kill the rule | `catchError` inside `buildStream` and around every action handler; the failing branch ends, siblings keep running. |
| Cycles and malformed graphs | An iterative three-colour DFS in the validator plus a defensive `path` check in `buildStream`; both report the offending path. |
| Hot-path latency | Respond `202` after `insertMany`, then fan out in `setImmediate`; pre-resolve source descriptors at compile time; keep ingestion logging silent. |
| Routing to the right graph at 5 000 writes/sec | An exact `deviceId:sensorType` Map plus a small wildcard list — O(1), never a loop over graphs. |
| A slow webhook must not block ingestion | The audit row is written first, the send is queued on a bounded queue with its own concurrency, and the response never waits for it. |
| SSRF via user-supplied webhook URLs | Resolve once, reject if any answer is private, pin the answer into a dedicated agent, no redirects, no credentials, header block-list. |
| Re-rendering the canvas on every telemetry frame | Buffer into refs and flush on a timer; keep glow state in an external store and notify only the changed node/edge. |
| Losing rules on restart | Persist `isActive` and re-hydrate every flagged graph on boot; a graceful shutdown deliberately keeps the flag, an explicit deactivate clears it. |
| Partial batch failures | Recover the durable documents from the bulk-write error and publish exactly those. |

## 8. Results and performance

See [`PERFORMANCE_REPORT.md`](PERFORMANCE_REPORT.md) for the full tables and the exact
commands. Summary of what is claimed and how it is verified:

| Claim | How it is verified | Status |
|---|---|---|
| 5 000 writes/sec ingestion | `npm run benchmark -- --duration 45 --target 5000` | ‹paste result› |
| p50/p95/p99 latency reported | same script, percentile output | ‹paste result› |
| Time-series storage is smaller than a regular collection | `npm run storage-report` (copies the same documents, compares `collStats`) | ‹paste result› |
| Alert latency from ingest to WebSocket | `npm run rule-latency -- --samples 50` | ‹paste result› |
| All tests pass with coverage | `npm test`, `npm run test:coverage` | ‹paste summary› |

Qualitative results that do not depend on a benchmark:

- Activation, deactivation and recompilation dispose every subscription; the test suite
  asserts a single pipeline and a single subscription after a double activation.
- A graph deleted while active stops receiving telemetry and stops writing alerts.
- A restart brings active graphs back (asserted in `test/e2e.test.js` and
  `test/compiler/rehydration.test.js`).
- Failed deliveries can be retried exactly once, atomically.

## 9. Limitations

1. **No authentication or authorisation.** The API trusts anyone who can reach it. The
   ingestion key is a shared secret, not a user system. Multi-tenancy would need per-user
   graph ownership and per-tenant rate limits.
2. **Rule state is in-memory.** Active graphs live in one process. Re-hydration covers
   restarts, but two instances do not share state; see `VIVA_QA.md` for the scaling path.
3. **The outbound queue is in-memory.** A crash loses queued deliveries (the audit rows
   remain and can be retried manually).
4. **Mock SMS/email providers are in-memory and bounded** to 200 messages; the mock
   receiver inbox is bounded to 100 payloads and cleared on restart.
5. **The graph model is deliberately narrow:** one input per node, actions are terminal,
   no loops. This keeps compilation predictable; a general DAG-with-feedback language is
   future work.
6. **`movingAverage` emits partial windows** until the window fills, which makes the first
   few readings noisier than a strict window.
7. **Delivery request snapshots contain credentials and message bodies.** They are
   `select: false`, never returned by the API and never logged, but they *are* persisted —
   the database and its backups must be protected accordingly.
8. **No load balancer / horizontal scaling story is implemented**, only designed (see
   `VIVA_QA.md`).

## 10. Future scope

- **Horizontal rule execution:** partition graphs across instances (by `graphId` hash or
  by source key) and share telemetry through Redis Streams / NATS instead of an in-process
  Subject, so a reading reaches exactly one owner of each graph.
- **Durable outbound queue:** move the delivery queue into MongoDB (a `deliveries`
  collection with a claim index) or a managed queue, so a crash cannot lose a send.
- **Authentication and multi-tenancy:** JWT sessions, per-user graphs, per-tenant limits
  and audit.
- **More node types:** windowed aggregations (`tumbling`, `session`), debounce,
  `distinctUntilChanged`, dead-man's-switch (alert when a device goes quiet), geofence,
  unit conversion packs, and a JavaScript-expression node sandboxed in a `vm`.
- **Backfill and replay:** re-run historical telemetry through a graph to validate a rule
  before activating it.
- **Rule versioning and diffing:** keep every compiled version of a graph so an operator
  can see what changed and roll back.
- **Observability:** OpenTelemetry traces from ingestion through the pipeline to delivery,
  and a Prometheus `/metrics` endpoint.
- **Managed real providers:** Twilio and SMTP are implemented behind a provider
  interface; adding SendGrid, SNS or a Slack incoming webhook is a new file.

## 11. Conclusion

NexusFlow demonstrates that a visual rule engine can be both approachable and honest about
its engineering. The graph a user draws on the canvas *is* the program: it is validated,
compiled into an RxJS pipeline, fed by a time-series ingestion path, and torn down and
rebuilt without a deploy. The decisions that make it work are unglamorous — respond before
you fan out, dispose what you compile, index by the key you route on, persist the audit
before you send, and refuse to start against a misconfigured collection.

Day 5 turned the prototype into a submission: an audited codebase with every Critical and
Major issue fixed, a test suite that covers the compiler, the HTTP surface, the WebSocket
protocol, security and the full end-to-end path, three measurement scripts whose output
feeds a performance report with no invented numbers, a free-tier deployment path, and a
re-hydration step that means a restart no longer silently stops the rules.

---

## Appendix A — Final submission checklist

### Code

- [x] Every Critical and Major finding in [`AUDIT_REPORT.md`](AUDIT_REPORT.md) is fixed; the
      Minor findings are listed with an explicit rationale.
- [x] Unit tests (validator, operators, compiler, webhook service, rule executor,
      re-hydration) pass.
- [x] HTTP/WebSocket/security suites pass; integration and end-to-end suites are runnable
      against a disposable database.
- [x] Frontend smoke tests pass (canvas render, drop a node, serialise the graph).
- [x] `npm test` at the repository root runs both projects.
- [ ] Coverage summary pasted into the report from the latest run.
- [x] No `console.log`, no `TODO`, no unused dependencies or imports.
- [x] Active graphs survive a restart (re-hydration on boot).

### Report

- [x] `docs/FINAL_REPORT.md` — this document.
- [x] `docs/AUDIT_REPORT.md` — 24 findings by severity.
- [x] `docs/PERFORMANCE_REPORT.md` — **fill the `‹…›` cells in** after running the three
      scripts against a real server, then commit the numbers.
- [x] `docs/VIVA_QA.md` — 25 questions and answers.
- [x] `docs/DEPLOYMENT.md`, `docs/PRESENTATION_OUTLINE.md`, `docs/DEMO_CHECKLIST.md`.
- [x] README with live-demo placeholders, screenshot placeholders and a project structure
      tree.

### Demo link

- [ ] Deploy with `docs/DEPLOYMENT.md`; paste the frontend URL into the README
      **Live demo** table and into the closing slide.
- [ ] Run `npm run bootstrap` against the deployed API so it has sample devices and an
      active template graph.
- [ ] Confirm the deployed WebSocket connects (`wss://…`) and the dashboard updates.
- [ ] Wake the service once, immediately before presenting (free tier sleeps).

### Video / recording

- [ ] Record the 3-minute backup run described in
      [`DEMO_CHECKLIST.md`](DEMO_CHECKLIST.md) and store it beside the slides.
- [ ] Record a longer walkthrough (10–12 minutes) covering architecture, the compiler, the
      storage saving, the measured performance and the re-hydration behaviour.
- [ ] Check the audio: a screen recording without narration is not a submission.
- [ ] Upload and put the link in the README (placeholder until then).

### Presentation

- [x] `docs/PRESENTATION_OUTLINE.md` — 12 content slides plus an appendix.
- [ ] Replace every placeholder screenshot with a real capture.
- [ ] Rehearse once against the checklist, end to end, with the recording ready as a
      fallback.

---

## Appendix B — Verifying everything from a fresh clone

Run in this order. Everything is offline-capable except the optional MongoDB binary
download, which needs internet access.

```sh
# 0 — clone and install
git clone <your-fork-or-repo-url> nexusflow
cd nexusflow
npm run install:all            # = npm --prefix server ci && npm --prefix client ci

# 1 — syntax and configuration checks (no database needed)
cd server
node --check src/server.js
node --check scripts/benchmark.js
node --check scripts/storageReport.js
node --check scripts/ruleLatency.js
node --check scripts/seed.js

# 2 — the unit suite (no database needed)
npm run test:unit              # Vitest: validator, operators, compiler, executor, re-hydration
npm run test:coverage          # the same suite plus the coverage summary

# 3 — the HTTP / WebSocket / security suites (no database needed)
npm run test:http              # node --test: 9 suites

# 4 — everything, including the database-gated integration and end-to-end suites
#     Needs internet access to download a throwaway MongoDB binary once.
npm run test:db

# 5 — the client
cd ../client
npm test                       # logic suite + Vitest/RTL canvas smoke tests
npm run build                  # production bundle, chunked

# 6 — the live stack (Docker, from the repository root)
docker compose up --build      # open http://localhost:8080 and click Run Demo
docker compose exec server npm run seed      # or: npm run bootstrap
docker compose down

# 7 — performance verification, against the running server from step 6
#     (from a second terminal, with INGEST_API_KEY exported if it is set)
cd server
curl -s http://localhost:8080/api/health
npm run benchmark -- --duration 45 --target 5000
npm run storage-report
npm run rule-latency -- --samples 50

# 8 — copy the numbers into docs/PERFORMANCE_REPORT.md and remove the ‹…› markers
```

Expected result: the unit suite is green with no skipped files, the HTTP suites report
`# fail 0`, the client smoke tests are green, the Docker demo works from the README's
quick-start, and the three performance scripts each print a table plus a JSON summary line
that can be pasted straight into the performance report.

The full test surface currently reported by these commands:

| Suite | Result |
|---|---|
| `server` unit (Vitest) | 9 files / 83 tests pass |
| `server` HTTP/WebSocket/security (`node --test`) | 9 suites, `# fail 0` |
| `client` logic (`node --test`) | 1 suite pass |
| `client` smoke (Vitest + React Testing Library) | 4 tests pass |
| Coverage | statements / branches / functions / lines above the configured thresholds |
