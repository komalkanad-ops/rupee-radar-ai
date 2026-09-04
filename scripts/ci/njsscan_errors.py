#!/usr/bin/env python3
"""Print a markdown fragment for njsscan ERROR-severity findings, or nothing if there are none.
Lower-severity findings are left for the human-readable step log. Usage: njsscan_errors.py <json>"""
import json
import sys

try:
    data = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)

hits = []
for section in ("nodejs", "templates"):
    for rule, info in data.get(section, {}).items():
        if info.get("metadata", {}).get("severity", "").upper() != "ERROR":
            continue
        for f in info.get("files", []):
            line = (f.get("match_lines") or ["?"])[0]
            hits.append(f"{f.get('file_path', '?')}:{line}  {rule}")

if not hits:
    sys.exit(0)

print(f"\n### njsscan — {len(hits)} ERROR-severity finding(s) in backend/src\n")
print("```")
print("\n".join(hits[:40]))
print("```\n")
print("Lower-severity njsscan findings are in the workflow step log, not here.\n")
