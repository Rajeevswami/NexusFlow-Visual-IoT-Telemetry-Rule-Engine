# NexusFlow — Viva / Review Q&A

25 likely questions with concise answers. Answers are deliberately short; the code
reference in brackets is where to point if the examiner wants to see it.

---

### Storage

**1. Why MongoDB Time-Series instead of a normal collection?**
Measurements arrive as a high-volume, append-only, time-ordered stream with a small,
repeating metadata payload. A time-series collection stores them in internal buckets keyed
by the `metaField`, so `deviceId`, `sensorType`, `location` and `unit` are written once per
bucket instead of once per document. That gives a much smaller storage footprint and better
compression, plus a clustered index on `(meta, time)` that makes "latest readings for this
device" a cheap range scan. It is a storage-engine optimisation, not a different query
language — the collection still behaves like a normal one for reads.
[`server/src/models/Telemetry.js`](server/src/models/Telemetry.js), [`server/src/config/db.js`](server/src/config/db.js)

**2. How does bucketing actually work?**
On write, MongoDB picks a bucket for the measurement's `metaField` values and the current
time span. Documents with identical metadata inside the bucket's time range are appended to
the same bucket as an array of measurements. Bucket size and count are controlled by
`granularity` (`seconds`, `minutes`, `hours`). On read, MongoDB transparently unwraps the
buckets, so `find()` returns normal documents. Queries that do not filter on `timeField`
first cannot use the time-series index efficiently — which is why every query path in the
app filters on `timestamp` first.

**3. What granularity did you choose and why?**
`seconds`. NexusFlow is a live dashboard: readings arrive every few hundred milliseconds to
a few seconds and the UI wants the newest data immediately. Coarser granularity would
compress better but delay visibility and coarsen the time index. Retention is expressed
with `expireAfterSeconds` at collection creation only, because changing it later could
delete existing data.

**4. What happens if the collection exists with the wrong options?**
The server refuses to start. `ensureTelemetryCollection` compares the stored `timeseries`
options against the expected ones and throws rather than silently writing measurements into
a collection that is not time-series. Failing loudly at boot beats discovering it weeks
later from a storage bill.

**5. How much smaller is it?**
Measured, not asserted: `npm run storage-report` copies every `telemetry` document into an
ordinary `telemetry_regular` collection, indexes it the same way, and compares `collStats`
for both (document count, data size, storage size, average object size). The numbers are in
[`PERFORMANCE_REPORT.md`](PERFORMANCE_REPORT.md) — the saving grows with the number of
readings per bucket and the amount of repeated metadata.

---

### The compiler

**6. Why RxJS?**
A rule is a dataflow graph: a source, zero or more transforms, one or more sinks. That is
literally what Observables model. RxJS gives fan-out (`share()`), backpressure-friendly
buffering (`bufferCount`), error isolation (`catchError` per branch), ordering for async
handlers (`concatMap`) and explicit teardown (`Subscription.unsubscribe`) — all without
inventing a scheduler. It also makes the hot path cheap: routing is a `Subject.next()` call.

**7. How does the compiler turn JSON into Observables?**
`compileGraph()` walks the validated graph. Each **source** node gets a `Subject`. Each
**math** node takes its (single) parent's Observable and pipes the operator from the
registry onto it. Streams with more than one child are piped through `share()` so the
upstream chain subscribes once. Each **action** node subscribes to its parent's stream at a
leaf; its handler runs per event. `dispose()` unsubscribes every leaf and completes every
source Subject, so a graph can be swapped at runtime with nothing left behind.
[`server/src/compiler/streamCompiler.js`](server/src/compiler/streamCompiler.js)

**8. How are cycles detected?**
In the validator, with an iterative three-colour (white/grey/black) depth-first search over
the adjacency map. A grey node reached again is a back edge, and the current path is sliced
from that node to produce a readable cycle (`a -> b -> c -> b`). The compiler also carries a
`path` array through `buildStream` and throws if a node reappears — defence in depth, in
case a future code path bypasses the validator. Iterative rather than recursive so a deep
graph cannot blow the stack.

**9. How does branching work with `share()`?**
Without `share()`, each subscriber to an Observable created by `pipe()` gets its own
subscription to the upstream source, so a `movingAverage` node feeding two action nodes
would run the window logic twice and see two independent buffers. `share()` multicasts one
upstream subscription to all downstream subscribers, so the window, the ordering and the
side effects happen exactly once. The compiler applies it to any node with more than one
child.

