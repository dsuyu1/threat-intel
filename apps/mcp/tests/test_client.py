import asyncio
import json

import httpx

from threat_intel_mcp.client import ThreatIntelClient, ThreatIntelClientConfig, ThreatIntelApiError


def make_client(handler):
    transport = httpx.MockTransport(handler)
    client = ThreatIntelClient(ThreatIntelClientConfig(base_url="https://example.test", api_key="ti_api_test"))
    # Patch transport for tests (keep headers/base_url logic).
    asyncio.run(client._client.aclose())
    client._client = httpx.AsyncClient(
        base_url="https://example.test",
        headers={"authorization": "Bearer ti_api_test"},
        transport=transport,
    )
    return client


def test_run_kql_posts_to_v1_query():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/v1/query"
        body = json.loads(request.content.decode("utf-8"))
        assert body["query"] == "Findings | take 1"
        return httpx.Response(
            200,
            json={
                "columns": ["x"],
                "rows": [{"x": 1}],
                "meta": {"tables": [], "durationMs": 1, "rowCount": 1},
            },
        )

    client = make_client(handler)
    try:
        res = asyncio.run(client.run_kql(query_string="Findings | take 1"))
        assert res["columns"] == ["x"]
    finally:
        asyncio.run(client.aclose())


def test_error_surface_includes_json_error():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "Forbidden"})

    client = make_client(handler)
    try:
        asyncio.run(client.get_cve(cve_id="CVE-2024-0001"))
        raise AssertionError("Expected error")
    except ThreatIntelApiError as exc:
        assert exc.status_code == 403
        assert "Forbidden" in str(exc)
    finally:
        asyncio.run(client.aclose())
