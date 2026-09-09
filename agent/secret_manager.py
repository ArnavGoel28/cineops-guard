"""
CineOps Guard — GCP Secret Manager Integration

Securely retrieves API keys and credentials from Google Cloud Secret Manager,
with automatic fallback to environment variables (.env) for local development.

Usage:
    from agent.secret_manager import get_secret
    gemini_key = get_secret("GEMINI_API_KEY")
"""

from __future__ import annotations

import os
import logging
from typing import Optional

logger = logging.getLogger("cineops_guard.secret_manager")


def get_secret(secret_id: str, default: Optional[str] = None) -> Optional[str]:
    """Retrieve secret from GCP Secret Manager or fallback to os.getenv.

    Args:
        secret_id: Name of the secret / environment variable (e.g. "GEMINI_API_KEY").
        default: Fallback value if not found in Secret Manager or env.

    Returns:
        Secret string value or default.
    """
    gcp_project = os.getenv("GCP_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")

    if gcp_project:
        try:
            from google.cloud import secretmanager

            client = secretmanager.SecretManagerServiceClient()
            name = f"projects/{gcp_project}/secrets/{secret_id}/versions/latest"
            response = client.access_secret_version(request={"name": name})
            secret_value = response.payload.data.decode("UTF-8").strip()
            logger.info("Successfully fetched secret '%s' from Secret Manager", secret_id)
            return secret_value
        except Exception as exc:
            logger.debug(
                "GCP Secret Manager access for '%s' failed or not available: %s — falling back to env",
                secret_id,
                exc,
            )

    env_val = os.getenv(secret_id)
    if env_val:
        return env_val

    return default


if __name__ == "__main__":
    print(f"GEMINI_API_KEY: {'[SET]' if get_secret('GEMINI_API_KEY') else '[NOT SET]'}")
    print(f"GRAFANA_API_KEY: {'[SET]' if get_secret('GRAFANA_API_KEY') else '[NOT SET]'}")
