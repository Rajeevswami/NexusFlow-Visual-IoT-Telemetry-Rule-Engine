# Architecture and design decisions

## Ingestion and storage

HTTP and WebSocket readings share validation and the ingestion pipeline. Accepted readings are persisted in MongoDB before being published on the in-process telemetry bus. MongoDB time-series collections group measurements by metadata and time, reducing index and storage overhead and supporting time-range queries. Retention can be configured when the collection is created; changing the environment later does not retroactively change an existing collection. Readings and alerts are durable in MongoDB; ephemeral simulator and receiver state are not.

## Rules and visualization

The compiler checks the directed graph, instantiates registered operators, then connects RxJS streams: sensor sources are filtered by metadata, transforms maintain windowed state, conditions gate events and action nodes emit alerts. RxJS offers composition, subscription lifecycle and stream operators without implementing a custom runtime for each graph. The active graph manager owns subscriptions; recompile replaces the old pipeline and deactivation/shutdown disposes it. Existing per-node cooldown limits repeated alerts.

WebSocket subscriptions separate telemetry, global alerts and per-graph events. Node activity and per-edge events are optional and the latter are throttled per edge. On the client a small external store notifies only subscribed node/edge components; glow expires after roughly 600 ms. This reduces React canvas-wide updates but is not a substitute for profiling very large graphs.

## Deliveries and safety

Actions create a DeliveryLog before queueing. A bounded in-memory queue limits parallel deliveries; a per-graph in-memory budget and node cooldown reduce bursts. Webhooks validate schemes, resolve and check every DNS answer, pin DNS to the connection, disallow redirects, time out and retry only network/5xx failures up to three attempts. Manual retry atomically claims a failed record and uses its stored request. SMS defaults to a mock; Twilio and SMTP are optional. Sensitive targets are masked in API/log output, but retry snapshots may hold credentials in MongoDB, so encrypt and restrict database access.

## Scale and production work

The bus, queue, cooldowns, active graphs, rate limits, demo simulator and mock receiver are process-local. Multiple API instances do not share routing or coordinate delivery. A process crash can leave pending delivery records; no durable queue/recovery is implemented. For horizontal scale, move telemetry and actions to Redis Streams/Kafka (partition by device/graph), use a durable worker queue with idempotency and dead-letter policies, and coordinate ownership/activation and rate limits. CPU-heavy rule evaluation could move to worker threads or dedicated engine workers. Consider backpressure, observability/metrics, long-term retention, graph versioning, encryption at rest, secrets management, tenant isolation and RBAC before production. The public APIs and WebSocket subscriptions have no user authentication; ingestion API keys alone do not secure the app. Deploy behind authenticated infrastructure with network egress restrictions and TLS.
