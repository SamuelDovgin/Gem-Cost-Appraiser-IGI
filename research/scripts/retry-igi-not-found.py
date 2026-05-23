#!/usr/bin/env python3
"""Deprecated: use igi-verify-slow.py (rate-limited). Wrapper for compatibility."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

if __name__ == "__main__":
    script = Path(__file__).resolve().parent / "igi-verify-slow.py"
    print("Note: use igi-verify-slow.py for rate-limited retries.")
    sys.exit(
        subprocess.call(
            [
                sys.executable,
                str(script),
                "--status",
                "not_found",
                "--limit",
                "80",
                "--delay",
                "1.5",
            ]
        )
    )
