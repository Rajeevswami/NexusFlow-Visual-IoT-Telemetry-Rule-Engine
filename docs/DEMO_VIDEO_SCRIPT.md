# Three-minute screen recording

## Preflight (off camera)

This is a recording plan, **not evidence of a completed demo**. Do not record a success claim
until the README live gates pass. Use local MongoDB 7, mock SMS/email, and the server's local
webhook receiver; set ALLOW_PRIVATE_WEBHOOKS=true, MOCK_RECEIVER_ENABLED=true and
NODE_ACTIVITY_ENABLED=true only for this local demo. No provider credentials required.

- Start the stack and confirm /api/health is 200. Install/build Docker images and npm dependencies
  before review day; offline fallback only works if these are already cached.
- Rehearse scripts/e2eCheck.js against a disposable demo DB. It uses a separate unique device,
  so the dashboard for turbine-001 will not show its readings.
- Prepare two terminal tabs at the repository root. Start the normal simulator:
  `npm --prefix server run simulate -- --devices 1 --interval 500 --spikes 0`.
  For Docker append `--url http://localhost:8080` to each simulator command.
- Keep the anomaly command ready: `npm --prefix server run simulate -- --devices 1 --interval 500 --spikes 1`.
  Stop the normal simulator with Ctrl+C before starting this. A 4% random spike rate does not
  reliably cross a five-sample moving average during a short recording.
- Build/rehearse once so node placement fits the recording time. Keep graph name unique.
  Use temperature sensor turbine-001, MA window 5, threshold `>` / 80, SMS phone +911234567890
  with cooldown 10 seconds, webhook POST to http://127.0.0.1:5000/api/mock/webhook-receiver
  with cooldown 10 seconds. The URL is reached by the API process, not the browser.
- Keep Dashboard device selection on turbine-001 and Live Mode enabled. Watch browser/server
  consoles during rehearsal. Verify Save → reload → Load and real API process restart separately.

## Timeline and exact narration

| Time | Click / action | Say exactly |
|---|---|---|
| 0:00–0:20 | Show project title, then editor. | “IoT devices produce a continuous stream of readings. Turning those readings into useful alerts usually means writing custom integration code, and it can be difficult to see why an alert fired. NexusFlow makes that path visible as a graph.” |
| 0:20–0:45 | Drag Sensor, Moving Average, Threshold, SMS Alert and Webhook from palette; arrange left to right. | “Here I am building a turbine temperature rule. The sensor feeds a moving average, followed by a threshold. The matching event branches into a mock SMS action and a webhook to our local test receiver.” |
| 0:45–1:10 | Connect Sensor → Average → Threshold → SMS and Threshold → Webhook. Set the rehearsed configs, click Save, reload browser, click Load and select the saved name. Inspect window/threshold. | “The average uses five readings, and the condition is greater than eighty. I save the graph, reload the page, and load it again. Both the settings and all four connections are retained in the saved graph.” |
| 1:10–1:30 | Click Activate, enable Live Mode. Stop normal simulator and run the prepared `--spikes 1` command. | “Activate compiles the saved graph on the server. I now switch the simulator from normal readings to sustained anomaly spikes. This deliberately demonstrates the threshold after smoothing, rather than relying on a lucky random spike.” |
| 1:30–2:00 | Show glowing canvas, then Dashboard chart with turbine-001 selected. | “The activity indicators show events moving through the nodes and connections. The dashboard receives live readings over WebSockets. The moving average smooths individual measurements; sustained high temperatures pass the threshold and reach both action branches.” |
| 2:00–2:25 | Open Alerts and inspect successful SMS/webhook delivery records. | “These are the alerts and their delivery outcomes. The SMS provider is mocked, so no real message is sent. The webhook reaches the local receiver. A success entry is evidence of delivery; a pending or failed entry is not.” |
| 2:25–2:40 | Return to editor, click Deactivate; keep simulator running briefly, inspect latest alerts, then Ctrl+C. | “I deactivate the graph while telemetry continues. This graph stops generating new alerts. Deliveries already queued may still finish, so I distinguish those completions from newly triggered alerts.” |
| 2:40–3:00 | Show README architecture diagram and genuine test summary. | “React Flow handles authoring. Express validates and stores graphs, MongoDB stores time-series readings, and RxJS evaluates active rules. WebSockets carry updates to the browser. Active graphs have boot-time rehydration, but persistence and restart behavior need explicit verification, not assumptions.” |

If a narrated outcome does not occur, stop the take and diagnose it. Do not narrate success over
stale UI. The recording does not replace an actual server restart test: retain that evidence separately.

## Screenshot checklist (real captures only)

| Filename under docs/screenshots/ | Capture and context |
|---|---|
| editor.png | Five-node graph, visible configs for MA(5) and >80; all four edges. |
| canvas-glow.png | Same active graph with live wire/node activity. |
| dashboard.png | turbine-001 chart moving with engine status and observation window. |
| alerts-delivery.png | Both SMS and webhook success statuses; redact sensitive targets. |
| mongosh-timeseries.png | `db.getCollectionInfos({name: "telemetry"})`, `db.telemetry.findOne()`, `db.telemetry.getIndexes()`; show BSON Date, metadata and index. |
| benchmark.png | Genuine `npm run benchmark -- --duration 45 --target 5000` output from server/; note machine, date, batch size and errors. |
| storage-report.png | Genuine `npm run storage-report` output from server/; only on a disposable database. |
| test-coverage.png | Root `npm run test:coverage` and `npm --prefix client run test:coverage`; disclose suite scope and skips. |
| restart-rehydration.png | Active graph ID before/after actual API restart and post-restart alert evidence. |

Optional `demo.gif`: short authentic canvas excerpt, not a generated illustration. No benchmark,
storage result, screenshot or video was captured during this stabilization session.

## Demo failure plan

- **Internet fails:** use already-cached Docker images/local dependencies and local MongoDB.
  Fonts are bundled. Mock actions avoid third-party providers. If local setup is not ready,
  play an explicitly labeled prerecorded demo; do not imply it is live.
- **MongoDB fails:** check `docker compose ps` and `docker compose logs mongo server`.
  Start Mongo, wait for health, restart the API, and verify /api/health. Do not delete the volume
  or production data to repair a demo. If it still fails, show the error and explain the storage
  dependency; use prerecorded evidence with date and context.
- **Deployment fails/sleeps:** warm /api/health before the review. If still unavailable, switch
  to http://localhost:8080. For separate hosting, check CLIENT_ORIGIN, HTTPS API URL and WSS
  URL. Never disable authentication/security controls on a public deployment just to finish a take.
- **No threshold alert:** confirm device/sensor match, all edges saved, graph active, MA window 5,
  threshold >80 and sustained spikes. Check cooldown/rate limits before retrying.
- **Delivery failure:** inspect delivery status/error, mock flags and server-reachable receiver URL.
  Do not substitute the existence of a log row for a successful delivery.
- **Visuals freeze:** inspect socket status, Live Mode and NODE_ACTIVITY_ENABLED; reconnect once,
  not repeated page reloads. If unresolved, demonstrate API evidence and explicitly disclose that
  the visual path failed.
