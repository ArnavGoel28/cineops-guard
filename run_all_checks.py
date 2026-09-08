"""
Run every scene in the sample schedule through check_safety_compliance in
one pass. Use this right before recording your demo video to seed Grafana
with a realistic mix of approved/blocked events so the dashboard has
something to show instead of one lonely data point.

    python run_all_checks.py
"""

import json

from agent.tools import check_safety_compliance, _SCHEDULE  # noqa: E402

if __name__ == "__main__":
    for scene_id in _SCHEDULE:
        result = check_safety_compliance(scene_id)
        print(json.dumps(result, indent=2))
        print("-" * 60)
