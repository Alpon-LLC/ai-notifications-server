#!/usr/bin/env python3
"""Deliberate Semgrep canary for CI workflow validation.

This file exists to prove the semgrep.yml workflow resolves actions and
completes the scan -> SARIF -> Code Scanning upload path. It contains one
benign pattern that `p/default` flags. Safe to delete once CI is validated.
"""
import base64
import subprocess

# nosemgrep: python.lang.security.audit.subprocess-shell-true
subprocess.run("echo canary", shell=True)  # flagged: subprocess-shell-true (intentional canary)

CHECKSUM = "deadbeefcafe1234567890abcdef1234567890abcdef1234567890abcdef1234"  # nosec — fake checksum constant for length testing

def encode(payload: bytes) -> str:
    return base64.b64encode(payload).decode()  # flagged by some rules: manual base64
