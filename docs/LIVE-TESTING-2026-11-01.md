# Hosted acceptance and regression testing — 1 November 2026

Initial smoke/regression release: `361766ee55b03d6c3103fe5af5a39264b0ef915f`. Follow-up RCA correction: `c585396`. The later acceptance below supersedes initial configuration limits where stated.
Frontend: https://maintenate.vercel.app. Backend: https://maintenate-api.onrender.com.

## Live deployment checks

- Liveness/readiness return HTTP 200, with database connected and authentication configured.
- Initially reproduced a deployment blocker: Render returned `Access-Control-Allow-Origin: https://maintenate.sarthakmarkad.xyz`. A real browser on the Vercel site could not read its API responses.
- With owner authorization, changed only Render `WEB_ORIGIN` to `https://maintenate.vercel.app` and saved/rebuilt/deployed. Rollout: `dep-dbjf8d8u01pc73fa5drg`. Repeated browser fetches now read readiness HTTP 200 and protected `/api/me` HTTP 401 correctly. No authentication enforcement was weakened.
- All **19 read-only/unauthenticated HTTP probes passed** after rollout: two health checks; seven protected reads; five protected write routes rejected without authentication; malformed bearer token rejection; legitimate frontend preflight; untrusted-origin exclusion; unknown-route handling; and inaccessible root `.env`. Write probes had no identity or operational payload and returned 401.
- HTTPS security headers were present: backend Helmet headers, frontend `nosniff`, `DENY`, referrer policy and HSTS.
- Signed-out dashboard navigation redirects to login. Recovery without a session, callback without a code and invitation without a link show actionable safe states. Google provider settings loaded from the real Auth service with HTTP 200; completing Google/password sign-in was not part of these signed-out checks.
- Desktop and 412-pixel mobile checks found no horizontal overflow on landing/login. Brand images load. The illustrative video loads, loops, stays muted and has no controls. Landing fragment links target existing elements. Login fields have labels, required validation and appropriate autocomplete.
- A non-blocking unused CSS preload warning was observed. No uncaught page exception was observed in inspected public states; deliberately induced CORS errors belong to the initial failed check.
- Warm sequential API probes took approximately 86–402 ms during the final batch. Earlier cold readiness took approximately 33 seconds. These samples are smoke timings, not load/capacity measurements or a latency SLA. Cached frontend navigation timings are not presented as a cold-load benchmark.

## Automated checks

| Type | Result | Environment |
| --- | --- | --- |
| Strict TypeScript | Passed | Current checkout |
| Unit/policy/provider/configuration | 180 passed | Local deterministic tests |
| PostgreSQL integration | 225 passed | Guarded separate `_test` database |
| Desktop/mobile browser regression | 502 passed | Local UI with controlled Auth/API fixtures |
| Persisted end-to-end journeys | 3 passed | Real UI/API and isolated `_test` persistence; test-only external identity double |
| Hosted database integrity | 25 checks passed; 41 tables; 73 foreign keys; no failures | Restricted operational connection, read-only transaction |

The three persisted journeys verify six-role work-order/evidence handoff and reloads; machine metadata/photo plus approved SOP byte retention; and staff invitation, acceptance, deactivation and reactivation under a retained identity. All 910 automated tests passed.

The suites cover permission isolation, scope/access revocation, reports/imports, machine editing/photos, work-order and investigation transitions, audit/history, concurrency/idempotency, planned maintenance, notifications, documents, chat/RCA error handling, account recovery and popup/navigation behavior. Fixture-backed browser tests do not prove hosted provider delivery or authenticated production workflows.

## Remaining findings and acceptance limits

- `npm audit` reports **10 moderate affected dependency entries**, zero high and zero critical. The entries trace to the minimatch globparts amplification advisory and its dependency chains through ExcelJS/archive utilities and OpenAPI tooling; this is not ten independent vulnerabilities. Suggested automatic fixes include major tooling changes/downgrades. No forced dependency changes were made during testing. See https://github.com/advisories/GHSA-g3hv-75wg-m249.
- Subsequent authenticated read-only acceptance used the owner-approved Google account on the deployed origin. No production test accounts, incidents, plans, documents, drafts or chats were created.
- The original Render profile disabled AI/RCA and external email. Subsequent authorized RCA/email activation and real-provider acceptance are recorded below. Document RAG remains local by explicit owner choice. Supabase Auth SMTP is a separate service.
- Supabase Site URL and exact production callback were subsequently saved with owner confirmation; localhost callback was retained. A fresh Google round trip reached the hosted authenticated registry. New production invitation/recovery/password-save round trips have not been repeated; earlier owner acceptance was local.
- Render Free can sleep and pause embedded workers. No stress/soak test, penetration test, backup restore drill, real-device or assistive-technology certification was performed.

