# Maintenate deployment preparation

Current status, 1 November 2026: the frontend is live at https://maintenate.vercel.app and the restricted Nest API is live at https://maintenate-api.onrender.com on Render Free. Production CORS and Supabase Site URL/callback have been configured, and a real Google sign-in reached the hosted registry. RCA and email runtime settings were authorized and added after provider checks. Keyword retrieval has now passed isolated acceptance without an embedding service; migration 035 is applied and Render activation is pending. The original local Ollama topology below remains an optional hybrid reference, not a claim that Ollama runs on Render Free. See LIVE-TESTING-2026-11-01.md and VERIFICATION.md for acceptance limits.

## Layout

- Vercel: Next.js frontend, root directory `apps/web`.
- One continuously running Linux host: Nest API and its embedded calendar, email and document-indexing workers. Python 3, Poppler, report fonts and image-processing dependencies are included in the API image.
- Ollama CPU embeddings on the same host, with a persistent model volume and loopback-only endpoint. Existing approved Nomic model/digest and stored vector profiles remain unchanged. Cloud CommandCode supplies answers/RCA.
- Existing Supabase: Auth and PostgreSQL, including vectors, private document/photo bytes and audit records.

Sleeping hosts pause background processing. Vercel functions alone do not run this application's interval workers or local embeddings. Start with one API instance; measure memory, embedding latency and job backlog before deciding server size or enabling multiple replicas. This is not a capacity or uptime guarantee.

## Backend package and private configuration

Build from the repository root:

```sh
docker build -f infra/deploy/api.Dockerfile -t maintenate-api:RELEASE .
```

Docker's allowlist excludes `.env`, company workbooks, `Maintenance_Handoff`, `.local`, Git and frontend assets. The runtime runs as a non-root user and omits compiled tests and migration tooling. `scripts/start-production.mjs` validates settings, passes an explicit runtime whitelist and forwards shutdown signals. Production config does not reload a local `.env`.

Copy `infra/deploy/backend.env.example` to a private file outside the repository or under ignored `.local/deploy/`. Replace every placeholder in a secret manager/editor. Preserve the **existing** `TEAM_INVITATION_SECRET`; changing it invalidates outstanding invitation tokens. Never copy the developer `.env` wholesale to a host.

`DATABASE_URL` must use the restricted application login, verified TLS and the project CA certificate. Mount that public certificate at `/run/secrets/supabase-ca.crt`; do not disable certificate verification. The launcher rejects obvious owner usernames, but this is not a privilege audit: run the existing database audit separately through a trusted administrator environment. Keep `DIRECT_URL`, migration credentials, test URLs, Supabase secret/service-role keys and deployment tokens out of the API service.

The checked-in Compose topology is for a Linux host with Docker Compose v2 and an HTTPS reverse proxy on the host:

```sh
export MAINTENATE_BACKEND_ENV=/absolute/private/backend.env
export MAINTENATE_DB_CA=/absolute/private/supabase-ca.crt
docker compose -f infra/deploy/compose.yaml config --quiet
docker compose -f infra/deploy/compose.yaml up -d --build
```

Use `config --quiet`; expanded Compose output can contain secrets. Keep API `HOST=0.0.0.0` and `PORT=4000` for this topology. API and Ollama share a network namespace so the existing loopback embedding client continues working. Only API port 4000 is published, on **host loopback**. Configure the host's HTTPS proxy to forward a chosen API hostname to `127.0.0.1:4000`, preserving `/api` paths. Never expose 11434. A proxy container needs a deliberately configured network; its own localhost is not the host.

Ollama is pinned by image digest. On first startup it downloads `nomic-embed-text:v1.5` into a persistent volume. The application validates the approved model digest before embedding; an unexpected model fails closed and requires investigation, not a silent profile change. Model download needs outbound connectivity and may exceed initial health-check time. Monitor health/logs and allow it to complete. Recreate API together with embeddings when changing the shared namespace. Do not use `down -v` during routine releases; it deletes the model cache.