**10. What happens when a node throws?**
`buildStream` wraps each operator in `catchError` that logs and returns `EMPTY`, and each
action handler is wrapped in `concatMap` + `catchError`. A failure therefore terminates
*that branch* and leaves sibling branches and the rest of the engine running. The
`ruleExecutor` additionally wraps each graph's Subject in `catchError` and resubscribes, so
even a catastrophic pipeline error is logged and recovered from.

**11. How do you add a new node type?**
Write a file that calls `registerNode({ type, category, label, defaults, validate, createOperator | createAction })` and import it from `operators/index.js` or `actions/index.js`. The compiler contains no node-specific logic — it only walks the registry — so this is the whole change.

---

### Execution and scaling

**12. How does a reading reach the right graph?**
`ruleExecutor` keeps an exact Map from `"deviceId:sensorType"` to the set of routes with
that exact source, plus a small side table for wildcard sources (`*`). Routing a reading is
one Map lookup plus, only when the wildcard table is non-empty, a short scan. It never loops
over all active graphs. Each route is that graph's source `Subject`.
[`server/src/services/ruleExecutor.js`](server/src/services/ruleExecutor.js)

**13. How would WebSocket scaling work across multiple instances?**
WebSockets are stateful, so the fan-out has to move out of the process. The design:
(a) front the API with a load balancer that supports sticky sessions or WebSocket upgrade
passthrough; (b) partition *rule execution* by `graphId` (consistent hashing) so each graph
is compiled and evaluated on exactly one instance; (c) replace the in-process
`telemetryBus` Subject with a shared transport — Redis Streams, NATS or Kafka — where each
instance consumes the partition it owns; (d) publish alerts/deliveries/activity to a
pub/sub topic that every instance forwards to its own connected sockets. Ingestion stays
stateless, so it scales horizontally behind the balancer.

**14. How do you handle backpressure?**
At three levels. **Storage:** `insertMany` is batched and the response is sent before any
fan-out, so the write path is never blocked by consumers. **Broadcast:** a per-device
adaptive throttle samples a device faster than ~20 msg/s down to 10 Hz (latest wins) on the
WebSocket broadcast path only — saving and rule evaluation always see every reading; a
socket buffering more than 1 MB is skipped; dead sockets are reaped by a 30 s heartbeat.
**Outbound:** a bounded queue with fixed concurrency and a per-graph sliding-window rate
limit, so a slow provider cannot exhaust the host.

**15. What are the trade-offs of in-memory rule execution?**
Pros: microseconds of latency, no serialisation of events, trivial teardown, and the
compiler can hold live Subjects and subscriptions. Cons: the state dies with the process,
and two instances do not share it. The mitigations in this project are (a) re-hydration
from MongoDB on boot so a restart does not silently stop the rules, and (b) a design that
moves the bus to a shared transport when horizontal scaling is needed. For the scale this
project targets — tens of graphs, thousands of readings per second — in-memory is the right
trade.

**16. What happens when the server restarts?**
On boot, `hydrateActiveGraphs()` loads every graph flagged `isActive: true`, recompiles and
re-activates it, and reports a summary. The flag records the *operator's intent*, so a
graceful shutdown deliberately does not clear it; only an explicit deactivate does. A graph
that can no longer compile (edited into an invalid state while the server was down) is
flagged inactive again so it does not fail on every boot, and one bad graph never blocks the
others. In-flight deliveries are lost from the queue but their audit rows survive and can be
retried manually.

**17. How would you scale to millions of events?**
Four changes, in order. (1) **Batch and partition ingestion:** accept larger batches, and
shard the time-series collection's natural key by device so writes spread across shards.
(2) **Move the bus off-process:** Redis Streams/NATS/Kafka with consumer groups, partitioned
by `deviceId`, so rule evaluation scales with partitions rather than with one Node process.
(3) **Partition rule execution by graph**, with a registry of graph ownership, so each graph
is evaluated exactly once cluster-wide. (4) **Make delivery durable:** a queue with
at-least-once semantics and idempotency keys, instead of an in-memory bounded queue. The
event-loop-bound parts (Zod validation, routing, RxJS operators) are already O(1) per
reading and scale with cores by running more partitions.

**18. Why not evaluate rules in the database with an aggregation pipeline?**
An aggregation can compute a moving average over a window, but it cannot *act*: no
webhooks, no retries, no per-graph rate limits, no audit trail, and no live push to the
browser. The database would also become the bottleneck for both reads and actions. The
compiler keeps evaluation next to the actions, and the database stays the durable record.

---

### Security

