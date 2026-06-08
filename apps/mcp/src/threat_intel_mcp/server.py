from __future__ import annotations

from typing import Any, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

from .client import ThreatIntelClient


class FindingsFilters(BaseModel):
    agent: str | None = Field(default=None, description="Filter by agent name")
    cveId: str | None = Field(default=None, description="Filter by CVE ID")
    minCvss: float | None = Field(default=None, description="Minimum CVSS score")
    maxCvss: float | None = Field(default=None, description="Maximum CVSS score")
    since: str | None = Field(default=None, description="ISO date/time lower bound")
    limit: int | None = Field(default=None, description="Limit (server clamps)")
    offset: int | None = Field(default=None, description="Offset (server clamps)")


class DetectionFormat(BaseModel):
    format: Literal["sigma", "kql", "spl"]


def create_server(client: ThreatIntelClient) -> FastMCP:
    mcp = FastMCP("threat-intel-mcp")

    @mcp.tool()
    async def search_findings(query: str = "", filters: FindingsFilters | None = None) -> Any:
        """Search findings (keyword/KQL filters) via /api/v1/findings."""
        return await client.search_findings(query=query or None, filters=(filters.model_dump(exclude_none=True) if filters else None))

    @mcp.tool()
    async def run_kql(query_string: str, debug: bool = False) -> Any:
        """Run a KQL query via /api/v1/query."""
        return await client.run_kql(query_string=query_string, debug=debug)

    @mcp.tool()
    async def get_threat_actor(name_or_alias: str) -> Any:
        """Resolve a threat actor by name/alias and return its profile via /api/v1/actors/*."""
        return await client.get_threat_actor(name_or_alias=name_or_alias)

    @mcp.tool()
    async def get_cve(cve_id: str) -> Any:
        """Fetch CVE details and enrichment via /api/v1/cves/{cveId}."""
        return await client.get_cve(cve_id=cve_id)

    @mcp.tool()
    async def get_navigator_scenarios(limit: int = 50, offset: int = 0) -> Any:
        """List navigator scenarios via /api/v1/navigator/scenarios."""
        return await client.get_navigator_scenarios(limit=limit, offset=offset)

    @mcp.tool()
    async def create_playbook(incident_description: str, incident_type: str | None = None, title: str | None = None) -> Any:
        """Create (persist) an incident response playbook via /api/v1/playbooks."""
        return await client.create_playbook(incident_description=incident_description, incident_type=incident_type, title=title)

    @mcp.tool()
    async def get_detections(technique_id: str, scenario_id: str | None = None) -> Any:
        """Generate detections (Sigma + KQL + SPL) via /api/v1/navigator/detections."""
        return await client.get_detections(technique_id=technique_id, scenario_id=scenario_id, formats=["sigma", "kql", "spl"])

    return mcp

