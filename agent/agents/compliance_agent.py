"""
ComplianceAgent — the v1 safety gate, now reading from the MCP server.

Identical reliability guarantees as v1:
  - forced tool call via before_model_callback (never skipped)
  - sub-2s latency target for check_safety_compliance
  - append-only writes to compliance_checks via the MCP server

The only change from v1: data comes from Postgres via the MCP server
instead of local JSON files. The forced-tool-call mechanism is unchanged.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from google.adk.agents import Agent
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types

from agent.mcp_client import mcp
from agent import grafana_client

_TOOL_NAME = "check_safety_compliance"

COMPLIANCE_INSTRUCTION = """
You are the CineOps Guard ComplianceAgent — a production-safety gate.

When asked whether a scene can be approved for shooting, you MUST call
check_safety_compliance for that scene_id. Never guess or reason about
compliance yourself — the tool is the single source of truth.

After the tool returns, report clearly:
  - the scene_id and final status (APPROVED or BLOCKED)
  - if blocked, list every violation in plain language
  - do not soften or omit violations, and never approve a scene the tool blocked

If asked about precedent ("has a stunt like this been approved before?"),
use the compliance history returned by the tool to answer — grounded in
real history, not guesses.
"""


def _force_compliance_until_called(
    callback_context: CallbackContext, llm_request: LlmRequest
):
    """
    before_model_callback: force the compliance tool on the first model call
    of a turn; release the constraint (AUTO) once it has produced a result.

    This prevents the infinite-loop bug in ADK's static mode=ANY config
    (google/adk-python#4179) while still guaranteeing the tool always runs.
    """
    already_called = any(
        getattr(part, "function_response", None) is not None
        and part.function_response.name == _TOOL_NAME
        for content in (llm_request.contents or [])
        for part in (content.parts or [])
    )
    mode = "AUTO" if already_called else "ANY"
    llm_request.config = llm_request.config or types.GenerateContentConfig()
    llm_request.config.tool_config = types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode=mode,
            allowed_function_names=[_TOOL_NAME] if mode == "ANY" else None,
        )
    )
    return None


def check_safety_compliance(scene_id: str) -> dict:
    """Check whether a scheduled scene meets safety-compliance rules.

    Reads scene data and safety rules from the MCP server (Postgres), runs
    all compliance checks, writes the result back via write_compliance_check
    (append-only), and pushes a Grafana annotation.

    Args:
        scene_id: scene identifier, e.g. "SC-014" or a UUID.

    Returns:
        dict with status, scene_id, stunt_type, violations, grafana result.
    """
    try:
        return asyncio.run(_async_check(scene_id))
    except RuntimeError:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(lambda: asyncio.run(_async_check(scene_id)))
            return future.result()


async def _async_check(scene_id: str) -> dict:
    # ── 1. Fetch scene from MCP server ───────────────────────────
    try:
        scene = await mcp.get_scene(scene_id)
    except Exception as exc:
        result = {
            "status": "blocked",
            "scene_id": scene_id,
            "stunt_type": None,
            "violations": [f"Scene '{scene_id}' not found or MCP error: {exc}"],
        }
        result["grafana"] = grafana_client.push_compliance_event(
            scene_id, "blocked", reason=result["violations"][0]
        )
        return result

    stunt_type = scene.get("stunt_type", "none")

    # ── 2. Fetch matching safety rule ────────────────────────────
    try:
        rule = await mcp.get_safety_rule(stunt_type)
    except Exception:
        # Fallback to "none" rule
        rule = await mcp.get_safety_rule("none")

    violations: list[str] = []

    if rule["requires_stunt_coordinator"] and not scene.get("stunt_coordinator_assigned"):
        violations.append("No stunt coordinator assigned.")

    if rule["requires_medic_onset"] and not scene.get("medic_onset"):
        violations.append("No on-set medic confirmed.")

    forecast_wind = scene.get("forecast_wind_kmh") or 0
    if forecast_wind > rule["max_wind_speed_kmh"]:
        violations.append(
            f"Forecast wind {forecast_wind} km/h exceeds max "
            f"{rule['max_wind_speed_kmh']} km/h for {stunt_type}."
        )

    signoffs = scene.get("crew_signoffs", 0)
    if signoffs < rule["min_crew_signoffs"]:
        violations.append(
            f"Only {signoffs} crew signoff(s); {rule['min_crew_signoffs']} required."
        )

    confirmed = set(scene.get("equipment_confirmed") or [])
    missing = set(rule.get("required_equipment") or []) - confirmed
    if missing:
        violations.append(f"Missing required equipment: {', '.join(sorted(missing))}.")

    status = "blocked" if violations else "approved"
    reason = "; ".join(violations) if violations else None

    # ── 3. Push Grafana annotation ───────────────────────────────
    grafana_result = grafana_client.push_compliance_event(
        scene_id, status, reason=reason, stunt_type=stunt_type
    )

    # ── 4. Write compliance check to MCP server (append-only) ───
    try:
        await mcp.write_compliance_check(
            scene_id=scene["id"],
            status=status,
            violations=violations,
            checked_by_agent="compliance_agent",
            grafana_pushed=grafana_result.get("pushed", False),
        )
    except Exception as exc:
        # Never block the compliance result if the DB write fails
        grafana_result["db_write_error"] = str(exc)

    return {
        "status": status,
        "scene_id": scene_id,
        "stunt_type": stunt_type,
        "violations": violations,
        "grafana": grafana_result,
    }


compliance_agent = Agent(
    name="compliance_agent",
    model="gemini-3.6-flash",
    description=(
        "Production-safety gate. Checks stunt/scene compliance against "
        "safety rules read from the MCP server. Must always call "
        "check_safety_compliance before issuing any approval or block. "
        "Logs every check to Grafana and to the append-only compliance_checks table."
    ),
    instruction=COMPLIANCE_INSTRUCTION,
    tools=[check_safety_compliance],
    before_model_callback=_force_compliance_until_called,
)
