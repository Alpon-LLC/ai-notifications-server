#!/usr/bin/env python3
"""Render semgrep.sarif into a Markdown findings summary.

Writes to stdout. Used by .github/workflows/semgrep.yml to surface findings on
the PR (Code Scanning only surfaces PR-ref alerts inside the PR diff, so
out-of-diff findings are otherwise invisible on the PR itself).
"""
import json
import sys


def main() -> int:
    try:
        with open("semgrep.sarif", encoding="utf-8") as fh:
            sarif = json.load(fh)
    except (OSError, ValueError):
        return 0

    lines: list[str] = []
    count = 0
    for run in sarif.get("runs", []):
        driver = run.get("tool", {}).get("driver", {})
        rules = {r.get("id", ""): r for r in driver.get("rules", [])}
        for res in run.get("results", []):
            count += 1
            rule = rules.get(res.get("ruleId", ""), {})
            level = rule.get("defaultConfiguration", {}).get("level", "note")
            loc = (
                res.get("locations", [{}])[0]
                .get("physicalLocation", {})
            )
            uri = loc.get("artifactLocation", {}).get("uri", "?")
            line_no = loc.get("region", {}).get("startLine", "?")
            msg = res.get("message", {}).get("text", "").strip()
            lines.append(f"- **`{res.get('ruleId', '?')}`** ({level}) — `{uri}:{line_no}`")
            if msg:
                lines.append(f"  {msg[:220]}")

    header = f"## Semgrep findings — total: {count}"
    if count == 0:
        lines = ["No findings. 🎉"]

    print(header)
    for line in lines:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
