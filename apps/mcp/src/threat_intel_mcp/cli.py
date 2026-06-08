from __future__ import annotations

import os
import sys

from .client import ThreatIntelClient, ThreatIntelClientConfig
from .server import create_server


def _env(name: str) -> str | None:
    v = os.environ.get(name)
    v = v.strip() if v else None
    return v or None


def main() -> None:
    base_url = _env("TI_BASE_URL")
    api_key = _env("TI_API_KEY")
    timeout_raw = _env("TI_TIMEOUT_SECONDS")
    timeout_seconds = float(timeout_raw) if timeout_raw else 30.0

    if not base_url or not api_key:
        sys.stderr.write("Missing required environment variables: TI_BASE_URL and TI_API_KEY\n")
        raise SystemExit(2)

    client = ThreatIntelClient(ThreatIntelClientConfig(base_url=base_url, api_key=api_key, timeout_seconds=timeout_seconds))
    mcp = create_server(client)
    mcp.run()

