# PR review integrations

## Native John orchestration

Configure the GitHub App webhook URL as `/api/github/webhooks/pull-request`, content type JSON, and subscribe only to pull requests. Required runtime variables:

- `GITHUB_PR_WEBHOOK_SECRET`: dedicated GitHub webhook secret.
- `GITHUB_PR_ALLOWED_REPOSITORIES`: comma-separated exact `owner/repo` allowlist.
- `GITHUB_TOKEN`: least-privilege installation token used to read PR metadata/files.
- `JOHN_PR_REVIEW_HMAC_SECRET`: separate secret shared with John's webhook verifier.
- `JOHN_PR_REVIEW_WEBHOOK_URL`: optional; defaults to `http://127.0.0.1:8642/webhooks/github-pr-review`.
- `GITHUB_DELIVERY_STORE_DIR`: optional durable delivery claim directory.
- `PR_REVIEW_SLACK_CHANNEL_ID`: optional; when set, a "PR Review Started" Slack notification is posted to this channel AFTER the review payload is successfully forwarded to the review agent (action `opened` or `reopened`). Absent = skipped (debug log).
- The legacy "New Pull Request" notification on `action=opened` is DISABLED (2026-09-11): per-repo GitHub Actions workflows handle PR-opened notifications; the code path remains in `src/routes/github-pr-review.routes.ts` (commented) if it ever needs re-enabling.

The endpoint validates the HMAC over the exact raw bytes, event, action, schema, SHA and allowlist. It atomically claims the delivery, returns 202, fetches current PR/files while requiring the exact webhook head SHA, bounds content, and sends `X-Webhook-Signature: <hex HMAC(raw JSON)>`, matching Hermes' generic webhook verifier. Poll `/api/github/reviews/<delivery-id>` for deterministic process-local status. Durable deduplication survives restart; detailed status does not.

## Semgrep CE

`.github/workflows/semgrep.yml` installs pinned Semgrep CE, runs the public `p/default` rules plus `.semgrep.yml`, and uploads SARIF. No Semgrep account or token is required. `security-events: write` is used only for SARIF; fork PR restrictions may prevent upload while the scan still runs.

## Optional Qodo PR-Agent

This path is independent of native John review. Install Docker, make `scripts/run-pr-agent.sh` executable, then provide:

```sh
export PR_URL=https://github.com/OWNER/REPO/pull/NUMBER
export GITHUB_TOKEN=... # contents read, pull requests write
export JOHN_OPENAI_BASE_URL=https://john.alpon.xyz/v1
export JOHN_OPENAI_API_KEY_SECRET=hermes-john-api-server-key
export GOOGLE_CLOUD_PROJECT=stately-atrium-391613
bash scripts/run-pr-agent.sh
```

Fallback variables are `NINEROUTER_OPENAI_BASE_URL` and `NINEROUTER_OPENAI_API_KEY`. Review `.pr_agent.toml` and pin the container digest before production automation. No key belongs in Git, workflow YAML, shell history, or logs.

## Skill installation

Install later into John's profile without this repository writing across profiles:

```sh
scripts/install-review-skill.sh /path/to/john-profile
```

The script copies only to `<profile>/skills/github/alpon-github-pr-review/SKILL.md` and refuses an existing destination unless `FORCE=1`.
