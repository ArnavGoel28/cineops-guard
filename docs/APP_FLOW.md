# CineOps Guard — App Flow

## Flow 1: Script Intake → Structured Schedule

1. Screenwriter/AD uploads a script PDF on the **Script Intake** screen
2. `script` row created, status `uploaded`; PDF lands in Cloud Storage
3. Director agent routes to `ScriptIntakeAgent`
4. `ScriptIntakeAgent` calls `parse_script_pdf` → extracts scenes,
   characters, locations, stunt flags
5. For each extracted scene, a `scenes` row is written via the MCP
   server's write path; script text is chunked and embedded into
   `script_embeddings`
6. Status flips to `parsed`; user is redirected to the **Schedule**
   view showing the newly created scenes, all in `gray` (not yet
   checked) status

## Flow 2: Scene Compliance Check (the v1 core, now MCP-backed)

1. User opens a scene's **Compliance tab**, or the Director agent is
   asked directly ("can we shoot SC-014 tomorrow?")
2. Director routes to `ComplianceAgent`
3. `ComplianceAgent` is forced (before_model_callback) to call
   `check_safety_compliance`, which now reads scene + rules data via
   the MCP server instead of local JSON
4. Result written to `compliance_checks` (append-only), pushed to
   Grafana as an annotation
5. UI shows APPROVED (green) or BLOCKED (red, with violation list) —
   updates the Dashboard's scene-status counts in real time

## Flow 3: Human Override

1. A Safety Lead reviews a `BLOCKED` scene and disagrees, or the
   underlying issue gets resolved off-system (e.g., a medic is
   confirmed by phone)
2. They use the explicit **Override** control on the Compliance tab —
   required to type a reason
3. New `compliance_checks` row inserted with `overridden_by_user_id`
   and `override_reason` set — the original blocked check is never
   edited or deleted
4. Grafana annotation logged for the override too, tagged distinctly
   from an agent-issued approval, so the audit trail shows a human
   made this call, not the agent

## Flow 4: Storyboard Generation

1. Director/DP opens a scene's **Storyboard tab**, requests panels
   ("generate storyboard for the rooftop leap, day-for-night lighting")
2. Director routes to `StoryboardAgent`, which calls Imagen 3
   asynchronously
3. UI shows a generating state (loading messages, not a bare spinner);
   API Gateway polls the job
4. Panels land in Cloud Storage, `media_assets` rows created,
   `approved = false`
5. DP reviews, clicks **Approve** on the panels they want — only
   approved assets show as "locked in" on the scene summary; others
   stay visible but marked unapproved
6. DP can request regeneration with new style notes — creates new
   `media_assets` rows rather than overwriting

## Flow 5: Mood Music + Dialogue Reference

1. Sound department opens a scene's **Audio tab**
2. Requests mood music → `AudioAgent` calls Lyria 3 → async job → clip
   saved, `media_assets` row (`type = mood_music`)
3. Requests a dialogue reference read → `AudioAgent` pulls the scene's
   dialogue lines (grounded from `script_embeddings`), calls Gemini TTS
   multi-speaker → clip saved (`type = dialogue_read`)
4. Both are playable inline in the Audio tab; same approve/regenerate
   pattern as storyboards

## Flow 6: Actor Rehearsal (Live Session)

1. Actor opens **Rehearsal Room**, selects a scene, starts a session
2. Frontend opens a WebSocket to the API Gateway, which proxies to the
   Gemini Live API session for `RehearsalAgent`
3. Actor speaks lines; agent voices the scene partner in real time;
   live transcript panel updates as the session runs
4. On session end: transcript saved to Cloud Storage, `rehearsal_sessions`
   row created with `transcript_uri` and an agent-generated summary
   (pacing notes, missed cues)
5. Actor can review past sessions from the session list

## Flow 7: Dailies Review

1. Editor/reviewer uploads a raw video clip on the **Dailies** screen,
   tagged to a scene
2. `DailiesAgent` runs transcription + captioning; result stored in
   `dailies.transcript` / `captions_uri`
3. `DailiesAgent` compares delivered dialogue tone (from the video)
   against the script's intended tone (grounded from
   `script_embeddings`) and writes `sentiment_flags` for any mismatch
4. Reviewer opens the clip: transcript scrolls alongside video, flagged
   mismatches highlighted inline at their timestamp

## Flow 8: Daily Dashboard Check-In (the "morning glance")

1. Production lead opens **Dashboard**
2. Sees: scene status counts (approved/blocked/pending) for the next
   shoot day, the embedded live Grafana compliance panel, and a recent
   agent-activity feed (checks, generations, overrides — whatever
   happened since they last looked)
3. Clicks into any blocked scene directly from the count — one click
   from "something's wrong" to "here's exactly what and why"
