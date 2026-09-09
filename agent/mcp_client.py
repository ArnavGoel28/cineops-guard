"""
MCP Client — async HTTP client for ADK agents to talk to the MCP server.

Every agent tool function that needs production data calls methods on this
client rather than touching any database directly. This is the enforcement
layer for the "MCP server is the only data path" rule.

Usage:
    from agent.mcp_client import mcp

    scene = await mcp.get_scene("SC-014")
    check_id = await mcp.write_compliance_check(...)
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://localhost:8000").rstrip("/")
_TIMEOUT = 30.0  # seconds


class MCPClient:
    """Thin async wrapper around the MCP server's REST API."""

    def __init__(self, base_url: str = MCP_SERVER_URL):
        self.base_url = base_url

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, timeout=_TIMEOUT)

    # ── Scenes ─────────────────────────────────────────────────────
    async def get_scene(self, scene_id: str) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.get(f"/scenes/{scene_id}")
            r.raise_for_status()
            return r.json()

    async def list_scenes(
        self,
        production_id: Optional[str] = None,
        status: Optional[str] = None,
        stunt_type: Optional[str] = None,
        shoot_date: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"limit": limit}
        if production_id:
            params["production_id"] = production_id
        if status:
            params["status"] = status
        if stunt_type:
            params["stunt_type"] = stunt_type
        if shoot_date:
            params["shoot_date"] = shoot_date
        async with self._client() as c:
            r = await c.get("/scenes", params=params)
            r.raise_for_status()
            return r.json()

    async def create_scene(self, scene_data: Dict[str, Any]) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.post("/scenes", json=scene_data)
            r.raise_for_status()
            return r.json()

    # ── Safety Rules ───────────────────────────────────────────────
    async def get_safety_rule(self, stunt_type: str) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.get(f"/safety-rules/{stunt_type}")
            r.raise_for_status()
            return r.json()

    async def list_safety_rules(self) -> List[Dict[str, Any]]:
        async with self._client() as c:
            r = await c.get("/safety-rules")
            r.raise_for_status()
            return r.json()

    # ── Compliance ─────────────────────────────────────────────────
    async def get_compliance_history(
        self,
        scene_id: Optional[str] = None,
        stunt_type: Optional[str] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"limit": limit}
        if scene_id:
            params["scene_id"] = scene_id
        if stunt_type:
            params["stunt_type"] = stunt_type
        async with self._client() as c:
            r = await c.get("/compliance-history", params=params)
            r.raise_for_status()
            return r.json()

    async def write_compliance_check(
        self,
        scene_id: str,
        status: str,
        violations: List[str],
        checked_by_agent: str,
        grafana_pushed: bool = False,
    ) -> Dict[str, Any]:
        """Always inserts — never updates. This is the append-only write path."""
        async with self._client() as c:
            r = await c.post("/compliance-checks", json={
                "scene_id": scene_id,
                "status": status,
                "violations": violations,
                "checked_by_agent": checked_by_agent,
                "grafana_pushed": grafana_pushed,
            })
            r.raise_for_status()
            return r.json()

    async def override_compliance(
        self, check_id: str, user_id: str, reason: str
    ) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.post(f"/compliance-checks/{check_id}/override", json={
                "user_id": user_id,
                "reason": reason,
            })
            r.raise_for_status()
            return r.json()

    # ── Scripts ────────────────────────────────────────────────────
    async def create_script(self, production_id: str, pdf_uri: Optional[str] = None) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.post("/scripts", json={"production_id": production_id, "source_pdf_uri": pdf_uri})
            r.raise_for_status()
            return r.json()

    async def update_script_status(
        self, script_id: str, status: str, parsed_at: Optional[str] = None
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"status": status}
        if parsed_at:
            body["parsed_at"] = parsed_at
        async with self._client() as c:
            r = await c.patch(f"/scripts/{script_id}/status", json=body)
            r.raise_for_status()
            return r.json()

    async def get_script_text(
        self, script_id: str, scene_ref: Optional[str] = None
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        if scene_ref:
            params["scene_ref"] = scene_ref
        async with self._client() as c:
            r = await c.get(f"/script-text/{script_id}", params=params)
            r.raise_for_status()
            return r.json()

    # ── Media Assets ───────────────────────────────────────────────
    async def list_media_assets(
        self, scene_id: Optional[str] = None, asset_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {}
        if scene_id:
            params["scene_id"] = scene_id
        if asset_type:
            params["type"] = asset_type
        async with self._client() as c:
            r = await c.get("/media-assets", params=params)
            r.raise_for_status()
            return r.json()

    async def write_media_asset(
        self,
        scene_id: str,
        asset_type: str,
        storage_uri: str,
        generated_by_agent: str,
        prompt_used: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.post("/media-assets", json={
                "scene_id": scene_id,
                "type": asset_type,
                "storage_uri": storage_uri,
                "generated_by_agent": generated_by_agent,
                "prompt_used": prompt_used,
            })
            r.raise_for_status()
            return r.json()

    async def approve_media_asset(self, asset_id: str, user_id: str) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.post(f"/media-assets/{asset_id}/approve", json={"user_id": user_id})
            r.raise_for_status()
            return r.json()

    # ── Rehearsal Sessions ─────────────────────────────────────────
    async def create_rehearsal_session(self, scene_id: str, actor_id: str) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.post("/rehearsal-sessions", json={"scene_id": scene_id, "actor_id": actor_id})
            r.raise_for_status()
            return r.json()

    async def end_rehearsal_session(
        self, session_id: str, transcript_uri: Optional[str] = None, summary: Optional[str] = None
    ) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.patch(f"/rehearsal-sessions/{session_id}", json={
                "transcript_uri": transcript_uri,
                "summary": summary,
            })
            r.raise_for_status()
            return r.json()

    # ── Dailies ────────────────────────────────────────────────────
    async def create_dailies(self, scene_id: str, video_uri: str) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.post("/dailies", json={"scene_id": scene_id, "video_uri": video_uri})
            r.raise_for_status()
            return r.json()

    async def update_dailies(
        self,
        dailies_id: str,
        transcript: Any = None,
        captions_uri: Optional[str] = None,
        sentiment_flags: Any = None,
        caption_metadata: Any = None,
        safety_hazard_flags: Any = None,
        vfx_concept_uris: Optional[List[str]] = None,
        score_audio_uri: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {}
        if transcript is not None:
            body["transcript"] = transcript
        if captions_uri:
            body["captions_uri"] = captions_uri
        if sentiment_flags is not None:
            body["sentiment_flags"] = sentiment_flags
        if caption_metadata is not None:
            body["caption_metadata"] = caption_metadata
        if safety_hazard_flags is not None:
            body["safety_hazard_flags"] = safety_hazard_flags
        if vfx_concept_uris is not None:
            body["vfx_concept_uris"] = vfx_concept_uris
        if score_audio_uri is not None:
            body["score_audio_uri"] = score_audio_uri
        async with self._client() as c:
            r = await c.patch(f"/dailies/{dailies_id}", json=body)
            r.raise_for_status()
            return r.json()

    # ── Productions ────────────────────────────────────────────────
    async def list_productions(self) -> List[Dict[str, Any]]:
        async with self._client() as c:
            r = await c.get("/productions")
            r.raise_for_status()
            return r.json()

    async def create_production(self, name: str, owner_id: Optional[str] = None) -> Dict[str, Any]:
        async with self._client() as c:
            r = await c.post("/productions", json={"name": name, "owner_id": owner_id})
            r.raise_for_status()
            return r.json()


# Singleton — import this in agent tools
mcp = MCPClient()
