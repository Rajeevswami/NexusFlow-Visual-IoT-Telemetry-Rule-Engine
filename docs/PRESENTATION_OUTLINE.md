# NexusFlow — Presentation Outline (12 slides)

Target: 12–15 minutes plus questions. Every slide lists the *point* to make out loud, the
visual to show, and a fallback if the live demo misbehaves.

| # | Slide | Time |
|---|---|---|
| 1 | Title | 0:30 |
| 2 | The problem | 1:30 |
| 3 | What NexusFlow is (live, 60 seconds) | 2:00 |
| 4 | Architecture | 2:00 |
| 5 | The visual graph builder | 1:30 |
| 6 | From JSON to Observables: the compiler | 2:00 |
| 7 | Time-series storage and the storage saving | 1:30 |
| 8 | Live execution: routing and isolation | 1:30 |
| 9 | Actions, audit and delivery | 1:30 |
| 10 | The dashboard and glowing wires | 1:00 |
| 11 | Day 5: audit, tests, measured performance | 2:00 |
| 12 | Deployment and re-hydration | 1:30 |
| 13 | Limitations and future scope | 1:00 |
| 14 | Closing / questions | — |

---

## Slide 1 — Title

**Content:** NexusFlow: Visual IoT Telemetry & Rule Engine. One line: "Draw a rule on a
canvas; the server turns it into a live stream pipeline."
Show the stack badges: MongoDB time-series · Express · RxJS · React Flow · Docker.

**Visual:** Title slide with the app's editor screenshot (full-bleed, dark theme).

**Say:** "Everything you'll see is running locally right now — the graph on screen is the
program."

---

## Slide 2 — The problem

**Content:** Three bullets — high-frequency sensors make row-per-reading storage expensive;
operators need to change rules without a deploy; and when an alert fires someone must prove
what was sent, to whom, and how many times.

**Visual:** A two-column "before / after": before = a folder of scripts and cron jobs;
after = one canvas and one audit table.

**Say:** "The threshold is the easy part. Everything around it is the project."

---

## Slide 3 — Live demo, 60 seconds

**Content:** Drop a Sensor node, connect Moving Average → Threshold → SMS, save, activate,
press **Send Test Data**, watch the alert land in the Dashboard and in the Alerts page with
a delivery row.

**Visual:** The real app. Editor on the left, Dashboard on the right, one browser each.

**Say:** "That spike was a real HTTP POST. It was stored, routed, evaluated, persisted as an
alert, queued for delivery and pushed back over a WebSocket."

**Fallback:** If the network is down, play the backup recording (see
[`DEMO_CHECKLIST.md`](DEMO_CHECKLIST.md)) and narrate over it.

---

## Slide 4 — Architecture

**Content:** The request lifecycle. Ingest → validate → time-series write → **202** →
`setImmediate` → bus → O(1) routing → per-graph RxJS pipeline → alert + bounded outbound
queue → WebSocket channels → browser.

**Visual:** The ASCII/dataflow diagram from
[`FINAL_REPORT.md`](FINAL_REPORT.md) §4, drawn as a clean horizontal flow with the "202
happens here" marker on the write.

**Say:** "The single most important line on this slide is where the 202 is returned:
everything after it is off the response path."

---

## Slide 5 — The visual graph builder

**Content:** Node palette (source / math / action), typed node cards, live validation with
one-click focus on the offending node, undo/redo, duplicate, auto-layout, templates,
dry-run with sample values.

**Visual:** Three small screenshots: the palette mid-drag, the validation panel, and the
dry-run result panel.

**Say:** "The palette and the server share one node registry, so a new node type is one file
plus one import — the UI cannot drift from the compiler."

---

## Slide 6 — From JSON to Observables

**Content:** `compileGraph()` in five steps — source Subjects, operator pipes, `share()` at
fan-out, leaf subscriptions for actions, `dispose()` for teardown. Mention cycle detection
and per-branch `catchError`.

**Visual:** Left: the graph JSON (nodes + edges). Right: the same graph as a pipeline of
Observables with `share()` drawn at the fan-out and a red "isolated failure" badge on one
branch.

**Say:** "`share()` matters: without it, a node feeding two actions would run its window
logic twice and keep two independent buffers."

---

## Slide 7 — Time-series storage

