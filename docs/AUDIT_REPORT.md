# NexusFlow — Day 5 Code Audit Report

**Scope:** the whole repository (`server/`, `client/`, `docs/`, Docker, scripts) as of the
Day-5 branch, commit `5d42dee`.
**Method:** manual read of every source file plus a systematic sweep for

- RxJS subscriptions, WebSocket listeners and timers that are never released
- `async` handlers without `try/catch` / `.catch()`
- graph edge cases (empty graph, single node, disconnected nodes, cycles, deleted nodes,
  invalid node config)
- race conditions (recompiling while data flows, double activation)
- security (input validation, NoSQL injection, CORS, secrets, SSRF)
- frontend stale closures, avoidable re-renders, console noise
- dead code, unused dependencies, leftover `console.log`

**Result:** 24 findings — **2 Critical, 7 Major, 15 Minor**. Every Critical and Major
issue is fixed in this branch; the Minor issues that were cheap and safe are fixed too,
and the rest are listed with a rationale for keeping them.

Severity legend: **Critical** = data loss, silent rule failure or a security hole in the
default configuration. **Major** = wrong behaviour a user would notice, or a
production-readiness blocker. **Minor** = correctness hygiene, performance or noise.

---

## Critical

### C1 — Deleting a graph left its pipeline running

`DELETE /api/graphs/:id` removed the document but never disposed the compiled pipeline.
The graph stayed in `activeGraphManager`, `ruleExecutor` kept routing telemetry to it, and
its action nodes kept writing `Alert` documents with a `graphId` that no longer resolves.
On a long-lived server this also leaked a subscription per deleted graph.

**Fix** — `graphController.deleteGraph` now calls `activeGraphManager.deactivate(id)`
(dispose + `ruleExecutor.unregister` + `broadcastGraphStatus`) before returning 204.
Covered by `test/apiIntegration.test.js` ("deleting a graph stops its pipeline") and
asserted in `test/e2e.test.js`.

### C2 — Editing an active graph silently kept the old rule live

`PUT /api/graphs/:id` replaced the saved JSON but the running pipeline was compiled from
the *previous* JSON. The editor told the user "saved changes are not live yet", yet the
engine kept evaluating a rule the user believed they had just changed — the worst kind of
divergence for a rule engine.

**Fix** — `updateGraph` disposes the pipeline when the graph was active. The user
re-activates to apply the edit, which is exactly what the UI already prompts for.
Covered by `test/apiIntegration.test.js`.

---

## Major

### M1 — A partially failed batch returned 500 and dropped the durable rows

`Telemetry.insertMany(readings, { ordered: false })` applies every document it can and
*then* throws a bulk-write error. The controller let that error bubble to the error
handler: the client saw a 500 even though most readings were already committed, and the
readings that *were* stored were never published to `telemetryBus`, so no rule ever saw
them. The two failures compound: the client retries (duplicating work) while the data that
did land is invisible to the engine.

**Fix** — `telemetryController.insertAndAccept` recovers the durable documents from the
error (`utils/mongoErrors.js`), answers `202 { accepted: n }` with the honest count, and
fans out exactly those documents. Only a write where *nothing* landed is reported as a
failure. The same recovery was applied to the WebSocket ingestion path.

### M2 — The WebSocket ingestion path had the same hole

`handleTelemetry` swallowed the insert error and published the reading to the bus
unconditionally — the rule engine could evaluate a reading that was never stored.

**Fix** — it now uses the same "only publish what is durable" contract as HTTP.

### M3 — `NODE_ACTIVITY_ENABLED` defaulted to on in production

The canvas instrumentation adds one `tap()` per node per reading plus WebSocket traffic per
value. The env schema defaulted it to `true` regardless of `NODE_ENV`, so a production
deployment paid that cost without opting in.

**Fix** — the flag is now tri-state: unset means *on outside production, off in
production*. `.env.example` and `render.yaml` state the intent explicitly.

### M4 — WebSocket activity-throttle maps grew without bound

`activitySentAt` / `activityTimers` are keyed `graphId:nodeId` and were never pruned and
never cleared when a graph stopped. A server that had seen N graphs kept N×nodes entries
(and their pending timers) for the life of the process. `edgeSentAt`/`edgeTimers` were
capped but only opportunistically.

