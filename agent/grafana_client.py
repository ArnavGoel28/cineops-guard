"""
Thin client around the Grafana Annotations API.

Every compliance check the agent runs pushes one annotation to Grafana:
approved checks get a green "approved" tag, blocked checks get a red
"blocked" tag plus the specific reason. Point any dashboard's time-series
or state-timeline panel at this Grafana instance and annotations render
automatically as markers — this is the "live compliance status" panel
described in the project scope.

Requires two environment variables:
  GRAFANA_URL       e.g. https://yourstack.grafana.net
  GRAFANA_API_KEY   a Grafana service account token with annotations:write

If these aren't set, calls are logged locally instead of failing outright,
so the agent logic can still be developed/tested without live credentials.
"""

from __future__ import annotations

import os
import time
import logging
from typing import Optional

import requests

logger = logging.getLogger("cineops_guard.grafana")

GRAFANA_URL = os.getenv("GRAFANA_URL", "").rstrip("/")
GRAFANA_API_KEY = os.getenv("GRAFANA_API_KEY", "")


def push_compliance_event(
    scene_id: str,
    status: str,
    reason: Optional[str] = None,
    stunt_type: Optional[str] = None,
) -> dict:
    """Push one compliance-check event to Grafana as an annotation.

    Args:
        scene_id: the schedule scene this check was run against, e.g. "SC-014"
        status: "approved" or "blocked"
        reason: human-readable reason when status == "blocked"
        stunt_type: the stunt category checked, for tagging/filtering

    Returns:
        dict with the outcome of the push (or a local fallback record if
        Grafana isn't configured yet).
    """
    tags = ["cineops-guard", status]
    if stunt_type:
        tags.append(stunt_type)

    text = f"{scene_id}: {status.upper()}"
    if status == "blocked" and reason:
        text += f" — {reason}"

    payload = {
        "time": int(time.time() * 1000),
        "tags": tags,
        "text": text,
    }

    if not GRAFANA_URL or not GRAFANA_API_KEY:
        logger.warning(
            "GRAFANA_URL / GRAFANA_API_KEY not set — logging event locally "
            "instead of pushing to Grafana: %s",
            payload,
        )
        return {"pushed": False, "reason": "grafana_not_configured", "payload": payload}

    try:
        resp = requests.post(
            f"{GRAFANA_URL}/api/annotations",
            json=payload,
            headers={
                "Authorization": f"Bearer {GRAFANA_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        resp.raise_for_status()
        return {"pushed": True, "response": resp.json()}
    except requests.RequestException as exc:
        logger.error("Failed to push annotation to Grafana: %s", exc)
        return {"pushed": False, "reason": str(exc), "payload": payload}
