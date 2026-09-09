"""
CineOps Guard — ADK Agent Engine Deployment Script

Deploys the CineOps Guard ADK root agent to serverless Vertex AI Agent Engine.

Usage:
    python agent/deploy_agent_engine.py [--project YOUR_PROJECT_ID] [--location us-central1] [--dry-run]
"""

from __future__ import annotations

import argparse
import os
import sys

from agent.agent import root_agent


def deploy_to_agent_engine(
    project_id: str,
    location: str = "us-central1",
    display_name: str = "CineOps-Guard-Director-Agent",
    dry_run: bool = False,
):
    """Deploy root_agent to Vertex AI Agent Engine."""
    print(f"🚀 Initializing ADK Agent Engine deployment for '{display_name}'...")
    print(f"   Project: {project_id}")
    print(f"   Location: {location}")
    print(f"   Root Agent Model: {root_agent.model}")

    if dry_run:
        print("\n✅ DRY RUN MODE: Agent configuration validated successfully!")
        print(f"   Serialized Agent Name: {root_agent.name}")
        print(f"   Sub-agents attached: {[a.name for a in root_agent.sub_agents] if hasattr(root_agent, 'sub_agents') else 'Multi-agent routing config'}")
        return True

    try:
        import vertexai
        from google.cloud import aiplatform

        vertexai.init(project=project_id, location=location)

        print("📦 Packaging ADK Agent and serializing dependencies...")
        # Note: Uses google-cloud-aiplatform[agent_engines] runtime
        agent_engine_resource = aiplatform.AgentEngine.create(
            display_name=display_name,
            agent=root_agent,
            requirements=[
                "google-adk>=0.1.0",
                "google-genai>=1.0.0",
                "fastapi>=0.100.0",
                "httpx>=0.24.0",
                "requests>=2.31.0",
            ],
        )

        print(f"\n🎉 Successfully deployed ADK Agent to Agent Engine!")
        print(f"   Resource Name: {agent_engine_resource.resource_name}")
        return True
    except Exception as exc:
        print(f"\n⚠️ Deployment error or missing SDK credentials: {exc}")
        print("   Make sure google-cloud-aiplatform is installed and gcloud auth is configured.")
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Deploy CineOps Guard ADK Agent to Agent Engine")
    parser.add_argument("--project", default=os.getenv("GCP_PROJECT_ID", "cineops-guard-demo"), help="GCP Project ID")
    parser.add_argument("--location", default="us-central1", help="GCP Region")
    parser.add_argument("--dry-run", action="store_true", help="Validate agent configuration without making GCP API calls")

    args = parser.parse_args()
    success = deploy_to_agent_engine(args.project, args.location, dry_run=args.dry_run)
    sys.exit(0 if success else 1)