**19. How is SSRF prevented?**
A user-supplied webhook URL goes through `resolveWebhookUrl()`: the hostname is resolved
once with `dns.lookup(..., { all: true })`; if **any** answer is a private, loopback,
link-local, multicast or cloud-metadata address the request is refused; otherwise the chosen
answer is *pinned* into a dedicated `http`/`https` agent with a custom `lookup`, closing the
DNS-rebinding window between the check and the connection. On top of that: no redirects
(`maxRedirects: 0`), no credentials in URLs, a reserved-header block-list, a 5 s timeout and
a 64 KB response cap. Private destinations require an explicit `ALLOW_PRIVATE_WEBHOOKS=true`
— the local demo needs it to reach its own mock receiver.
[`server/src/integrations/urlSafety.js`](server/src/integrations/urlSafety.js)

**20. How do you prevent NoSQL injection?**
No user string ever reaches a Mongo filter as an operator. Query parameters are parsed by
strict Zod schemas (`z.coerce.number()`, `z.string().datetime()`, enums, `.strict()`) and
stored in `res.locals`, so a `?deviceId[$ne]=null` payload fails validation instead of
becoming a filter. Route params are validated as 24-character hex ObjectIds, so a malformed
id is a 400 rather than a CastError. The telemetry schema also rejects operator-shaped
extra keys (`$bad`) and only accepts numeric extras with safe names.

**21. What about secrets in logs?**
Pino redacts `authorization`, `x-api-key`, cookies and password-shaped paths, and the
request serialiser logs only id/method/path. Outbound targets are masked by `maskPhone`,
`maskEmail`, `safeUrl` and `deliveryDto`, and provider errors are reduced to a safe string
by `safeError` (axios errors embed the full URL and auth config). Delivery request
snapshots are `select: false` and never returned by the API. The env validator also refuses
to echo a received value when reporting an invalid secret.

**22. How is CORS configured?**
An explicit allow-list from `CLIENT_ORIGIN` (comma-separated, trimmed). An empty list is
rejected at boot rather than silently blocking every browser request. No credentials are
used, so there is no cookie/CSRF surface; the ingestion key is a header the operator
chooses to share.

---

### Engineering practice

**23. What did the Day-5 audit find?**
24 findings: 2 Critical, 7 Major, 15 Minor. The two Critical ones were lifecycle bugs —
deleting a graph left its pipeline running (so alerts kept firing for a graph that no longer
existed), and editing an active graph left the *old* rule live while the UI claimed
otherwise. The Major ones were a partial batch failure that both returned 500 and dropped
the durable rows from the rule engine, unbounded WebSocket throttle maps, instrumentation
defaulted on in production, missing process-level rejection handling, a frontend that could
not reach a separately hosted backend, and per-request logging on the hot path. All of them
are fixed, each with a regression test. The full list with severities and rationale is in
[`AUDIT_REPORT.md`](AUDIT_REPORT.md).

**24. How do you know it performs?**
Three scripts, all printing machine-readable JSON so nothing is hand-copied:
`benchmark.js` (total writes, duration, writes/sec, p50/p95/p99, errors, against a
5 000 writes/sec target), `storageReport.js` (time-series vs an equivalent regular
collection, from `collStats`), and `ruleLatency.js` (POST ingestion → alert over WebSocket,
average and p95). Results go into [`PERFORMANCE_REPORT.md`](PERFORMANCE_REPORT.md), which
ships with placeholders rather than invented numbers.

**25. If you had another week, what would you do?**
Move the outbound queue into MongoDB so a crash cannot lose a send; add authentication and
per-user graph ownership; partition rule execution by graph behind a shared bus so the
engine scales horizontally; and add windowed/debounce node types plus a historical replay
mode so an operator can validate a rule against last week's data before switching it on.
The node registry means each of those is an additive change, not a rewrite.

---

## Quick reference — numbers an examiner may ask for

| Question | Answer |
|---|---|
| Ingestion target | 5 000 writes/sec (`npm run benchmark -- --duration 45 --target 5000`) |
| Batch limit | 1000 readings per request (`REQUEST_SIZE_LIMIT` default 1 MB) |
| Rate limits | 300 req/min/IP public, 6000 req/min/IP ingestion |
| WebSocket heartbeat | 30 s ping/pong, dead sockets terminated |
| Broadcast throttle | pass-through under ~20 msg/s, sampled to 10 Hz above that |
| Delivery attempts | 3 total, backoff `OUTBOUND_RETRY_BASE_MS` × 2^(n-1) (250 ms, 500 ms); 4xx never retries |
| Outbound limits | concurrency 4, queue 1000, 30 sends/minute/graph |
| Webhook timeout | 5 s, response capped at 64 KB, no redirects |
| Graph limits | 500 nodes, 2000 edges, `windowSize` 1–1000, cooldown 0–86400 s |
| Tests | 83 unit (Vitest) + 9 Node-test suites + 4 client smoke tests |
