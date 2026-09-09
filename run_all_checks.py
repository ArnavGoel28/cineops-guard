"""
Run every scene in the sample schedule through check_safety_compliance in
one pass. Use this right before recording your demo video to seed Grafana
with a realistic mix of approved/blocked events so the dashboard has
something to show instead of one lonely data point.

    python run_all_checks.py
"""

import json

from agent.agents.compliance_agent import check_safety_compliance  # noqa: E402
from agent.grafana_client import get_grafana_telemetry_stats  # noqa: E402

SAMPLE_SCENES = ["SC-001", "SC-005", "SC-014", "SC-022", "SC-030"]

if __name__ == "__main__":
    print("🎬 Seeding Grafana Live Stream Annotations...")
    for scene_id in SAMPLE_SCENES:
        result = check_safety_compliance(scene_id)
        print(f"[{scene_id}] -> Status: {result.get('status').upper()} | Grafana: {result.get('grafana')}")
        print("-" * 60)

    stats = get_grafana_telemetry_stats()
    print("\n📊 GRAFANA TELEMETRY SUMMARY:")
    print(json.dumps(stats, indent=2))