Health check: `GET /api/health/ready`. HTTP 200 is a core readiness signal, **not** proof that email, every worker, AI generation or role journeys work. Monitor job failures and test those separately.

## Frontend on Vercel

Import the Git repository, set Root Directory to `apps/web`, enable inclusion of source files outside the root directory, and use Node 24. `apps/web/vercel.json` installs from the monorepo root and runs the validated production build. Leave the detected Next.js output directory unchanged. Do not set `MAINTENANCE_BROWSER_TEST` on Vercel.

Set only the three frontend settings from `infra/deploy/frontend.env.example`:

- `NEXT_PUBLIC_API_URL=https://YOUR_API_HOST/api`
- `NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: public publishable/legacy anon key

These values are included at build time. Changing them requires a frontend rebuild. Production preflight rejects localhost/non-HTTPS URLs, URL credentials, secret Supabase keys and obvious private `NEXT_PUBLIC_` settings. Backend provider/database keys belong only in backend secrets. Use a stable frontend origin for staff links; preview deployments are not automatically authorized workspaces.

## Production Auth and email cutover

After stable frontend and API URLs exist:

1. Set backend `WEB_ORIGIN` to the exact frontend HTTPS origin, without trailing slash/path. It drives CORS and staff/email links. Restart the backend.
2. In Supabase Auth URL configuration set Site URL to that frontend origin and add its exact `/auth/callback` URL. Preserve localhost callbacks while local testing is needed. Avoid broad wildcard redirects.
3. In the Google Web OAuth client add the frontend HTTPS origin. Google's redirect URI remains the existing hosted Supabase `/auth/v1/callback`, not the frontend callback. Check Google consent audience/test-user restrictions before inviting staff.
4. Keep the already verified Resend domain and SMTP settings. Sender is `notifications@maintenate.sarthakmarkad.xyz`, display name Maintenate. Keep Supabase confirmation/recovery template links intact. Retain the existing invitation signing secret.
5. Keep work-order email delivery disabled during deployment rehearsal. Enabling it against the live database can send pending eligible handoffs to real opted-in users. Review delivery settings and queued work before enabling it.
6. Existing localhost invitation links do not become public links automatically. Revoke/reissue affected invitations deliberately after cutover. Complete PKCE flows in the initiating browser.

See [STAFF-MANAGEMENT.md](STAFF-MANAGEMENT.md), [GOOGLE-SIGN-IN-SETUP.md](GOOGLE-SIGN-IN-SETUP.md) and [EXTERNAL-NOTIFICATIONS.md](EXTERNAL-NOTIFICATIONS.md). Local owner-confirmed email tests are not hosted acceptance.

## Release order, acceptance and rollback

1. Record release SHA, current migration status, database audit and backup/restore procedure. Test schema changes on the isolated `_test` database first. This deployment preparation adds **no migrations**.
2. Apply any reviewed future migrations/grants in a separate administrator release environment using existing `db:migrate` / `db:grants` commands. Never run migration, seed or fixture commands on API startup. Do not supply administrator credentials to runtime.
3. Build and verify the immutable API image on Linux. `.github/workflows/deployment-package.yml` checks image construction, native tools, assets and Compose syntax without service credentials. It does not publish an image or deploy.
4. Configure private backend settings, TLS proxy and embeddings. Build the frontend with the real public API origin. Perform the Auth cutover above.
5. Check anonymous denial, distinct staff logins, role/machine restrictions, invitation acceptance, recovery/password save/fresh login, issue reporting/assignment/repair/head review/closure, calendar release, inbox/email opt-in/delivery, private photo/document access, approved-document retrieval/citations/withdrawal and RCA human review. Operational writes require owner-approved real records; synthetic regression journeys stay in `_test`.
6. Rehearse host/process restart, persistent database access, job catch-up, provider failure, certificate failure and rollback. Ensure only one intended deployment sends email/processes jobs during cutover.

For an application rollback, stop the replacement API, restore the prior compatible image and frontend deployment, and retain the database, signing secret and embedding volume. Schema rollback is separate: never automatically reverse applied migrations or erase operational history. If an earlier image cannot read the new schema, use a reviewed forward fix or explicitly approved backup restore. Database restoration may lose newer writes and needs a separate decision.

## Verification limits

Docker is not installed on the current workstation. The deployment-package workflow subsequently passed on Linux, and Render built and ran the API image successfully. Local Compose/Ollama execution on a production host and capacity/uptime remain unverified. Render Free sleeps during inactivity, so embedded workers pause. Core readiness is not full feature acceptance. See [VERIFICATION.md](VERIFICATION.md) for executed checks.

Primary references: [Vercel monorepos](https://vercel.com/docs/monorepos/monorepo-faq), [Vercel configuration](https://vercel.com/docs/project-configuration), [Ollama Docker](https://docs.ollama.com/docker), [Compose networking](https://docs.docker.com/compose/how-tos/networking/), [Render free-service limits](https://render.com/docs/free).

## Initial Render Free rollout

Owner selected Render Free first, with paid credits reserved for a later explicit upgrade. Root render.yaml declares only a free Docker web service: no Render database, private worker or disk. Import the repository as a Blueprint after this file is pushed, or create a Free Docker Web Service using infra/deploy/api.Dockerfile and repository-root build context. Supply the prompted values privately; retain the existing invitation secret and restricted Supabase runtime login. Set WEB_ORIGIN to the stable public frontend origin, not localhost. If the database URL references a CA file, upload that project certificate as a Render secret file and update sslrootcert to its actual /etc/secrets filename. Do not copy migration credentials.

The initial blueprint deliberately defaults document AI, RCA AI and external work-order email off. On 1 November the owner separately authorized private RCA/email provider configuration and activation on the existing service; the initial blueprint defaults are not a statement of its current runtime overrides. Document AI remains off pending the keyword release/activation below. It does not host Ollama. Calendar and other embedded jobs pause during sleep. Supabase Auth SMTP remains separately configured. Existing local configuration is unchanged. After deployment use the assigned Render HTTPS hostname plus /api as the Vercel API URL, complete the Auth cutover above, and run hosted acceptance before enabling additional services. No live deployment is established by the YAML alone.


## Keyword assistant activation — prepared 1 November 2026

This release requires no new provider key, embedding endpoint or paid hosting. Apply reviewed migration `202611010035_keyword_document_retrieval` using the existing owner migration workflow after a private integrity checkpoint. Run the post-migration integrity audit; runtime stays restricted. Deploy the tested API release and set these two non-secret values in Render → maintenate-api → Environment:

```dotenv
DOCUMENT_RETRIEVAL_MODE=keyword
DOCUMENT_AI_ENABLED=true
```

Keep the existing private CommandCode configuration. No OpenAI key is needed. Save/redeploy, check core readiness, then allow the API worker to discover/reindex current approvals (one claim per 30-second tick). Old vectors and saved chats remain unchanged. Test a greeting and a named approved-reference question through the public app. Inspect exact citations and withdrawal/access behavior. Reverting to `DOCUMENT_AI_ENABLED=false` pauses new questions/indexing while preserving evidence; restoring hybrid requires a working embedding service. Browser control remains stopped; these settings can be changed manually by the owner.

Render Free can sleep, delaying first requests and worker progress. Keyword matching is less tolerant of paraphrases than semantic retrieval; it can abstain despite relevant text. Existing answer-provider allowance and limits still apply. Local/isolated tests do not establish authenticated hosted acceptance. Implementation tests made no hosted changes. The owner subsequently authorized publication: migration 035 is now applied; the read-only audit passed all 26 checks and all 40 application-table content digests matched the pre-migration checkpoint. Render activation and authenticated hosted keyword answers remain pending.
