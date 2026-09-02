# Mandatory Finding Severity Framework

Load this reference for every PR review. Severity reflects demonstrated production impact, not reviewer confidence or stylistic preference. Confidence is recorded separately.

## HIGH — production showstopper

Use `HIGH` when the finding is verified or strongly evidenced and merging creates an unacceptable production risk. A HIGH finding causes the final review event to be `REQUEST_CHANGES`.

Examples:

- Severe business-logic or code-flow defect likely to cause user distress, financial/data harm, broad service failure, or an unusable core journey.
- Implementation materially does not perform the PR title, description, Notion task, PRD, or acceptance criteria; wrong PR/branch content or complete scope mismatch.
- Malware, credential theft, obfuscated auto-execution, unauthorized public access, authorization bypass, secret exfiltration, remote payload download, or equivalent exploitable security issue.
- Faulty database migration/backfill likely to corrupt, delete, mis-transform, expose, or irreversibly lock production data; unsafe mixed-version rollout or rollback.
- Infinite loop, unbounded recursion/retry, memory/resource leak, deadlock, queue storm, or runaway work likely to hang or exhaust production.
- Authentication/authorization failure on protected resources; tenant isolation breach; payment, settlement, payroll, identity, or other high-stakes invariant violation.
- Breaking API/schema/event/config change with active consumers and no compatible rollout.
- Race, duplicate execution, or non-idempotent side effect with likely material impact.
- Unhandled failure in a high-stakes/high-impact path where the concrete error path can cause data loss, security exposure, double execution, or broad outage.
- Missing mandatory validation or test evidence where the changed path is destructive, security-critical, or irreversible and cannot be safely approved without it.

## MEDIUM — real risk requiring attention

Use `MEDIUM` for a concrete defect or material risk that should be fixed or explicitly accepted but is not an immediate production showstopper.

Examples:

- Suboptimal algorithm, blocking I/O, N+1 behavior, overwhelming query count, missing pagination, or performance degradation with bounded impact.
- Plausible bug whose trigger is not immediate or fully confirmed, but code-path evidence is strong enough to require attention.
- Duplicated function/domain logic, competing definitions of the same helper, or non-canonical implementations likely to drift.
- Frontend missing debounce/deduplication/cancellation, causing duplicate server requests or stale-result races.
- Idempotency, retry, transaction, timeout, partial-failure, or consistency risk without demonstrated showstopper impact.
- Error-capable code without adequate handling in a normal-impact path; escalate to HIGH when the path is high-stakes and the concrete consequence is severe.
- Incorrect module ownership, dependency direction, or shared abstraction that creates material maintenance or correctness risk.
- Missing negative/integration/regression test for a meaningful changed behavior.
- PR/task/description mismatch that obscures review but is not a complete implementation mismatch.

## LOW — maintainability and obvious hygiene

Use `LOW` for actionable, bounded cleanup that does not materially threaten production correctness.

Examples:

- Typo in a variable, function, file, folder, route, config key, comment, docstring, or user-facing text.
- Obsolete or misleading comment/docstring left behind after code changed.
- Inconsistent naming/casing against explicit or repeated repository conventions.
- Unnecessary code addition/removal, dead branch, redundant import, or minor duplication with no demonstrated behavior risk.
- Small readability issue with concrete maintenance cost.
- PR title/description format issue when implementation scope remains understandable.

Do not publish pure personal taste. If a formatter/linter owns the issue, cite its check output or omit it.

## Confidence and escalation

- `HIGH` severity requires confidence >= 0.85 and concrete evidence. If impact is potentially severe but evidence is incomplete, use `MEDIUM` plus a focused verification question.
- `MEDIUM` requires confidence >= 0.70.
- `LOW` requires confidence >= 0.70 and must still be actionable.
- Never inflate severity to force attention.
- Any verified HIGH finding means `REQUEST_CHANGES`.
- MEDIUM/LOW-only findings mean `COMMENT`, unless an explicit repository policy independently requires changes.
- No actionable findings means `COMMENT`; automated reviewers do not approve or merge.