**Fix** — `forgetGraphActivity(graphId)` releases every entry belonging to a graph when it
is deactivated (hooked into `broadcastGraphStatus(..., 'inactive')`, so delete, deactivate
and the demo's stop path all trigger it), and both maps now share one
`boundKeyMap()` cap (8192 keys, age-first eviction). `forgetAllActivity()` is called when
the socket server closes.

### M5 — No `unhandledRejection` / `uncaughtException` handling

A single stray rejection anywhere (a provider SDK, a timer callback) would take the
process down with a stack trace and no structured log, and on Node 20+ it is fatal by
default.

**Fix** — `server.js` registers both handlers: rejections are logged with the pino
serializer; an uncaught exception logs, runs the graceful shutdown and exits non-zero so
the platform restarts the service.

### M6 — The frontend could not reach a separately hosted backend

`WebSocketProvider` derived the socket URL from `window.location`, so a Vercel/Netlify
deployment dialled its own origin and got a 404 upgrade. The task's deployment target
(frontend and API on different hosts) was therefore impossible without a proxy.
`api.js` also only honoured `VITE_API_BASE_URL`, not the documented `VITE_API_URL`.

**Fix** — `wsUrl()` prefers `VITE_WS_URL` (normalising `http(s)` → `ws(s)` and upgrading to
`wss:` on HTTPS pages) and falls back to same-origin; `api.js` prefers `VITE_API_URL` and
still accepts the legacy variable. Documented in `client/.env.example` and
`.env.production.example`.

### M7 — pino-http logged one line per ingestion request

At the 5 000 writes/sec target a batch size of 100 means 50 requests/second, i.e. 50
structured log lines/second plus their I/O — measurable in the latency numbers the project
claims.

**Fix** — `customLogLevel` makes successful ingestion `silent` and failed ingestion `warn`;
`/api/health` polling is silent as well. 5xx responses are still logged by the error
handler.

> Note: `autoLogging.ignore` cannot be used for this because pino-http calls it with
> `(req)` only — reading `res.statusCode` there throws and turns the request into a 500.
> That is why the level hook is used instead.

---

## Minor (fixed)

| # | Finding | Fix |
|---|---|---|
| m1 | `activeGraphManager.publish()` was dead code that duplicated `ruleExecutor` routing; anyone calling it would double-deliver readings | Removed; routing has exactly one owner |
| m2 | `alertService.listAlerts()` unused (the controller queries `Alert` directly) | Removed |
| m3 | `mockReceiver.clearReceived()` unused | Removed |
| m4 | `compiler.describeNodes()` and several registry re-exports unused (the client has its own `nodeLibrary`) | Removed from the public surface |
| m5 | Unused `renderTemplate` import in `actions/smsAlert.js` | Removed |
| m6 | `ruleExecutor.unregister` rebuilt the whole wildcard array per source (O(n) per deactivate) | Wildcards are keyed by `route` in a `Map`; unregister is O(1) |
| m7 | `compiled.publish()` re-merged node defaults and re-looked-up definitions for every reading of every active graph | Source descriptors are pre-resolved once at compile time (`sourceRoutes`) |
| m8 | `EditorPage` attached its `keydown` listener in an effect with no dependency array, so it re-bound on every render (including every drag frame) | Handler kept in a ref, listener attached once |
| m9 | The client bundle was a single ~1 MB chunk and the build emitted a size warning | `manualChunks` splits react / flow / charts |
| m10 | `compileGraphHandler` broadcast `graph_status: error` even for a 404 | Only non-404 failures broadcast |
| m11 | `stopDemo()` racing `startDemo()` could leave the simulator interval running | `stopDemo` awaits the in-flight start first |
| m12 | An empty `CLIENT_ORIGIN` produced an empty CORS allow-list, silently rejecting every browser request | Env validation now rejects an empty origin list |
| m13 | `demoService.startDemo` could dereference a null template graph | Explicit 500 when the template cannot be prepared |
| m14 | `startDemo`'s in-flight `findOneAndUpdate` result was not checked | Guarded |
| m15 | `demoStatus()` spread timers out of the state object on every call (allocation on a 5 s poll) | Unchanged behaviour, but the state object is now built once |

---

## Minor (accepted, with rationale)

- **`console.error` in `ErrorBoundary` and the WebSocket provider.** The browser has no
  structured logger; these are the two places where a raw error must reach the developer
  console. Everything else is silent or routed through the toast system.
- **`movingAverage` emits partial windows.** `bufferCount(n, 1)` yields an average from
  the first reading. This is documented behaviour and is what `engineCheck`'s local replay
  asserts, so changing it would alter the published semantics.
- **No authentication/authorisation on the API.** Documented in the README as a known
  limitation; adding users is out of scope for this milestone and the deployment guide
  states it explicitly.
- **In-memory rule state.** Active graphs live in process memory by design (see
  `docs/VIVA_QA.md` for the trade-off and the re-hydration story).
- **`testGraphHandler` in `test/compiler/streamCompiler.test.js` drains async actions with a
  single `setImmediate`.** The alert arrives, but a chained action (alert → delivery) can be
  one microtask behind, so the helper can under-report a *second* stage. Widening it would
  mean a flush loop that risks hiding a real lost-action bug; the end-to-end suite asserts
  the full chain against a real server instead, which is where it belongs.
- **The cooldown `lastFiredAt` map in `streamCompiler.js` is keyed by `deviceId` and never
  pruned.** A device that never comes back leaves one small entry forever. Pruning would
  need a timer and a size policy for a map that is one entry per device — acceptable until
  the device count reaches the thousands, at which point the fix is a bounded LRU.
- **`Alert.deliveryIds` / `deliveryStatus` are not written by `recordAlert()`.** The link
  from an alert to its delivery rows exists on the `DeliveryLog` side (`alertId`), and the
  Alerts page joins on that. Populating the reverse direction would add a write on the alert
  hot path for a convenience the API does not need; recorded as a known gap, not a defect.
- **`AlertsPage` requests the graph list twice (once for the filter options, once for the
  selected graph's rule text).** Two cached GETs, no correctness impact; the component is
  refactoring work, not a stability fix, and Day 5 is a stability day.

---

## Verified during the audit

- **Memory leaks:** every `Subject`/`Subscription` created by `compileGraph` is released by
  `dispose()`; `dispose()` is called by `deactivate()`, `disposeAll()`, the dry-run
  `finally` block and the shutdown path. The RxJS bus subscription, the WebSocket
  heartbeat, every device flusher timer, every activity/edge throttle timer and the
  outbound queue are all cleared on close/shutdown.
- **Unhandled rejections:** every `async` route handler goes through `asyncHandler`; the
  two `void`-style fire-and-forget writes (`isActive` flags) now carry `.catch()`.
- **Graph edge cases:** the validator rejects an empty graph, unknown node types, missing
  ids, duplicate ids/edges, dangling edge endpoints, self-loops, multiple inputs, edges
  into a source, edges out of an action and cycles; it *warns* about disconnected nodes,
  dangling outputs and missing actions, and the compiler turns a parentless math node into
  `EMPTY` instead of crashing.
- **Race conditions:** activating twice replaces the pipeline (compile first, then dispose
  the old one, then register), so an invalid recompile cannot take a running rule down;
  `ruleExecutor.register`/`unregister` are idempotent per `graphId`.
- **Security:** every route validates its input with a strict Zod schema; query parameters
  are never interpolated into a Mongo filter as operators (they are coerced to
  strings/numbers/dates first); CORS is an explicit origin allow-list; SSRF protection
  (DNS resolve → reject private ranges → pin the address, no redirects, no credentials in
  URLs) is untouched and still defaults to blocking private destinations.
- **Secrets:** no credentials in source; `.gitignore` covers `.env*` except the examples;
  the logger redacts auth headers, tokens, passwords and API keys, and `safeUrl`,
  `maskPhone`, `maskEmail`, `safeError` and `deliveryDto` keep targets and provider errors
  out of logs and API responses.

---

## Day 5 additions that close the loop

| Deliverable | Where |
|---|---|
| Re-hydration of active graphs on boot | `services/activeGraphManager.js#hydrateActiveGraphs`, called from `server.js` |
| Test for re-hydration (7 cases, no database needed) | `test/compiler/rehydration.test.js` |
| API integration suite | `test/apiIntegration.test.js` |
| End-to-end suite (create → compile → ingest → Alert + DeliveryLog) | `test/e2e.test.js` |
| Frontend smoke tests | `client/test/editor.smoke.test.jsx` |
| Benchmark with percentiles | `scripts/benchmark.js` |
| Storage comparison | `scripts/storageReport.js` |
| Rule latency measurement | `scripts/ruleLatency.js` |
| Deployment files | `render.yaml`, `server/Procfile`, `client/vercel.json`, `client/public/_redirects`, `*.env.production.example` |
| Root scripts (one command per deliverable) | `package.json` — `test`, `test:coverage`, `build`, `seed`, `bootstrap`, `simulate`, `benchmark`, `storage-report`, `rule-latency` |
| Production seed / demo bootstrap | `scripts/seed.js --activate` (`npm run bootstrap`) |
| Reports | `docs/PERFORMANCE_REPORT.md`, `docs/FINAL_REPORT.md`, `docs/VIVA_QA.md`, `docs/PRESENTATION_OUTLINE.md`, `docs/DEMO_CHECKLIST.md`, `docs/DEPLOYMENT.md` |
