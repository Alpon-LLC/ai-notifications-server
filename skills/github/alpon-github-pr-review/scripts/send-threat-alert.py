#!/usr/bin/env python3
"""Send an immediate, bounded PR threat alert to the skill-local Slack channel."""
from __future__ import annotations
import argparse, json, os
from pathlib import Path
import urllib.error, urllib.request

def load_local_env():
    values = {}; path = Path(__file__).resolve().parent.parent / ".env"
    if not path.is_file(): raise RuntimeError(f"Missing skill-local environment file: {path}")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line=raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key,value=line.split("=",1); values[key.strip()]=value.strip().strip('"').strip("'")
    return values

def build_message(project, repository, pr, title, threat, url):
    return f"[{project.strip().upper()[:32]}] :warning: PR security threat spotted!\nRepository: {repository}\nPR: #{pr} — {' '.join(title.split())[:180]}\nThreat: {' '.join(threat.split())[:700]}\n{url}"

def main():
    p=argparse.ArgumentParser()
    for name in ("project","repository","title","threat","url"): p.add_argument(f"--{name}",required=True)
    p.add_argument("--pr",required=True,type=int); p.add_argument("--dry-run",action="store_true"); a=p.parse_args()
    channel=load_local_env().get("SLACK_CHANNEL_ID","")
    if not channel: raise RuntimeError("SLACK_CHANNEL_ID is missing from the skill-local .env")
    message=build_message(a.project,a.repository,a.pr,a.title,a.threat,a.url)
    if a.dry_run: print(json.dumps({"ok":True,"channel":channel,"text":message})); return 0
    token=os.environ.get("SLACK_BOT_TOKEN","")
    if not token: raise RuntimeError("SLACK_BOT_TOKEN is unavailable in the agent process environment")
    req=urllib.request.Request("https://slack.com/api/chat.postMessage",data=json.dumps({"channel":channel,"text":message,"unfurl_links":False}).encode(),headers={"Authorization":f"Bearer {token}","Content-Type":"application/json; charset=utf-8"},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=20) as response: result=json.load(response)
    except urllib.error.HTTPError as error: raise RuntimeError(f"Slack API HTTP {error.code}") from error
    if not result.get("ok"): raise RuntimeError(f"Slack API rejected alert: {result.get('error','unknown_error')}")
    print(json.dumps({"ok":True,"channel":channel,"ts":result.get("ts")})); return 0
if __name__=="__main__": raise SystemExit(main())
