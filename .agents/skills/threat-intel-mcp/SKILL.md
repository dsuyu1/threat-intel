---
name: threat-intel-mcp
description: >-
  How to work on the Python MCP server in apps/mcp: running it locally, adding
  tools backed by /api/v1 endpoints, and required API key scopes.
---

# Threat Intel MCP (apps/mcp)

Use this skill when updating the `threat-intel-mcp` server or adding new tools.

## Purpose

`apps/mcp` provides a stdio MCP server (FastMCP) that authenticates to the platform using a platform API key and calls `/api/v1/*` endpoints.

## Local run (dev)

Set:
- `TI_BASE_URL` (example: `http://localhost:3000`)
- `TI_API_KEY` (secret starting with `ti_api_...`)

Then run the CLI entrypoint (see `apps/mcp/README.md`).

## Add a new tool (pattern)

1. Add a client method in `apps/mcp/src/threat_intel_mcp/client.py`.
2. Expose it in `apps/mcp/src/threat_intel_mcp/server.py` using `@mcp.tool()`.
3. Keep parameter schemas typed with `pydantic` models when non-trivial.

## Required API key scopes (baseline)

Depending on enabled tools, ensure the platform API key includes:

- `findings:read`
- `actors:read`
- `cves:read`
- `query:run`
- `navigator:read`
- `playbooks:write`
- `detections:generate`

