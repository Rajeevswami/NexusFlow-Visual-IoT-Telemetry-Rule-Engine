# Day 6 stabilization log

## Verification performed

| Area | Result | Evidence / limitation |
|---|---|---|
| `npm ci` in `server/` | PASS | Lockfile install completed; npm reported 2 moderate audit findings. |
| `npm ci` in `client/` | PASS | Lockfile install completed; npm reported 3 audit findings (1 moderate, 2 critical); do not blindly force-upgrade without compatibility review. |
| Server `npm test` | PASS with skips | Unit and HTTP suites pass; 5 Mongo-backed cases skip because no `TEST_MONGODB_URI` was configured. |
| Client `npm test` and `npm run build` | PASS | One Node logic test, four smoke tests; production Vite build succeeded. |
| Docker stack | NOT RUN | Docker daemon/Compose availability and Mongo runtime were not exercised in this verification. |
| Browser E2E / full persistence flow | NOT RUN | No live browser-connected MongoDB stack was available. Use `scripts/e2eCheck.js` against a running server; this script requires a healthy MongoDB and mock delivery configuration. |

## Findings and disposition

- Mongo-dependent verification was inconclusive -> test commands intentionally skip integration cases without a disposable test Mongo URI -> run `TEST_MONGODB_URI=... npm test` or `npm run test:db`; never treat the skipped cases as passed.
- npm audit identifies dependency advisories -> locked dependency trees install successfully, but security advisories remain in the package trees -> review `npm audit` in each folder and apply compatible targeted updates before public deployment.
- Docker and actual browser flow have not been executed here -> runtime prerequisites were not available/verified -> treat them as a pre-submission gate, not as confirmed working.
- Added `scripts/e2eCheck.js` for API-driven activation, anomaly ingestion, alert/delivery evidence, and post-deactivation silence. It does not emulate browser reload/settings persistence or server restart/rehydration; those require a persistent Mongo-backed manual/automated environment.
- Environment variable examples cover runtime `process.env` settings used by application and scripts; optional script knobs are documented inline or via command-line arguments. Client API/WebSocket overrides are intentionally production variables, with same-origin `/api` and `/ws` defaults in development.

## Repository hygiene

`.gitignore` ignores `.env*` except `.env.example`, build output, dependencies and logs. Check `git status --ignored` before publishing. If a secret was committed in past history, rotate it immediately; remove it from all history with a reviewed `git filter-repo` rewrite (or GitHub's sensitive-data removal procedure), then force-push only after coordinating collaborators. Removing a file in a new commit does not erase historical copies.
