from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

import httpx


@dataclass(frozen=True)
class ThreatIntelClientConfig:
    base_url: str
    api_key: str
    timeout_seconds: float = 30.0


class ThreatIntelApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


def _clean_base_url(value: str) -> str:
    v = (value or "").strip()
    v = v[:-1] if v.endswith("/") else v
    return v


class ThreatIntelClient:
    def __init__(self, config: ThreatIntelClientConfig):
        self._config = ThreatIntelClientConfig(
            base_url=_clean_base_url(config.base_url),
            api_key=(config.api_key or "").strip(),
            timeout_seconds=float(config.timeout_seconds),
        )
        if not self._config.base_url:
            raise ValueError("TI_BASE_URL is required")
        if not self._config.api_key:
            raise ValueError("TI_API_KEY is required")

        self._client = httpx.AsyncClient(
            base_url=self._config.base_url,
            timeout=httpx.Timeout(self._config.timeout_seconds),
            headers={"authorization": f"Bearer {self._config.api_key}"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, *, params: Mapping[str, Any] | None = None, json: Any = None) -> Any:
        try:
            res = await self._client.request(method, path, params=params, json=json)
        except httpx.RequestError as exc:
            raise ThreatIntelApiError(f"Request failed: {exc.__class__.__name__}: {exc}") from exc

        data: Any = None
        try:
            data = res.json()
        except Exception:
            data = None

        if res.status_code >= 400:
            msg = None
            if isinstance(data, dict) and "error" in data:
                msg = str(data.get("error"))
            if not msg:
                msg = f"HTTP {res.status_code}"
            raise ThreatIntelApiError(msg, status_code=res.status_code, payload=data)

        return data

    async def search_findings(self, *, query: str | None = None, filters: Mapping[str, Any] | None = None) -> Any:
        params: dict[str, Any] = {}
        if query:
            params["q"] = str(query)
        filters = dict(filters or {})
        for key in ["agent", "cveId", "since"]:
            if filters.get(key) is not None and str(filters[key]).strip():
                params[key] = str(filters[key]).strip()
        for key in ["minCvss", "maxCvss", "limit", "offset"]:
            if filters.get(key) is not None and str(filters[key]).strip():
                params[key] = str(filters[key]).strip()
        return await self._request("GET", "/api/v1/findings", params=params)

    async def run_kql(self, *, query_string: str, debug: bool = False) -> Any:
        payload = {"query": query_string, "debug": bool(debug)}
        return await self._request("POST", "/api/v1/query", json=payload)

    async def resolve_actor(self, *, name_or_alias: str) -> Any:
        return await self._request("GET", "/api/v1/actors/resolve", params={"q": name_or_alias})

    async def get_actor(self, *, actor_id: str) -> Any:
        return await self._request("GET", f"/api/v1/actors/{actor_id}")

    async def get_threat_actor(self, *, name_or_alias: str) -> Any:
        resolved = await self.resolve_actor(name_or_alias=name_or_alias)
        actor_id = resolved.get("actorId") if isinstance(resolved, dict) else None
        if not actor_id:
            return resolved
        return await self.get_actor(actor_id=str(actor_id))

    async def get_cve(self, *, cve_id: str) -> Any:
        return await self._request("GET", f"/api/v1/cves/{cve_id}")

    async def get_navigator_scenarios(self, *, limit: int = 50, offset: int = 0) -> Any:
        return await self._request(
            "GET",
            "/api/v1/navigator/scenarios",
            params={"limit": str(limit), "offset": str(offset)},
        )

    async def create_playbook(
        self,
        *,
        incident_description: str,
        incident_type: str | None = None,
        title: str | None = None,
    ) -> Any:
        payload: dict[str, Any] = {"incidentDescription": incident_description}
        if incident_type:
            payload["incidentType"] = incident_type
        if title:
            payload["title"] = title
        return await self._request("POST", "/api/v1/playbooks", json=payload)

    async def get_detections(self, *, technique_id: str, scenario_id: str | None = None, formats: list[str] | None = None) -> Any:
        payload: dict[str, Any] = {"techniqueId": technique_id, "formats": formats or ["sigma", "kql", "spl"]}
        if scenario_id:
            payload["scenarioId"] = scenario_id
        return await self._request("POST", "/api/v1/navigator/detections", json=payload)

