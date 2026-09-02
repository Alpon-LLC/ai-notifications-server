# Hermes Notification Server

Lightweight Express server for contact-form notifications and authenticated
Hermes deployment webhooks.

The process fails closed during startup unless it can load the deployment
webhook signing secret from Google Secret Manager.

## Run locally

```bash
npm ci
cp .env.example .env
npm run dev
```

Both development and production commands use Node's native `--env-file=.env`
support; the project does not depend on `dotenv`. Node 20.6 or newer is required.

Build and run the compiled TypeScript application with:

```bash
npm run build
npm start
```

Use `npm run typecheck` for strict source and test type checking and `npm test`
for the test suite.

The server listens on `0.0.0.0:3000` by default for load-balancer access. Set
`HOST=127.0.0.1` for local-only development and set `PORT` to override the port.

## Endpoints

- `GET /health` — health check
- `POST /api/notifications/contact` — receive a contact-form JSON payload
- `POST /api/deployments/deploy` — submit a signed asynchronous deployment
- `GET /api/deployments/deploy/:jobId` — poll with the per-job bearer token

The deployment POST requires:

- `X-Webhook-Timestamp`: current Unix timestamp in seconds
- `X-Webhook-Signature`: `sha256=<HMAC-SHA256(secret, timestamp + "." + rawBody)>`

Requests more than five minutes old and replayed signatures are rejected. Only
one deployment can run at a time. The endpoint returns `202`, a job ID, a random
status token, and a status URL. The server then stops every Hermes gateway and
runs `/home/Work/.hermes/scripts/deploy-hermes-from-github.sh`.

Set `dry_run: true` in the request body to exercise authentication, job
creation, and status polling without stopping any Hermes gateway or running the
deployment script. A dry run transitions from `queued` to `running`, waits
briefly, and finishes as `dry_run_completed`.

## Secret Manager boot configuration

The VM service account needs `roles/secretmanager.secretAccessor` on only the
deployment secret. The Compute Engine VM must also have the `cloud-platform`
OAuth scope. Configure:

```text
GOOGLE_CLOUD_PROJECT=stately-atrium-391613
HERMES_DEPLOY_WEBHOOK_SECRET_NAME=hermes-deploy-webhook-secret
HERMES_DEPLOY_WEBHOOK_SECRET_VERSION=latest
```

`HERMES_DEPLOY_WEBHOOK_SECRET_NAME` can alternatively be a full Secret Manager
resource name. The attached VM service account is used through Application
Default Credentials; no service-account key file is required or supported.

## Start at VM boot

Install `deploy/hermes-notification-server.service` as a user service so the
deployment scripts can reach the existing per-profile user services:

```bash
npm run build
mkdir -p /home/Work/.config/systemd/user
cp deploy/hermes-notification-server.service \
  /home/Work/.config/systemd/user/hermes-notification-server.service
systemctl --user daemon-reload
systemctl --user enable hermes-notification-server.service
```

Do not start the service until Secret Manager IAM, the secret, the load-balancer
backend, and firewall controls are ready. For boot without an interactive login,
an administrator must run `loginctl enable-linger Work` once.

The `Work` user also needs narrowly scoped passwordless permission for the
existing Hermes gateway commands invoked by the stop/start scripts. Do not grant
blanket passwordless `sudo` to the notification server.

## Logs and debugging

The server writes one JSON object per log line to stdout/stderr, which systemd
captures in the journal. Every event includes a stable `event` name and useful
context such as `request_id`, `job_id`, stage, status, exit code, and duration.
Request bodies, webhook signatures, bearer tokens, and secret values are never
logged.

Follow live logs:

```bash
journalctl --user -u hermes-notification-server.service -f -o cat
```

Inspect errors from the current boot:

```bash
journalctl --user -u hermes-notification-server.service -b -o cat |
  jq -R 'fromjson? | select(.level == "error")'
```

Trace one request or job by copying its ID from GitHub Actions or an API response:

```bash
journalctl --user -u hermes-notification-server.service -b -o cat |
  rg 'REQUEST_OR_JOB_ID'
```