**Content:** `timeField: timestamp`, `metaField: metadata`, `granularity: seconds`, optional
TTL, the compound index, and the boot-time contract that refuses to start against a
wrongly-typed collection. Then the measured saving.

**Visual:** A bucket diagram (one bucket containing many measurements, versus one document
per measurement) plus the `storage-report` table with the real numbers filled in.

**Say:** "The saving comes from writing the repeated metadata once per bucket instead of
once per reading. Here is the measured comparison, not a claim."

---

## Slide 8 — Live execution

**Content:** `telemetryBus` (one Subject, one pass) → `ruleExecutor` (exact Map lookup +
wildcard side table) → per-graph Subject wrapped in `catchError`. Activation is
compile → register → broadcast, and recompiling disposes the previous pipeline.

**Visual:** The routing table as a Map (`"turbine-001:temperature" → {graph A, graph C}`),
and a small timeline of a recompile showing dispose-before-register.

**Say:** "Routing a reading is one Map lookup. It never loops over graphs, which is what
keeps the cost flat as rules are added."

---

## Slide 9 — Actions, audit and delivery

**Content:** Persist the audit row *before* any network I/O, then return. Bounded queue,
per-graph rate limit, three attempts with backoff, 4xx never retries, atomic manual retry,
masked targets in the API.

**Visual:** The Alerts page: the alerts table, the deliveries table with attempts and
response codes, and one expanded delivery row showing the masked target.

**Say:** "The response never waits for the provider. And every row in that table answers
'was it really sent'."

---

## Slide 10 — Dashboard and glowing wires

**Content:** Channel-based WebSocket fan-out (never a blanket broadcast), adaptive
per-device throttling, buffered chart updates, per-node glow driven by an external store so
only the changed node re-renders.

**Visual:** A screen recording of the canvas glowing during the demo, next to the live chart
and the alert feed.

**Say:** "A device at 100 messages a second produces about five re-renders a second, not a
hundred — that is a design constraint, not an accident."

---

## Slide 11 — Day 5: audit, tests, measured performance

**Content:** 24 audit findings (2 Critical, 7 Major, 15 Minor) with the two Critical ones
named; the test suite (83 unit + 9 HTTP/DB suites + 4 client smoke tests, coverage
enabled); three measurement scripts.

**Visual:** Two tables side by side: left = severity counts and the two Critical fixes;
right = the benchmark output (writes/sec, p50/p95/p99, errors) and the storage ratio, with
real numbers.

**Say:** "The performance report ships with placeholders, not invented numbers — here are
the scripts and the exact commands."

---

## Slide 12 — Deployment and re-hydration

**Content:** Atlas M0 (5.0+, verified) → Render free with a `/api/health` check and
WebSocket support → Vercel/Netlify with SPA rewrites and `VITE_API_URL` / `VITE_WS_URL`.
Then: `npm run bootstrap` flags the template graph `isActive`, and the server recompiles
every flagged graph on boot.

**Visual:** A three-box deployment diagram with the environment variables on the arrows,
plus a before/after of "restart" showing the rule surviving.

**Say:** "A restart no longer silently stops the rules. The flag records the operator's
intent, not the process's transient state."

---

## Slide 13 — Limitations and future scope

**Content:** No authentication; in-memory rule state and queue; narrow graph model; delivery
snapshots contain sensitive data. Future: horizontal rule execution behind a shared bus,
durable delivery queue, auth and multi-tenancy, windowed/debounce nodes, historical replay.

**Visual:** A two-column list with honest wording. Do not oversell.

**Say:** "These are the trade-offs I would make again at this scale — and here is what
changes when the scale changes."

---

## Slide 14 — Closing

**Content:** One-line summary, the repository link, the live demo link (placeholder until
deployed), and the four documents: `FINAL_REPORT`, `AUDIT_REPORT`, `PERFORMANCE_REPORT`,
`VIVA_QA`.

**Visual:** QR code for the repository and one for the live demo.

**Say:** "Draw the rule, and it runs. Thank you — questions?"

---

## Appendix — if there is extra time

- Show `POST /api/graphs/:id/test` (dry run) returning the alerts that *would* have fired.
- Show the WebSocket protocol by hand: `subscribe` → `telemetry` frames in a terminal.
- Show `npm run benchmark` live for 20 seconds so the audience watches the numbers move.
- Show a failed delivery being retried once, atomically, from the Alerts page.
