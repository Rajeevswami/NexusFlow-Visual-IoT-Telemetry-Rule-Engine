# Deploying NexusFlow (free tier)

Three pieces, all with a usable free tier:

| Piece | Service used here | Free-tier notes |
|---|---|---|
| Database | **MongoDB Atlas** M0 | Must be **5.0 or newer** for time-series collections |
| API | **Render** (or Railway) | WebSockets supported; the instance sleeps when idle |
| Frontend | **Vercel** (or Netlify) | Static build, SPA rewrites |

Estimated time: 30–45 minutes.

> This deployment has **no user authentication**. Anyone who knows the URLs can read and
> write. Keep `INGEST_API_KEY` set, keep the demo endpoints off, and use non-sensitive
> demo values for phone numbers and webhook targets.

---

## 0. Prerequisites

- Node 20+ locally (`node -v`).
- The repository cloned; `server/` and `client/` are the deploy roots.
- A GitHub account (all three hosts deploy from a Git repository).

---

## 1. Database — MongoDB Atlas

1. Create a free **M0** cluster. Choose the region closest to your API host.
2. **Database Access** → add a database user with a strong password (not your Atlas
   login).
3. **Network Access** → add `0.0.0.0/0` (Render and Railway use dynamic IPs; the database
   is still protected by the user password and the ingestion key). Tighten this later if
   your host publishes static egress IPs.
4. **Connect** → *Connect your application* → copy the SRV string. It looks like:

   ```text
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/nexusflow?retryWrites=true&w=majority
   ```

   Replace `USER`/`PASSWORD` (URL-encode special characters) and keep `/nexusflow`.

### Confirm the tier supports time-series collections

Time-series collections were introduced in **MongoDB 5.0**. M0 clusters run a recent
major version, so they are fine — but verify before you rely on it:

- In the Atlas UI: **Cluster → Overview → MongoDB version** must be `5.0` or higher.
- Or from `mongosh`:

  ```js
  db.version()                     // >= 5.0
  db.createCollection("ts_probe", { timeseries: { timeField: "t", metaField: "m", granularity: "seconds" } })
  db.runCommand({ listCollections: 1, name: "ts_probe" }).cursor.firstBatch[0].options
  db.ts_probe.drop()
  ```

The server also refuses to start against a `telemetry` collection that is *not* the
expected time-series collection, so a misconfigured cluster fails loudly at boot rather
than silently degrading.

> **Do not create the `telemetry` collection yourself.** `connectDatabase()` creates it
> with the right options (and the optional TTL) on first boot.

---

## 2. Backend — Render

### Option A — Blueprint (recommended)

1. Push the branch to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repository. Render reads
   [`render.yaml`](../render.yaml) at the repository root.
3. Fill in the two `sync: false` secrets when prompted: `MONGODB_URI` and `CLIENT_ORIGIN`.
4. Deploy. The health check is `GET /api/health`; the service is "live" only once MongoDB
   answers.

### Option B — Manual web service

| Setting | Value |
|---|---|
| Root directory | `server` |
| Runtime | Node |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Instance type | Free |

### Environment variables

`server/.env.production.example` is the annotated list. Minimum viable set:

| Variable | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Enables the production defaults and error hiding |
| `MONGODB_URI` | Atlas SRV string | Database |
| `CLIENT_ORIGIN` | `https://your-app.vercel.app` | CORS allow-list (comma-separated, no trailing slash) |
| `INGEST_API_KEY` | 32+ random chars | **Required** in production; sent as `x-api-key` |
| `NODE_ACTIVITY_ENABLED` | `false` | Saves a tap per node per reading on a small instance |
| `ALLOW_PRIVATE_WEBHOOKS` | `false` | **Keep SSRF protection on** |
| `DEMO_ENABLED` / `MOCK_RECEIVER_ENABLED` | `false` | Public demo endpoints |
| `SMS_PROVIDER` / `EMAIL_PROVIDER` | `mock` | No credentials needed |

Generate the key with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### WebSocket support

Render and Railway both support WebSocket upgrades on every plan (they are ordinary HTTP
upgrades). Nothing special is required on the server side — `attachWebSocketServer` mounts
`/ws` on the same HTTP server as the REST API, so one URL and one port serve both.

- The server pings every 30 s and terminates sockets that miss a pong, so dead connections
  are reaped even when a proxy is silently holding them.
- The client reconnects with exponential backoff (0.5 s → 30 s) and **replays every
  channel subscription on reconnect**, so a dropped socket never loses a subscription.
- If you put a CDN or a second proxy in front, make sure it forwards the `Upgrade` and
  `Connection` headers and does not time the idle socket out below 30 s.

### CORS

`CLIENT_ORIGIN` is the only allowed origin list. Add every hostname you will use
(`https://your-app.vercel.app,https://your-app.netlify.app`). An empty value is rejected at
boot rather than silently blocking every browser request.

### Railway instead

Set the root directory to `server` and the start command to `npm start`; Railway injects
`PORT` (the server already reads it). [`server/Procfile`](../server/Procfile) is provided
for platforms that expect one.

---

## 3. Frontend — Vercel

1. **New Project** → import the same repository.
2. **Root directory:** `client`.
3. Framework preset: **Vite**. Build command `npm run build`, output `dist` (already in
   [`client/vercel.json`](../client/vercel.json)).
4. **Environment variables** (baked in at build time — a change needs a redeploy):

   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | `https://your-api.onrender.com/api` |
   | `VITE_WS_URL` | `wss://your-api.onrender.com/ws` |

   `VITE_WS_URL` **must** be `wss://`: browsers refuse an insecure `ws://` connection from
   a page served over `https://`.
