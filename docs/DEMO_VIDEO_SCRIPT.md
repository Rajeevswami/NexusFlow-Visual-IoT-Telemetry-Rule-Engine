# Three-minute demo recording script

| Time | Click / action | Exact narration |
|---|---|---|
| 0:00–0:20 | Show title and editor canvas. | “IoT systems produce streams of readings, but turning those readings into reliable, observable actions often means stitching together code and services. NexusFlow makes those rules visible and testable as a graph.” |
| 0:20–0:45 | Point at palette and add Turbine Sensor, Moving Average, Threshold, SMS Alert and Webhook nodes. | “A sensor feeds a five-reading moving average. The threshold checks whether the result exceeds eighty, then routes the event to mock SMS and webhook actions.” |
| 0:45–1:10 | Connect nodes and set sensor/device, window 5, threshold > 80, mock action configs. Click Save, refresh, load graph. | “The graph and node configuration are saved together. After reloading, I load the saved graph and confirm its settings and connections are intact.” |
| 1:10–1:30 | Activate graph; open Live Mode or dashboard. | “Activation compiles the saved graph into a server-side stream pipeline. The dashboard subscribes to live telemetry and graph activity.” |
| 1:30–2:00 | Start simulator with spikes; show glowing wires and chart. | “The simulator sends ordinary readings with periodic anomaly spikes. Values move through the graph, animated edges show activity, and the chart updates in real time.” |
| 2:00–2:25 | Open alerts page and delivery log. | “When the moving average crosses the threshold, an alert is recorded. The mock SMS and webhook keep this demonstration safe while the delivery log records outcomes.” |
| 2:25–2:40 | Deactivate; continue simulator briefly. | “I deactivate the graph. Telemetry may continue to arrive, but this graph no longer produces new alerts.” |
| 2:40–3:00 | Show architecture diagram / terminal test summary. | “The architecture is React Flow in the browser, an Express API, MongoDB time-series storage, RxJS rule execution, and WebSocket updates. Persistent active graphs are designed to rehydrate on server boot; this run demonstrates the live path.” |

## Capture list

- `docs/screenshots/canvas-glow.png` — connected graph with activity glow.
- `docs/screenshots/dashboard.png` — live chart and engine status.
- `docs/screenshots/alerts-delivery.png` — alert and delivery status.
- `docs/screenshots/mongosh-timeseries.png` — mongosh collection options and a sample timestamp stored as BSON Date.
- `docs/screenshots/benchmark.png` — actual `npm run benchmark` output, with hardware/context noted.
- `docs/screenshots/storage-report.png` — actual storage report output.
- `docs/screenshots/test-coverage.png` — actual coverage command summary.

Only publish genuine captures and measured outputs; redact credentials and personal data.

## Demo failure plan

- Internet unavailable: use the local Docker stack and locally built assets; keep a screen recording and clearly label any prerecorded segment.
- MongoDB unavailable: start the bundled MongoDB container and wait for its health check. If persistence still fails, stop and explain the limitation; do not claim a successful storage or rehydration demo.
- Deployed server sleeps/fails: wake it before recording, verify `/api/health`, then switch to local Docker. Keep local demo data seeded. Do not present stale screenshots as live activity.
- Mock outbound delivery fails: verify mock receiver and delivery logs; show the failure status honestly rather than substituting a claimed success.
