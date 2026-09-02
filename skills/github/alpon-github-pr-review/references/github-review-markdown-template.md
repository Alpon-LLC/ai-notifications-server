# Mandatory Inline Finding Markdown Template

Load this reference for every PR review. `findings.md` contains all accepted findings, but GitHub receives each finding as an individual line-scoped review thread through `gh pr-review`. Do not publish this entire file as one giant top-level comment.

## Local findings file

Start `/tmp/pr-code-review/<owner>_<repo>/<pr>/<review-id>_<UTC>/findings.md` with:

```markdown
# PR code review findings

- Repository: `owner/repo`
- PR: `#123`
- Head: `<exact head SHA>`
- Review event: `REQUEST_CHANGES | COMMENT`
- Findings: `<count>`
```

Then append one section per finding using the exact format below. Give every finding a stable invocation-local ID such as `F001`.

````markdown
## F001 — [HIGH] Short actionable finding title

**Location:** `relative/path/to/file.ts:42-49`
**Commit:** `<exact head SHA>`
**Confidence:** `0.94`
**Impact scope:** `<GitNexus-backed callers/processes, or unknown with reason>`

```typescript
const quoted = "exact changed or surrounding code";
```

**Why this is a problem:** <Concrete business, logic, security, data, API, or operational failure.>

**Trigger:** <Specific input or execution sequence.>

**Impact:** <Observable consequence for users, systems, data, security, or delivery.>

**Recommended fix:** <Smallest safe correction consistent with repository conventions.>

**Suggested change:**

```diff
--- a/relative/path/to/file.ts
+++ b/relative/path/to/file.ts
@@ -42,3 +42,4 @@
-const slug = title.toLowerCase();
+const slug = post.slug;
+assertUniqueSlug(slug);
 return slug;
```

**Regression tests:**
- <Specific test that fails before the fix and passes after it.>
````

## GitHub inline-thread body

For each finding, post only that finding's section as the inline comment body. The line-scoped UI already displays the surrounding source, but retain the exact evidence block so the finding remains understandable after the diff becomes outdated.

Do not include repository-wide summary, traceability, split-plan, or verification boilerplate in every inline thread. Put concise cross-cutting information in the review submission body:

```markdown
## John AI code review

**Commit:** `<head SHA>`  
**Event:** `REQUEST_CHANGES | COMMENT`  
**Findings:** `<H high, M medium, L low>`

- Notion task: linked | missing | ambiguous
- `Github PR` property: match | missing | mismatch | unknown
- Atomic scope: pass | needs split | large but cohesive
- GitNexus impact analysis: complete | partial | unknown

<When applicable: short split recommendation and pointer to the detailed inline/scope finding.>

_Automated review. No merge or approval action was taken._
```

## Rendering rules

- Every finding must include a stable finding ID, relative path, inclusive head-SHA line range, exact commit SHA, confidence, and exact reviewed code excerpt.
- Use the correct fenced-code language identifier.
- Preserve quoted code exactly; do not silently fix spelling or whitespace in evidence.
- If an exact change is justified, use a unified `diff` fence with `--- a/`, `+++ b/`, and a valid hunk header. Removed lines start with `-`; proposed lines start with `+`; unchanged context starts with a space.
- Omit the diff when context is insufficient or multiple designs are equally valid. Ask a focused question instead.
- Do not describe an unexecuted suggested patch as tested.
- One defect equals one finding and one GitHub inline thread. If one defect spans several locations, anchor at the most causally useful changed line and include separately labeled evidence blocks for other paths/ranges.
- If GitHub cannot anchor a finding to a changed diff line, include it once in the submitted review summary and record `inline=false`; never attach it to an unrelated line.
- Keep public text neutral, concise, secret-free, and implementer-facing.
- Never publish raw JSON, logs, status messages, tool output, or hidden reasoning.
- After submission, verify each finding ID/path/line/thread from GitHub using `gh pr-review review view`.
