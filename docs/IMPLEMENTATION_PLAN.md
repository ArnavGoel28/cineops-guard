# CineOps Guard — Implementation Plan

Sequenced so each phase produces something demoable on its own, and
later phases build on real infrastructure from earlier ones rather than
mocks.

## Phase A — Backend Foundation
**Goal:** replace local JSON files with the real data layer before
building anything new on top of it.
- Stand up Cloud SQL (Postgres), apply the Backend Schema
- Migrate `safety_rules.json` / `schedule.json` content into Postgres
- Build the MCP server exposing the resource map from the schema doc
- Point v1's `ComplianceAgent` at the MCP server instead of local files
  (this alone is a meaningful upgrade — validate it end-to-end before
  moving on)
- Add auth (Identity Platform) + `users` table, basic role checks at
  the API Gateway

## Phase B — Multi-Agent Orchestration
**Goal:** Director agent routes to a first specialist beyond Compliance.
- Introduce `ScriptIntakeAgent` first — it's the natural second agent
  since everything downstream depends on structured scene data
- Build `parse_script_pdf` (Document Processing Guide) → writes scenes
  into Postgres via the MCP server's write path
- Wire the Director agent (`sub_agents=[...]`) to route intake requests
  vs. compliance requests correctly
- Validate: upload a real script PDF, confirm scenes land correctly,
  confirm ComplianceAgent can still check them

## Phase C — RAG Grounding
**Goal:** ground continuity/precedent answers in real data.
- Set up BigQuery Vector Search, embed script text on intake
  (`script_embeddings`)
- Embed compliance history on every check (`compliance_history_embeddings`)
- Give `ComplianceAgent` and `ScriptIntakeAgent` a grounded-query tool
  against these tables

## Phase D — GenMedia: Storyboard + Audio
**Goal:** first creative-generation agents, async job pattern established.
- Build `StoryboardAgent` (Imagen 3) with an async job status pattern in
  the API Gateway (generate → poll → asset saved to Cloud Storage →
  `media_assets` row)
- Build `AudioAgent` for mood music (Lyria 3), same async pattern
- Add dialogue reference reads (Gemini TTS) to `AudioAgent`
- This phase is a good place to start the frontend in parallel (Phase F)
  since these are the screens most worth showing visually

## Phase E — Live Rehearsal
**Goal:** the highest-complexity integration, isolated so it doesn't
block anything else if it slips.
- Build `RehearsalAgent` against the Gemini Live API, WebSocket gateway
  in the API layer
- `rehearsal_sessions` table, transcript storage
- This is the one piece worth prototyping standalone before wiring into
  the Director — bidirectional audio has enough of its own complexity
  that it shouldn't be debugged through the orchestration layer too

## Phase F — Dailies
**Goal:** video ingestion, lowest priority creatively but straightforward
technically given Phase A-C's infra is already in place.
- `DailiesAgent`: video upload → transcription/captioning →
  sentiment-vs-script comparison
- `dailies` table, Cloud Storage video handling

## Phase G — Frontend Build-Out
**Goal:** the full UI per the UX Brief, built incrementally as backend
phases land rather than all at once at the end.
- Start with Dashboard + Schedule + Scene Detail/Compliance tab as soon
  as Phase A's data layer is real (don't wait for later phases)
- Add Storyboard/Audio tabs when Phase D lands
- Add Rehearsal Room when Phase E lands
- Add Dailies review when Phase F lands
- Admin screens (rules editor, audit log, user management) last —
  needed for a real deployment, not for a demo

## Phase H — Observability & Polish
- Extend the existing Grafana dashboard with system-health panels
  (agent latency, generation job failure rate) alongside the v1
  compliance panel
- Full audit-log review, override-flow testing
- Load/latency pass on the compliance gate specifically — it's the one
  path that must never regress in speed or correctness as everything
  else gets added around it

## Sequencing Notes

- **Compliance stays the spine.** Every phase after A should be checked
  against "does this change how ComplianceAgent behaves or how fast it
  responds?" — if yes, stop and fix before continuing. It's the one
  agent with zero tolerance for regression.
- **MCP server first, always.** Every new agent and every new frontend
  screen should read/write through it, not around it — that's what
  makes Phase A worth doing instead of skipping straight to features.
- Phases D, E, and F are largely independent of each other once Phase C
  is done — they can run in parallel if more than one person is
  building this.
