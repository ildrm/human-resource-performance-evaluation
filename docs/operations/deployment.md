# Local deployment

1. Copy `.env.example` to `.env` and replace every sample secret.
2. Start Docker Desktop and run `docker compose up --build -d`.
3. Bootstrap the first tenant with `docker compose run --rm -e BOOTSTRAP_TENANT=example -e BOOTSTRAP_NAME="Example Organization" -e BOOTSTRAP_EMAIL=admin@example.test -e BOOTSTRAP_PASSWORD="a-unique-long-password" migrate pnpm db:seed`.
4. Open `http://localhost:3000`. API OpenAPI output is at `/docs` inside the API network.

The compose stack and migration were exercised with PostgreSQL 18.6 locally. The API readiness endpoint responded successfully and a synthetic HTTP workflow passed. A local [backup restore check](backup-restore.md) also passed. This is still a development deployment. The API should be exposed through a TLS reverse proxy in any shared deployment. Production migrations require a separate owner connection. Production backup/restore, scaling, telemetry, and incident procedures remain to be built and validated.

With the local stack running, `pnpm smoke` exercises the API through the web proxy, and `pnpm test:e2e` exercises the UI in Chrome. Both require `SMOKE_PASSWORD` for the synthetic `smoke-a` tenant; the browser test also requires Chrome installed. Bootstrap the synthetic tenant, run the HTTP smoke, then run the browser suite: its improvement-plan history test reads the smoke fixture. Do not run these data-creating tests against a production tenant.
