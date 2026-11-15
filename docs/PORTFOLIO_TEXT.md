# Resume and portfolio text

## Resume bullets

- Built a visual IoT rule-authoring application using React, React Flow, Express and RxJS, enabling users to compose sensor, transformation, condition and action nodes.
- Implemented MongoDB time-series telemetry storage and HTTP/WebSocket ingestion; measure throughput on your target hardware and replace **[X readings/s]** with the benchmark result.
- Added threshold-driven alerting with mock/optional SMS, email and webhook actions, bounded retries and delivery audit logs; report **[X tests passing]** after running the full Mongo-backed suite.
- Implemented live dashboard and graph activity updates over WebSockets, plus persisted graph activation and boot-time rehydration; verify with a restart test before claiming operational results.

## LinkedIn project description (3 lines)
NexusFlow is a visual IoT telemetry and rule-engine project built with React Flow, Express, RxJS, MongoDB and WebSockets.
It turns saved node graphs into server-side streaming rules, with telemetry history, alerts, delivery auditing and a live dashboard.
The demo uses mock SMS/email/webhook integrations; benchmark and deployment results are environment-dependent.

## 60-second spoken pitch
NexusFlow is a visual IoT telemetry and rule engine. Instead of writing each rule as custom glue code, a user connects sensor, moving-average, threshold and action nodes in a React Flow editor. The client saves the graph, while an Express server validates and compiles it into an RxJS pipeline. Telemetry comes in over HTTP or WebSockets and is stored in MongoDB's time-series collection. When a rule matches, the system creates an alert and queues an audited delivery; mock SMS and webhook actions make the demo safe. WebSocket events drive the live chart, alerts and graph activity indicators. The focus is on making the pipeline observable, not just configurable. For a production deployment I would prioritize authentication and tenant isolation, plus operational validation under measured load.

## What I would improve next

- Move expensive transformations and persistence pressure off the event loop with worker threads or a dedicated processing tier.
- Add Redis or Kafka for durable, horizontally scalable ingestion and fan-out.
- Add MQTT ingestion for device-native connectivity and backpressure controls.
- Implement authentication, authorization, tenant isolation, secrets management and per-tenant quotas.
- Add graph versioning, deployment/rollback history and explicit migration semantics.
- Expand browser-level E2E and Mongo-backed CI coverage, and establish repeatable performance baselines.
