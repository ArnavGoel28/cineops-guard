# CineOps Guard — Technical Requirements Document (TRD)

## 1. Architecture Overview

```
                          ┌─────────────────────────┐
                          │   Frontend (Next.js)     │
                          │   Cloud Run / Vercel      │
                          └───────────┬──────────────┘
                                      │ REST + WebSocket
                          ┌───────────▼──────────────┐
                          │   API Gateway (FastAPI)   │
                          │   Cloud Run                │
                          └───────────┬──────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
            ┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
            │  Director     │  │  MCP Server   │  │  Auth /       │
            │  Agent (ADK)  │◄─┤  (production   │  │  Identity     │
            │  Agent Engine │  │  data access)  │  │  Platform     │
            └───────┬───────┘  └───────┬───────┘  └───────────────┘
                    │                  │
   ┌────────────────┼──────────────────┼───────────────────────┐
   │                │                  │                       │
┌──▼─────┐  ┌───────▼────┐  ┌──────────▼─────┐  ┌─────────┐  ┌─▼──────┐
│Comply- │  │ScriptIntake│  │Storyboard/Audio│  │Rehearsal│  │Dailies │
│anceAgt │  │Agent (PDF, │  │Agent (Imagen,  │  │Agent    │  │Agent   │
│(v1 core│  │ RAG ingest)│  │ Lyria, TTS)    │  │(Live API│  │(video  │
│ + this │  │            │  │                │  │ voice)  │  │transc.)│
│ v2 gate│  │            │  │                │  │         │  │        │
└───┬────┘  └─────┬──────┘  └───────┬────────┘  └────┬────┘  └───┬────┘
    │             │                 │                │            │
    └─────────────┴─────────────────┴────────────────┴────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
             ┌──────▼─────┐  ┌───────▼──────┐  ┌───────▼──────┐
             │ Cloud SQL   │  │  BigQuery     │  │ Cloud Storage │
             │ (Postgres)  │  │  (vector +    │  │ (media assets,│
             │ relational  │  │   analytics)  │  │  PDFs, audio) │
             │ data        │  │               │  │               │
             └─────────────┘  └───────────────┘  └───────────────┘
                                     │
                            ┌────────▼────────┐
                            │  Grafana Cloud   │
                            │  (compliance +   │
                            │  system dashboards)│
                            └─────────────────┘
```

## 2. Component Breakdown

### 2.1 Director Agent (ADK, Agent Engine)
Root orchestrator. Holds session state, decides routing to sub-agents
(sequential for dependent steps — e.g. intake before storyboard — or
parallel via ADK's `ParallelAgent` for independent ones). Forced
function calling is used specifically on `ComplianceAgent` calls, same
mechanism as v1 (`before_model_callback`, per-turn, loop-safe).

### 2.2 Sub-agents
Each is a standalone `LlmAgent` with its own tool set, registered with
the Director via `sub_agents=[...]`:

- **ComplianceAgent** — v1 logic, now reading rules/schedule via MCP
  instead of local JSON.
- **ScriptIntakeAgent** — tools: `parse_script_pdf`, `extract_scenes`,
  `embed_and_index` (writes to BigQuery Vector Search).
- **StoryboardAgent** — tool: `generate_storyboard_panels` (Imagen 3 API).
- **AudioAgent** — tools: `generate_mood_music` (Lyria 3),
  `generate_dialogue_read` (Gemini TTS multi-speaker).
- **RehearsalAgent** — connects to Gemini Live API over WebSocket for
  bidirectional audio; not a standard request/response tool call.
- **DailiesAgent** — tools: `transcribe_video`, `caption_video`,
  `analyze_delivery_sentiment`.

### 2.3 MCP Server
A standalone service (FastAPI + an MCP server library, or the
Python MCP SDK directly) exposing production data as MCP
resources/tools: `get_scene`, `list_scenes`, `get_compliance_history`,
`get_script_text`, `list_media_assets`. Agents connect to it as an MCP
client (per the MCP Database Toolbox pattern). This is what makes data
access a real protocol integration instead of local file reads — and
is the piece most directly relevant to prior interest in MCP tooling.

### 2.4 API Gateway
FastAPI, same shape as v1's `api/main.py` but expanded: auth middleware,
per-persona route guards, file upload endpoints for PDFs/video, and a
WebSocket proxy for the Live API rehearsal sessions.

### 2.5 Data Layer
- **Cloud SQL (Postgres)** — relational system of record: users,
  productions, scenes, compliance checks, media asset metadata,
  rehearsal sessions. See Backend Schema doc.
- **BigQuery** — vector embeddings of script text + compliance history
  for RAG, plus analytics queries (compliance rate over time, etc.)
- **Cloud Storage** — blobs: uploaded PDFs, generated storyboard images,
  generated audio, uploaded dailies video.
- **Grafana Cloud** — annotations (v1, unchanged) plus new panels for
  storyboard/audio generation volume and rehearsal session counts.

### 2.6 Auth
Firebase Auth or Google Cloud Identity Platform. Roles enforced at the
API Gateway layer and mirrored into Postgres for row-level checks
(e.g., an Actor can only see their own rehearsal sessions).

## 3. Integration Specs

| Integration | Purpose | Notes |
|---|---|---|
| Gemini 2.5 Flash / Pro | All agent reasoning | Pro for ScriptIntake (long context), Flash elsewhere for latency |
| Imagen 3 | Storyboard generation | Async — generation takes seconds, use a job/polling pattern in the API |
| Lyria 3 | Mood music generation | Same async pattern as Imagen |
| Gemini TTS (multi-speaker) | Dialogue reference reads | Sync for short clips |
| Gemini Live API | Actor rehearsal | WebSocket, persistent connection per session, separate from the request/response agent flow |
| Video Transcription/Captioning | Dailies processing | Batch job, triggered on upload, not real-time |
| BigQuery Vector Search | RAG grounding | Embeddings via Gemini embedding model, indexed per production |
| MCP Server (custom) | Structured data access for all agents | Python MCP SDK, deployed as its own Cloud Run service |
| Grafana Annotations API | Live compliance status | Unchanged from v1 |

## 4. Non-Functional Requirements

- **Latency:** Compliance checks must stay sub-2s (matches v1). Storyboard/
  music generation can be async with a job-status pattern — do not block
  the UI thread waiting on Imagen/Lyria.
- **Security:** All media/script content is production-confidential —
  Cloud Storage buckets are private, signed URLs only, no public bucket
  access. MCP server requires authenticated client credentials, not open
  access.
- **Auditability:** Every compliance decision, override, and generated
  asset is timestamped and attributed to a user — this is a compliance
  system first, a creative tool second.
- **Observability:** Grafana covers both the safety-gate metrics (v1)
  and basic system health (API error rates, agent latency) — one
  dashboard, two purposes.

## 5. Deployment

- Each agent-bearing service and the MCP server deploy independently to
  Cloud Run (or Director + sub-agents as one Agent Engine deployment,
  MCP server as its own Cloud Run service — cleaner separation).
- Frontend deploys separately (Cloud Run or Vercel) and talks to the API
  Gateway over HTTPS/WSS.
- Infra-as-code (Terraform) recommended once past hackathon scope, to
  keep Cloud SQL/BigQuery/Storage/IAM reproducible.
