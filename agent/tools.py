"""
Legacy tools.py — now a thin compatibility shim.

In v2 the compliance logic lives in agent/agents/compliance_agent.py and
reads from the MCP server. This module re-exports check_safety_compliance
so that existing callers (e.g. the /check/{scene_id} fast path in api/main.py)
don't break during the migration.
"""

from agent.agents.compliance_agent import check_safety_compliance

__all__ = ["check_safety_compliance"]
