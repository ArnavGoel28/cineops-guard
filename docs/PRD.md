# CineOps Guard — Product Requirements Document (PRD)

**Version:** 2.0 (Full Scope) | **Status:** Planning

## 1. Problem

Production teams juggle a scattered set of manual processes across a shoot:
safety compliance sign-off, storyboard/previz creation, mood/reference
music selection, dialogue reads, dailies review, and actor rehearsal —
each owned by a different person, in a different tool, with no shared
source of truth. Nothing catches a conflict (an unsafe scene, an
inconsistent line reading, a continuity break) until it's expensive to
fix.

## 2. Vision

One agentic system — a "production co-pilot" — that sits across the
whole pre-production and shoot-day workflow: ingests scripts and
schedules, enforces safety compliance before anything is approved,
generates supporting creative assets (storyboards, mood music, dialogue
reference audio) on request, lets actors rehearse against a live voice
agent, and gives production leads one dashboard for the state of
everything.

## 3. Users / Personas

| Persona | Needs |
|---|---|
| **Production Safety Lead** | Approve/block scenes fast, with an audit trail. Wants the compliance gate from v1. |
| **1st AD / Line Producer** | See the whole schedule's status at a glance — compliance, budget signal, what's blocking tomorrow. |
| **Screenwriter / Script Supervisor** | Upload a script PDF, get it structured automatically, ask continuity questions. |
| **Director / DP** | Generate storyboard panels and mood boards from a scene description without waiting on a concept artist. |
| **Sound Department** | Get reference music and TTS dialogue reads to guide the real recording session. |
| **Actor** | Rehearse lines against a responsive voice agent before set. |
| **Post/Dailies Reviewer** | Search video footage by what's said or shown in it; catch tone mismatches between read and script intent. |

## 4. Features (full scope — supersedes the v1 MVP)

### 4.1 Compliance Gate (v1 — already built)
Forced-tool-call ADK agent checks scenes against safety rules, logs to
Grafana. **Carried forward unchanged as the core reliability layer.**

### 4.2 Multi-Agent Orchestration
Replace the single agent with a **Director agent** that routes to
specialist sub-agents: `ComplianceAgent`, `ScriptIntakeAgent`,
`StoryboardAgent`, `AudioAgent`, `RehearsalAgent`, `DailiesAgent`. The
Director owns conversation state and decides which specialist(s) a
request needs — including running several in parallel (e.g., a "prep
scene 14" request fans out to Compliance + Storyboard + Audio at once).

### 4.3 Script/Schedule PDF Ingestion
Upload a real screenplay or call sheet PDF. `ScriptIntakeAgent` parses
it (Document Processing Guide), extracts scenes/characters/locations/
stunt flags, and writes structured records into the backend — replacing
the hand-authored `schedule.json` entirely.

### 4.4 RAG Grounding over Script + Rules Data
Script text and historical compliance decisions are embedded and stored
in BigQuery Vector Search / Vertex AI Search, so agents answer
continuity and precedent questions ("has this stunt type been approved
before under similar wind conditions?") against real grounded data
instead of a static local JSON file.

### 4.5 Storyboard Generation (Imagen 3)
`StoryboardAgent` turns a scene description into 3–6 storyboard panels.
Director/DP can regenerate with style notes; approved panels attach to
the scene record.

### 4.6 Mood / Reference Music (Lyria 3)
`AudioAgent` generates short mood/reference music clips per scene,
tagged by genre and intensity, attached to the scene record for the
sound department.

### 4.7 Dialogue Reference Reads (Gemini TTS)
Given a scene's dialogue lines, `AudioAgent` generates multi-speaker
reference reads (Gemini TTS) so directors can hear pacing/tone before
the actual recording session.

### 4.8 Actor Rehearsal (Live API, bidirectional voice)
`RehearsalAgent` runs a live, low-latency voice session where an actor
reads opposite an AI-voiced scene partner, via the Live API on Agent
Engine. Session transcript and a self-assessment summary are saved.

### 4.9 Dailies Search & Sentiment Check
`DailiesAgent` ingests raw video clips, generates timestamped
transcriptions/captions (Video Transcription/Captioning notebooks), and
runs sentiment analysis comparing the actor's delivered tone against the
script's intended tone, flagging mismatches for review.

### 4.10 Real MCP Server
Expose production data (scenes, compliance history, script text,
generated assets) through a genuine MCP server — not local file reads —
so any MCP-compatible client (including the ADK agents themselves, via
the MCP Database Toolbox pattern) can query it with a standard protocol.
This is the layer every agent above actually reads/writes through.

### 4.11 Auth, Multi-User, Persistence
Real accounts, roles (Safety Lead, AD, Director, Actor, Admin), and
persistent history — every check, generation, and rehearsal session is
attributable and auditable, not ephemeral.

### 4.12 Professional Frontend
A real product UI — not raw API endpoints — covering every flow above.
See the UI/UX Brief for detail.

## 5. Success Metrics

- Time from "script uploaded" to "fully structured, compliance-checked
  schedule" (target: minutes, not hours of manual entry)
- % of scenes with a storyboard/mood asset attached before shoot day
- Rehearsal sessions completed per actor per production
- Zero false-approvals in compliance audit log (this stays the
  non-negotiable bar — the gate must never soften)

## 6. Non-Goals

- Not a full editorial/NLE tool — dailies review is search + flagging,
  not cutting
- Not a payroll/budgeting system — budget signal, if added later, is
  read-only context, not a finance system of record
- Not replacing a human safety officer's sign-off authority — the
  agent blocks/flags; a human still has final override, logged as such
