# Mandatory Review Workspace and Inline Publication Workflow

Load this reference for every PR review. It defines durable-in-session evidence, GitNexus impact analysis, one-thread-per-finding publication, verification, and cleanup boundaries.

## Workspace layout

Sanitize owner, repository, and PR identifiers to `[A-Za-z0-9._-]`; reject path traversal. Create one invocation directory:

```text
/tmp/pr-code-review/<owner>_<repo>/<pull-number>/<review-ordinal-id>_<UTC-YYYYMMDDTHHMMSSZ>/
├── repo/                         # exact ephemeral head checkout/snapshot
├── findings.md                  # all accepted findings in mandatory Markdown
├── review.json                  # structured review record; no hidden reasoning
├── impact.json                  # GitNexus detect-changes/impact evidence
├── publication.json             # review ID, thread IDs, event, verification receipts
└── logs/                        # bounded command outputs; no secrets
```

`review-ordinal-id` is a monotonic or collision-safe local identifier for that repository/PR. Create files with mode 0600 and directories with mode 0700. Never include credentials, environment dumps, tokens, unrelated private wiki content, or hidden chain-of-thought.

## No internal thought-process logging

Do **not** log hidden reasoning, scratchpad, chain-of-thought, or raw model deliberation. Fresh review sessions regain context from `review.json`, `findings.md`, `impact.json`, the exact head SHA, GitHub review threads, linked Notion/PRD/wiki sources, and verification receipts. Store concise evidence and decision rationale only: claim, source, code path, trigger, impact, severity, confidence, and contrary evidence checked.

## Exact ephemeral source

Materialize the exact PR head SHA under `repo/` using authenticated GitHub API archives or a verified clone. Verify the resulting source corresponds to the supplied head SHA before analysis. Never execute PR-controlled install, build, lifecycle, or repository scripts merely to materialize source.

## Mandatory GitNexus impact analysis

GitNexus is installed globally on the VM, so do not use floating `npx ...@latest` in production review. From `repo/`, run the pinned installed CLI in pure index mode:

```bash
gitnexus analyze --index-only --skip-agents-md --skip-skills
```

This avoids GitNexus writing `AGENTS.md`, `CLAUDE.md`, or agent skills into the reviewed tree. Then run:

```bash
gitnexus detect-changes --scope compare --base-ref <trusted-base-ref-or-SHA>
```

For every changed high-impact symbol, also run `gitnexus impact <symbol> --direction upstream --file <path> --depth 3 --include-tests`. Save bounded structured output to `impact.json`. GitNexus evidence informs blast radius and severity but is not proof; record analyzer warnings/truncation and manually verify claimed callers/processes. If GitNexus cannot analyze a language or returns incomplete/truncated coverage, mark impact confidence `unknown` and continue with manual tracing; never silently claim impact analysis passed.

## Finding staging

Write every accepted finding to `findings.md` using `references/github-review-markdown-template.md`. One finding equals one Markdown section and one future GitHub inline thread. Also write `review.json` with exact path, line/side, head SHA, severity, confidence, evidence, suggested diff, and GitNexus impact summary.

## Inline GitHub publication with gh-pr-review

The VM has the `agynio/gh-pr-review` GitHub CLI extension installed. Use one pending review so GitHub publishes each finding as an individual line-scoped thread atomically:

1. Start a review pinned to the exact head:
   ```bash
   gh pr-review review --start -R <owner/repo> <pr> --commit <head-sha>
   ```
2. Capture the returned `PRR_...` review ID in `publication.json`.
3. For each finding, write only that finding's Markdown body to a temporary 0600 file. Add it at the exact changed diff line:
   ```bash
   gh pr-review review --add-comment --review-id <PRR_id> --path <relative-path> --line <line> --side RIGHT --body "$(<finding-file)" -R <owner/repo> <pr>
   ```
   Use `--start-line`/`--start-side` for a range when supported. A comment must target a line represented in the PR diff. If no valid diff position exists, put the finding in the submitted review summary and mark `inline=false`; do not attach it to an unrelated line.
4. Submit exactly once:
   - Any verified HIGH finding: `--event REQUEST_CHANGES` with a concise summary body.
   - MEDIUM/LOW only or no findings: `--event COMMENT`.
   - Automated review never uses `APPROVE` and never merges.
5. Do not post each finding as a separate top-level issue comment. Individual findings are individual inline review threads inside one submitted review.

Use body files/controlled argument arrays. Never interpolate PR-controlled text into shell code.

## Post-publication verification

After submission, verify GitHub itself:

```bash
gh pr-review review view -R <owner/repo> --pr <pr> --reviewer johnai-alpon --not_outdated --include-comment-node-id
```

Confirm every staged finding exists exactly once with the expected path, line, body marker/finding ID, review state, and unresolved thread ID. Store review/thread IDs and verification results in `publication.json`. If any finding is missing or misplaced, do not create duplicate blind retries; inspect the current review state and post only the missing corrected thread through a new controlled review when safe.

## Follow-up sessions

A future webhook for an explicit `@johnai-alpon` follow-up may use `gh pr-review review view`, thread IDs, `comments reply`, and `threads resolve/unresolve`. That event integration is not yet implemented. Until it is, do not claim autonomous follow-up support. When implemented, rehydrate only the matching PR/head workspace plus the live thread, then reply with evidence; never expose or depend on hidden reasoning.

## Retention

`/tmp` is ephemeral and may disappear on reboot. Keep review workspaces long enough for bounded follow-up context, then delete by an operator-managed TTL job based on last activity (recommended seven days initially). Cleanup must only target validated descendants of `/tmp/pr-code-review/`, never follow symlinks, and preserve `publication.json` until TTL expiry. This skill does not install the cleanup job automatically.
