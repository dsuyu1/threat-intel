# threat-intel-mcp

An MCP server for the Threat Intel platform. It runs over stdio and authenticates to your Threat Intel deployment using an existing platform API key.

## Install (pipx)

```bash
pipx install threat-intel-mcp
```

## Configuration

Required environment variables:

- `TI_BASE_URL` (example: `https://app.example.com`)
- `TI_API_KEY` (an API key secret starting with `ti_api_...`)

Optional:

- `TI_TIMEOUT_SECONDS` (default: `30`)

## Run

```bash
TI_BASE_URL="https://app.example.com" TI_API_KEY="ti_api_..." threat-intel-mcp
```

## Tools

This server exposes tools backed by API-key authenticated `/api/v1/*` endpoints:

- `search_findings(query, filters)` → `GET /api/v1/findings`
- `run_kql(query_string)` → `POST /api/v1/query`
- `get_threat_actor(name_or_alias)` → `GET /api/v1/actors/resolve` + `GET /api/v1/actors/{actorId}`
- `get_cve(cve_id)` → `GET /api/v1/cves/{cveId}`
- `get_navigator_scenarios()` → `GET /api/v1/navigator/scenarios`
- `create_playbook(incident_description)` → `POST /api/v1/playbooks`
- `get_detections(technique_id)` → `POST /api/v1/navigator/detections`

## Required API key scopes

Create a platform API key with (at minimum) these scopes:

- `findings:read`
- `actors:read`
- `cves:read`
- `query:run`
- `navigator:read` (for scenarios)
- `playbooks:write`
- `detections:generate` (Pro-tier only)

## Example MCP client config (stdio)

Example (Claude Code / Cursor-style config):

```json
{
  "mcpServers": {
    "threat-intel": {
      "command": "threat-intel-mcp",
      "env": {
        "TI_BASE_URL": "https://app.example.com",
        "TI_API_KEY": "ti_api_..."
      }
    }
  }
}
```

## Docker

Build:

```bash
docker build -t threat-intel-mcp:latest .
```

Run:

```bash
docker run --rm -i -e TI_BASE_URL="https://app.example.com" -e TI_API_KEY="ti_api_..." threat-intel-mcp:latest
```