5. Deploy. `/dashboard` and `/alerts` work on a hard refresh because `vercel.json`
   rewrites every non-asset path to `index.html`.

### Netlify instead

- Base directory `client`, build `npm run build`, publish `dist`.
- [`client/public/_redirects`](../client/public/_redirects) provides the SPA fallback.
- Same two environment variables in *Site settings → Build & deploy → Environment*.

---

## 4. Seed the deployed app

The deployed database starts empty: no devices, no template graphs, no live rule. Run the
bootstrap **once**, from your machine, against the Atlas cluster:

```sh
cd server
MONGODB_URI='mongodb+srv://…/nexusflow?retryWrites=true&w=majority' npm run bootstrap
```

This is safe to re-run: it upserts the demo devices and the two template graphs by key,
writes ~30 minutes of history only if the marker documents are missing, and flags the
primary *Turbine Overheat Alert* graph `isActive: true`.

Because of Day-5 re-hydration, that flag is all the running server needs: on its next boot
it recompiles every graph flagged `isActive`. So after a restart — or after a free-tier
instance wakes up — the deployed app still has a live rule and the Dashboard has data.

To switch the rule off again, either press **Deactivate** in the editor (which clears the
flag) or run:

```sh
MONGODB_URI='…' node -e "import('mongoose').then(async ({default:m})=>{await m.connect(process.env.MONGODB_URI);await m.connection.db.collection('graphs').updateOne({templateKey:'turbine-overheat'},{\$set:{isActive:false}});console.log('cleared');await m.disconnect();})"
```

---

## 5. Verify the deployment

```sh
API=https://your-api.onrender.com

# health (Render uses this as the health check)
curl -s $API/api/health
# -> {"status":"ok","database":"connected"}

# node types the compiler knows about
curl -s $API/api/templates

# ingest a reading (needs the key you generated)
curl -s -X POST $API/api/telemetry \
  -H 'Content-Type: application/json' -H "x-api-key: $INGEST_API_KEY" \
  -d '{"metadata":{"deviceId":"turbine-001","sensorType":"temperature","location":"Deploy check"},"value":96,"unit":"°C"}'

# the rule should have fired
curl -s "$API/api/alerts?deviceId=turbine-001&limit=5"

# engine status
curl -s $API/api/engine/status
```

Then open the frontend: the editor loads, the Dashboard shows the device, and pushing
"Send Test Data" makes the alert appear in the feed within a second or two.

---

## 6. Free-tier caveats

| Caveat | What it looks like | Mitigation |
|---|---|---|
| **Cold start / sleeping** | The first request after ~15 idle minutes takes 10–60 s or fails with a 502/503 | Wake it *before* the demo: `curl -s $API/api/health` (repeat until `ok`), or keep a 5-minute uptime ping. The client reconnects automatically once the server is back. |
| **Atlas M0 limits** | 512 MB storage, shared CPU | Time-series storage is compact; set `TELEMETRY_RETENTION_SECONDS` before the first boot if you plan to ingest for a long time (creation-only). |
| **Render free build minutes** | Builds queue at peak times | `npm ci` in the container is cached between deploys; keep the Dockerfile-free Node build (no `docker build` step). |
| **No persistent disk** | A restart loses in-memory state | Active graphs are re-hydrated from MongoDB on boot; only the mock receiver inbox and the in-flight delivery queue are in memory. |
| **Rate limits** | `429` from `API_RATE_LIMIT` (300/min/IP) or `INGEST_RATE_LIMIT` (6000/min/IP) | Raise them in the environment; both are per-IP. |
| **WebSocket idle timeouts** | A dashboard tab that is backgrounded for hours may stop updating | The client's reconnect loop fixes it on tab focus; the server also reaps dead sockets every 30 s. |

---

## 7. Waking the server before a demo

```sh
# one-liner: poll until the API answers
until curl -sf https://your-api.onrender.com/api/health | grep -q '"status":"ok"'; do
  echo "waking…"; sleep 3
done
echo "API is up"
```

Keep that tab open during the demo, and open the frontend only after it prints `API is up`.
If the instance is asleep, the first `curl` may take a minute — that is the cold start, not
a failure.

---

## 8. Docker (local or a VM)

The repository also ships a complete local stack:

```sh
docker compose up --build
# frontend: http://localhost:8080
# API:     http://localhost:5000/api/health
```

`docker-compose.yml` enables the private-webhook escape hatch **because the demo webhook
targets the server's own mock receiver**. That configuration is for a local demo only —
do not reuse it on the public internet.

---

## 9. Production checklist

- [ ] `NODE_ENV=production`
- [ ] `INGEST_API_KEY` set to 32+ random characters, stored only in the host's env settings
- [ ] `MONGODB_URI` points at Atlas with a dedicated, least-privilege database user
- [ ] `CLIENT_ORIGIN` lists the deployed frontend origin(s) exactly
- [ ] `ALLOW_PRIVATE_WEBHOOKS=false`
- [ ] `DEMO_ENABLED=false`, `MOCK_RECEIVER_ENABLED=false` (unless demoing)
- [ ] `NODE_ACTIVITY_ENABLED=false` unless the glowing wires are part of the demo
- [ ] `npm run bootstrap` has been run once
- [ ] `GET /api/health` returns `{"status":"ok"}`
- [ ] An ingested reading produces an alert within a second
- [ ] A restart of the API service brings the active rule back (re-hydration)
