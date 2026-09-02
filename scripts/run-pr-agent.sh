#!/usr/bin/env bash
set -euo pipefail
: "${PR_URL:?Set PR_URL to the GitHub pull request URL}"

if [[ -z "${JOHN_OPENAI_API_KEY:-}" && -n "${JOHN_OPENAI_API_KEY_SECRET:-}" ]]; then
  : "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT when using JOHN_OPENAI_API_KEY_SECRET}"
  JOHN_OPENAI_API_KEY="$(gcloud secrets versions access latest \
    --secret="$JOHN_OPENAI_API_KEY_SECRET" \
    --project="$GOOGLE_CLOUD_PROJECT")"
fi

if [[ -n "${JOHN_OPENAI_API_KEY:-}" ]]; then
  export OPENAI_KEY="$JOHN_OPENAI_API_KEY"
  export OPENAI_API_BASE="${JOHN_OPENAI_BASE_URL:-https://john.alpon.xyz/v1}"
elif [[ -n "${NINEROUTER_OPENAI_API_KEY:-}" ]]; then
  export OPENAI_KEY="$NINEROUTER_OPENAI_API_KEY"
  export OPENAI_API_BASE="${NINEROUTER_OPENAI_BASE_URL:?Set NINEROUTER_OPENAI_BASE_URL}"
else
  echo 'Set JOHN_OPENAI_API_KEY, JOHN_OPENAI_API_KEY_SECRET, or NINEROUTER_OPENAI_API_KEY.' >&2
  exit 2
fi

: "${GITHUB_TOKEN:?Set a least-privilege GitHub token}"
readonly image="codiumai/pr-agent@sha256:a5741a479f21d20a9bbeca7847a720f92ac6f427e8dc0920fefa039ecafd5e6f"
exec docker run --rm -e OPENAI_KEY -e OPENAI_API_BASE -e GITHUB_TOKEN \
  -v "$PWD/.pr_agent.toml:/app/pr_agent/settings/.pr_agent.toml:ro" \
  "$image" --pr_url "$PR_URL" review
