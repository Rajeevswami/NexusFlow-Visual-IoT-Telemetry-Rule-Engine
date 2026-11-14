# NexusFlow — Pre-Demo Checklist

Work top to bottom. The demo is a live system: the failure modes are a sleeping server, a
cold database, a stale browser tab and a network drop. Everything below exists to remove
those four.

**T-minus 30 minutes — build the environment**

- [ ] `git pull` and confirm you are on the branch you intend to show.
- [ ] `cd server && npm ci` (only if `node_modules` is missing).
- [ ] `cd client && npm ci` (same).
- [ ] MongoDB is running and reachable: `mongosh --quiet --eval "db.version()"` → must be
      **5.0 or newer**.
- [ ] No other process is on port 5000 (`lsof -i :5000` / `netstat -ano | findstr 5000`).
- [ ] Terminal font size increased; editor zoom at 100%; notifications off.

**T-minus 20 minutes — start the stack**

- [ ] `cd server && npm start` → wait for `NexusFlow API listening` **and** the
      re-hydration line (`Active graph re-hydration complete`) if graphs were active.
- [ ] `curl -s localhost:5000/api/health` → `{"status":"ok","database":"connected"}`.
- [ ] `cd client && npm run dev` → open http://localhost:5173.
- [ ] If `INGEST_API_KEY` is set: export it in the shell you will use for the simulator
      (`export INGEST_API_KEY=…`).

**T-minus 15 minutes — seed and verify the data**

- [ ] `cd server && npm run seed` (or `npm run bootstrap` to also flag the turbine rule
      active).
- [ ] `curl -s "localhost:5000/api/telemetry?deviceId=turbine-001&limit=3"` returns rows.
- [ ] `curl -s localhost:5000/api/templates` returns both templates.
- [ ] In the editor: **Load** → *Turbine Overheat Alert* → **Activate** → the badge reads
      *Pipeline active*.
- [ ] `curl -s localhost:5000/api/engine/status` shows `activeGraphs: 1`.

**T-minus 10 minutes — run the whole demo once, end to end**

Do a full rehearsal. It is the only way to find the problem while you can still fix it.

- [ ] Press **Send Test Data** → the Dashboard chart moves, an alert toast appears, and the
      Alerts page shows the alert with a delivery row.
- [ ] Press **Run Demo** → the split view appears, wires glow, alerts arrive, and the mock
      receiver tab (`Alerts → Mock Receiver`) shows the webhook payload.
- [ ] Press **Stop Demo** → the split view closes and the graph is deactivated.
- [ ] Confirm the WebSocket indicator reads *Stream live* on the Dashboard.
- [ ] Check the browser console for errors. **Zero** red lines. (A single
      `WebSocket server error:` warning is acceptable; anything else is not.)

**T-minus 5 minutes — browser tabs, in this order**

| # | Tab | URL |
|---|---|---|
| 1 | Editor | `http://localhost:5173/` |
| 2 | Dashboard | `http://localhost:5173/dashboard` |
| 3 | Alerts & deliveries | `http://localhost:5173/alerts` |
| 4 | Engine status (curl output, refreshed) | `curl -s localhost:5000/api/engine/status` |
| 5 | Repository README on GitHub | — |
| 6 | Slides | full screen, presenter notes on |

- [ ] All tabs loaded **after** the server started (so the WebSocket connected on the first
      try).
- [ ] Window arrangement: editor left, dashboard right (or two windows on two displays).
- [ ] Disable sleep / screen lock for the duration.
- [ ] Close Slack, mail and anything that can raise a notification.

**T-minus 2 minutes — the simulator (optional)**

- [ ] `cd server && npm run simulate -- --devices 10 --interval 1000 --transport http
      --spikes 0.04` is running in a visible terminal, or you have decided not to use it.
- [ ] If you use it, note the exact moment you will press Ctrl+C.

**Fallbacks — decide now, not during the demo**

| Failure | Fallback |
|---|---|
| Server is asleep / cold (deployed) | `until curl -sf $API/api/health \| grep -q ok; do sleep 3; done` before the demo starts. Locally: restart `npm start`. |
| Network drops | Switch to the **backup screen recording** (below) and narrate. Do not troubleshoot live. |
| MongoDB connection lost | `curl localhost:5000/api/health` shows `degraded`; restart mongod, then `npm start`. The active graph is re-hydrated automatically — say so out loud, it is a feature. |
| WebSocket shows *Reconnecting…* | Press the reconnect path: reload the tab. The client re-subscribes to every channel on reconnect. |
| The rule does not fire | Check `activeGraphs` in the engine status; re-activate from the editor. If the device id differs, use the simulator, which writes to `turbine-001..010`. |
| The demo buttons 403/409 | `DEMO_ENABLED` / `MOCK_RECEIVER_ENABLED` are off, or `ALLOW_PRIVATE_WEBHOOKS` is false. Set both in `server/.env` and restart. |
| Build/dev server crashes | `npm run build && npm run preview` from `client/` serves the production bundle on the same port pattern. |
| Everything is on fire | Show the backup recording, then walk the slides. The slides are self-contained. |

**Backup recording plan**

- [ ] Record a **3-minute** clean run *before* the presentation: editor → activate → Send
      Test Data → dashboard alert → Alerts page delivery row → Stop Demo.
- [ ] Record it at 1920×1080 with the browser at 100% zoom and no personal notifications.
- [ ] Save it next to the slides as `demo-backup.mp4` and open it in a player, paused at
      0:00, on a second desktop/space.
- [ ] Re-record it if you change anything in the UI.
- [ ] Have a **static screenshot set** as a third fallback (editor, dashboard, alerts,
      delivery row) in case even the player fails.

**After the demo**

- [ ] Stop the simulator (Ctrl+C) and the demo (Stop Demo button) so nothing keeps writing.
- [ ] `git status` — make sure nothing stray was committed during the demo.
- [ ] Note any question you could not answer and add it to
      [`VIVA_QA.md`](VIVA_QA.md).
