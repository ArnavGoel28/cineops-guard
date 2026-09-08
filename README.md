# CineOps Guard

A production-safety gate for film shoots. Built for **Agentic Cinema: The
Blockbuster Hackathon** — Grafana Labs partner track.

## The problem

Every shoot day, someone has to sign off that every stunt or hazard scene
on the schedule actually meets safety requirements — stunt coordinator
assigned, medic on set, wind within tolerance, equipment confirmed. In
practice this check is manual, inconsistent, and easy to rush under
schedule pressure.

## What this does

An ADK agent (Gemini 2.5 Flash) that is **structurally unable** to approve
or block a scene without first calling `check_safety_compliance` — a tool
that checks the scene against a safety-rules dataset (stunt type → required
signoffs, equipment, wind limits). Every check, approved or blocked, is
pushed live to Grafana as an annotation, so a shoot's compliance status is
visible on a dashboard in real time instead of buried in someone's
notebook.

## Architecture

```
schedule.json + safety_rules.json
            │
            ▼
  check_safety_compliance()  ──────►  Grafana Annotations API
            ▲                          (live compliance events)
            │  forced tool call
            │  (before_model_callback, see agent/agent.py)
            │
      ADK Agent (Gemini 2.5 Flash)
            ▲
            │
   FastAPI (/ask, /check/{scene_id})
            ▲
            │
        Cloud Run (public URL)
```

Two layers of enforcement, on purpose:
- **Code-level gate** — `/check/{scene_id}` calls the compliance function
  directly, deterministically, no LLM involved. This is what you'd wire
  into a real production pipeline.
- **Model-level gate** — `/ask` routes through the actual ADK agent, which
  is forced (not just prompted) to call the same tool before it can answer.
  See the design note at the top of `agent/agent.py` for why this uses a
  per-turn `before_model_callback` instead of a static
  `FunctionCallingConfig(mode="ANY")` — the static version has a known
  infinite-loop bug ([adk-python#4179](https://github.com/google/adk-python/issues/4179)).

## Setup

```bash
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# fill in GOOGLE_API_KEY (from https://aistudio.google.com/apikey)
# and GRAFANA_URL / GRAFANA_API_KEY (Grafana Cloud service account token)
```

## Run locally

Interactive ADK dev UI (good for debugging the agent's tool-calling):

```bash
adk web
```

Full API (this is what actually gets deployed):

```bash
uvicorn api.main:app --reload --port 8080
```

Try it:

```bash
curl -X POST http://localhost:8080/check/SC-021
curl -X POST http://localhost:8080/ask \
  -H "Content-Type: application/json" \
  -d '{"message": "Can we shoot SC-014 tomorrow?"}'
```

Before recording your demo, seed Grafana with a full batch of realistic
events in one shot:

```bash
python run_all_checks.py
```

## Grafana dashboard

1. In Grafana Cloud: **Administration → Service accounts** → create a
   token with `annotations:write` (and `annotations:read` if you want a
   panel querying them back).
2. Create a dashboard with any time-series or state-timeline panel (even
   an empty one) and enable **annotations** pointed at your Grafana
   instance's built-in annotations source. Every `check_safety_compliance`
   call shows up as a marker: green `approved`, red `blocked` with the
   violation reason in the tooltip.

## Deploy

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

gcloud run deploy cineops-guard \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_API_KEY=...,GRAFANA_URL=...,GRAFANA_API_KEY=...
```

Cloud Run gives you the public URL required for submission.

## What's deliberately out of scope

Multi-agent orchestration, voice/Live API, script PDF parsing, and
generative media (Imagen/Lyria/TTS) were all cut to keep this a coherent,
finishable single-agent system in the time available — see project notes
for the reasoning.

## License

MIT — see [LICENSE](./LICENSE).
