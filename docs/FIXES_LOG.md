# Day 6 stabilization log

Verified 2026-11-16 on Node 22.22.3 / npm 10.9.8, Linux. No new product features.
This supersedes earlier verification claims. PASS below means a command actually ran;
static inspection is not runtime verification.

## Problems → causes → fixes

| Problem | Cause | Fix / evidence |
|---|---|---|
| E2E ingestion always rejected | Required `metadata.location` absent | Add location; require the accepted count to equal the batch size. |
| Failed deliveries could produce PASS | Check only counted records, not outcomes | Poll with a deadline for four successful deliveries (two matching MA windows × two actions), both channels, and correlated receiver evidence. Failed deliveries now fail the check. |
| E2E contaminated by other runs and clock skew | Shared turbine ID, broad history query, timestamp cutoff | Unique device/graph per run, graph-scoped queries, compare alert/delivery IDs after deactivation instead of clocks. |
| E2E did not inspect persistence/live events | No load or WebSocket assertions | Compare nodes/edges/viewport after GET; require telemetry, node/edge activity, alerts and delivery events. Browser visuals remain unverified. |
| E2E could hang or leave active test rules | No fetch deadlines; incomplete cleanup | Bounded HTTP/socket/poll waits, nonzero exit on failure, explicit blocked-step output, graph deletion and socket teardown. Audit/telemetry records intentionally remain in the disposable DB. |
| Docker host URL wrong for callback | Host-accessible `E2E_URL` reused as server-side callback origin | Default callback is server-local `127.0.0.1:5000`; document `DEMO_WEBHOOK_URL` separately from `E2E_URL`. |
| Root script emits module warning | Root package did not declare ESM | Declare `type: module`. Server/client already have independent module configurations. |
| Client test dependency advisories; coverage script missing provider | Old Vitest tree and no coverage-v8 dependency | Upgrade client Vitest to 5.1.0 and install matching coverage provider; rerun tests and coverage. |
| Server development dependency advisories | Nodemon's minimatch dependency is vulnerable; audit fix did not resolve it | Use Node's built-in `--watch` for development and remove nodemon. No runtime behavior change. |
| README advertised unsupported Node 20 | Vitest 5 requires newer Node; jsdom 31 requires at least 22.22.2 on 22.x | Align root/client/server engines and README/deployment prerequisite; verified on 22.22.3. Refresh both lockfiles. |
| Distinct source identifiers collided | `deviceId:sensorType` is ambiguous when identifiers contain colons | Encode source tuple as JSON for register/route/unregister; regression test passes. |
| Client could start before API readiness in Compose | Only Mongo had a healthcheck; client depended on process start | Add API healthcheck using built-in fetch and require healthy server before client startup. Docker execution still blocked. |
| Script environment examples incomplete | Only application schema variables listed | Add simulator, latency, benchmark, engine-check and E2E defaults. Explain root script environment loading explicitly. |
| Secret variants could enter Docker build context | `.dockerignore` only excluded `.env` | Exclude `.env.*` in both images; gitignore additionally excludes build/, private key files. |
| README example reading failed validation | Missing location; advertised unsupported sensorType query | Correct reading and telemetry GET query example. |
| Misleading deployment/asset claims | Missing production env examples, broken screenshot links, unconditional restart guarantee | Link actual env example, use textual capture placeholders, remove unverified deployment claim and state persistence limits. |
| Demo unreliable with MA(5) | Sparse random spikes need not cross the smoothed threshold | Document an explicit `--spikes 1` rehearsal command and deterministic API-check batch. This is a demo/check setting, not a simulator behavior change. |

## Commands actually executed

| Command / check | Result |
|---|---|
| `npm install --prefix server`, `npm install --prefix client` | PASS from initially absent node_modules; rerun after dependency changes. |
| `npm run install:all` | PASS after all dependency changes; npm ci for each folder. |
| `npm ls --prefix server --depth=0`, client equivalent | PASS, no missing/invalid direct dependencies. Separate apps may use different compatible ranges; installed Axios versions match. |
| `npm test` | PASS: 84 server unit tests, 15 HTTP tests; **5 DB tests skipped**. Client: 1 logic test, 4 smoke tests. |
| `npm run test:coverage` | PASS, server unit coverage only: statements 43.28%, branches 42.96%, functions 41.95%, lines 46.14%. Not full integration coverage. |
| `npm --prefix client run test:coverage` | PASS; smoke-test instrumentation, not browser E2E or Node-runner coverage. |
| `npm run build` | PASS again after final clean lockfile installs. |
| `npm audit --prefix server`, client equivalent | Initial: 2 moderate server; 1 moderate + 2 critical client. After fixes: zero advisories in both. Advisory databases change. |
| `npm --prefix server start` | FAIL: MongoDB connection refused at 127.0.0.1:27017; exits cleanly rather than claiming readiness. |
| `npm run test:db` | BLOCKED/exit 1: temporary MongoDB binary download fails with ECONNRESET from fastdl.mongodb.org (not permitted by workspace network policy). |
| `node scripts/e2eCheck.js` | FAIL/exit 1 without live API; later steps explicitly blocked. No successful live E2E claimed. |
| `npm --prefix client run dev`, HTTP request to `/` | PASS: Vite listening on 0.0.0.0:5173, HTTP 200. Stopped after verification. |
| Vite `/api/health` | FAIL: HTTP 500 with ECONNREFUSED to absent API. This does not verify client/server integration. |
| Docker / mongosh | BLOCKED: executables absent; no image build, Compose start, collection inspection or process-restart test performed. |