Raw logs and aggregate evidence remain ignored under `.local/live-testing-20261101/` and `.local/database-audit.json`. No credentials or operational row contents are included in this report. No source release, migration, operational data edit or paid-plan change was necessary for the CORS correction.

## Follow-up production cutover and provider acceptance

- **Auth:** Supabase Site URL is now `https://maintenate.vercel.app`; its exact `/auth/callback` and the existing localhost callback are both allowed. Verified saved UI state and completed a fresh real Google OAuth round trip to the public asset registry. The existing Google OAuth client callback to Supabase already works; no replacement client or additional Google permissions were needed.
- **Authenticated hosted reads:** registry metadata and normalized photos, WH-C overview, saved production charts/import history, synthetic process trends/statistical reviews, work-order list/detail and email settings loaded. Administrator, Maintenance head and Technician workspace selection rechecked trusted access. Administrator had no report/engineering action, while the assigned Technician saw Start repair on an existing assigned order. No action was submitted. Restored the Administrator workspace after inspection. Six distinct identities and all workflow transitions remain covered by the isolated system journeys, rather than claiming separate human production accounts were exercised.
- **RCA correction:** live generation exposed rejection of a negated confirmation phrase. Fixed this narrow validator false positive, retained scanning for unsupported positive claims elsewhere, and strengthened synthetic-evidence instructions. No schema or historical receipt changes. Post-fix checks: **181 unit tests, eight RCA PostgreSQL tests, 20 RCA desktop/mobile cases, strict TypeScript and formatting passed**. Three real DeepSeek V4.1 Flash acceptance cases passed in `_test` (immutable generation/retry/manual workflow, sparse synthetic evidence, embedded instructions), using three provider calls in the final run. Earlier failed live attempts are retained privately; the tests were not silently marked successful.
- **Chat/RAG provider acceptance:** one real-provider isolated run passed greetings/general conversation without embeddings, approved PDF answers with source pages 1 and 2, document follow-ups, insufficient evidence, retry reuse, private persisted conversation and exclusion/redaction after withdrawal. It used 13 CommandCode calls and real loopback Nomic embeddings. This verifies the configured key and local RAG pipeline; it is **not** a hosted RAG claim.
- **Render provider activation:** owner authorized copying only the existing CommandCode and Resend keys plus six non-secret provider/flag settings into Render private environment. No owner DB credentials, OpenAI key, frontend secret or test connection was transferred. Confirmed no duplicate active setting names. RCA and email enabled; document AI remains disabled. Initial corrective deployment `dep-dbjfj2h5efls73duu80g` succeeded; the environment save followed the source push. Production readiness remains HTTP 200. The temporary restricted transfer file was removed after import.
- **Email:** read-only preflight found three retained enabled preference versions, two SENT outbox rows, one SENT invitation email and no pending outbox. Existing preferences were not manufactured or changed. Hosted Maintenance-head email settings load without the unconfigured-provider warning and retain prior activity. With explicit recipient/sender authorization, the existing application provider adapter sent exactly one fixed delivery probe from `notifications@maintenate.sarthakmarkad.xyz` to the owner, with a Vercel link and no work-order data. Resend accepted it; **the owner confirmed inbox receipt and the public link**. This direct provider probe is separate from testing the Render worker's actual sending of a new handoff. Future eligible events can now be delivered to existing opted-in recipients while Render is awake. No new incident was fabricated to force a worker send.

### Deliberately deferred or still unverified

The owner explicitly chose **Keep RAG local until a later hosting upgrade**. No managed embedding provider, extra billing, model switch or paid Render service was introduced. The deployed chatbot/document retrieval is therefore not complete while local Ollama remains a loopback-only dependency. Its local real-provider acceptance passed. RCA is independent of embedding hosting.

New hosted import commits, staff invitation/recovery/password-save round trips, real operational work-order stage changes, actual Render-worker handoff inbox delivery, and an RCA draft saved against a company order were not performed. Their code/database/provider paths were tested in isolation, but those remain distinct acceptance steps for intended real activity. Render Free still pauses embedded jobs when asleep. Dependency advisories and capacity/backup limits above remain open.