Three checker contract tests passed using a fake HTTP/WebSocket service to verify success, failed-webhook rejection,
required location, blocked-step reporting and cleanup. These are not a live application E2E run.

The real compiler was also exercised in dry-run mode with the sample graph plus webhook,
validated readings `[45,45,45,45,45,99,99,99,99,99]`, MA(5), threshold >80: four action
results were asserted successfully. This verifies check expectations without claiming persistence
or provider delivery.

## Common failure-point inspection

- React Flow: nodeTypes and edgeTypes are module-level constants; main entry imports Flow CSS.
  Node edit handlers update graph state; serializer retains config and edges; Graph stores Mixed JSON.
  Existing jsdom canvas/serialization tests pass, but real browser reload/input behavior is still a release gate.
- WebSockets: same-origin URL selects ws/wss from page protocol; separate hosting requires VITE_WS_URL.
  Provider reference-counts channels, cleans timers/sockets on effect teardown, and backs off reconnects.
  Server deduplicates channel delivery. Real reconnect/StrictMode console behavior was not observed.
- MongoDB: ingestion validator converts timestamps to Date and requires a structured metadata object.
  Collection bootstrap checks time-series options and creates a named metadata/timestamp index.
  No live collection or index evidence exists here.
- RxJS: source Subjects use node IDs per graph; executor keys now encode device/sensor tuples safely.
  Recompile disposes the previous pipeline; tests cover unregister and replacement. Action errors are
  caught per event. Transform errors terminate only the affected branch until reactivation.
- CORS/proxy: Vite and nginx route /api and /ws; browser defaults are same-origin. Separate deployed
  frontend requires matching CLIENT_ORIGIN and HTTPS API/WSS overrides. No deployment was tested.
- Console checks: test suites deliberately exercise error paths; their logged failures are not
  production-console evidence. Server startup and Vite proxy errors above are real unresolved environment blockers.
- Persistence risk: ActiveGraphManager writes isActive asynchronously/best-effort. Rapid state changes,
  failed DB writes or immediate restart can leave stale intent. This was not redesigned during this pass;
  it is explicitly in README Known Issues and prevents claiming crash-safe activation.

## Environment and dependency inventory

Compared application env schema plus `process.env` references in server scripts/tests and root E2E
against server/.env.example. Client `.env.example` includes VITE_API_BASE_URL, VITE_API_URL,
VITE_WS_URL and VITE_PROXY_TARGET (last consumed by Vite loadEnv). No environment credentials
are needed for mock SMS/email. CLI flags may override script defaults. Simulator/benchmark scripts
read the shell; they do not automatically load server/.env. Use Node `--env-file` or export values.

Direct imports/configuration were inspected alongside `npm ls`; no missing direct packages found.
Nodemon was removed as redundant. This is not an exhaustive proof that every export/package is used.

## Repository hygiene and historical secrets

MIT LICENSE and portfolio text already existed; kept rather than inventing results. No CONTRIBUTING
file added. Current tracked env files are only client/.env.example and server/.env.example. A limited
credential-pattern scan flagged only the clearly labeled USER:PASSWORD deployment placeholder.
Visible history contains no tracked real `.env`; **the checkout is shallow**, so this is not a complete
history audit or a guarantee that no secret ever existed. Do not include real provider credentials in
sample graphs, screenshots, delivery snapshots or logs.

Before publication, audit a full clone with a secret scanner and inspect all refs. If anything was
committed: (1) revoke/rotate the credential first; (2) coordinate a history rewrite in a separate full
maintenance clone; (3) use git-filter-repo to remove exact affected paths, for example:

```sh
git filter-repo --path .env --path server/.env --path client/.env --invert-paths
```

For secrets embedded in other files, use a reviewed `--replace-text` rule instead (never paste the
secret into chat). Verify every relevant branch/tag, then have the repository owner perform the
coordinated force-push and GitHub sensitive-data cleanup. Collaborators must re-clone; forks,
PR refs, caches and backups may retain old data. Simply adding .gitignore or a deletion commit does
not remove history. No rewrite or force-push was performed in this session.

## Submission decision

**NO-GO for complete Day 6 sign-off.** Install/test/build gates can pass independently of the live
stack. Run the README Mongo-backed, Docker, browser and actual restart gates; capture real assets;
review full history. Do not convert blocked checks into PASS based on source review or mocked tests.
