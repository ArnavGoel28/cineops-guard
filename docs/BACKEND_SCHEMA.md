# CineOps Guard — Backend Schema

**Primary store:** Cloud SQL (Postgres) for relational/system-of-record
data. **Secondary store:** BigQuery for vector embeddings + analytics
(schema below is logical, not a literal DDL dump — adapt types to your
ORM of choice, e.g. SQLAlchemy or Prisma).

## Postgres Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| email | text, unique | |
| display_name | text | |
| role | enum('safety_lead','ad','director','actor','sound','admin') | |
| created_at | timestamptz | |

### `productions`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name | text | |
| owner_id | uuid, FK → users.id | |
| created_at | timestamptz | |

### `scripts`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| production_id | uuid, FK → productions.id | |
| source_pdf_uri | text | Cloud Storage path |
| parsed_at | timestamptz, nullable | |
| status | enum('uploaded','parsing','parsed','failed') | |

### `scenes`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| production_id | uuid, FK | |
| script_id | uuid, FK, nullable | null if manually entered |
| scene_number | text | e.g. "SC-014" |
| description | text | |
| stunt_type | text | FK-like reference into `safety_rules.stunt_type` |
| location | text | |
| shoot_date | date | |
| forecast_wind_kmh | numeric, nullable | |
| stunt_coordinator_assigned | boolean | |
| medic_onset | boolean | |
| crew_signoffs | integer | |
| equipment_confirmed | text[] | |
| created_at | timestamptz | |

### `safety_rules`
| Column | Type | Notes |
|---|---|---|
| stunt_type | text, PK | |
| requires_stunt_coordinator | boolean | |
| requires_medic_onset | boolean | |
| max_wind_speed_kmh | numeric | |
| min_crew_signoffs | integer | |
| required_equipment | text[] | |

*(Seeded from v1's `safety_rules.json`; editable via admin UI in v2 —
this is the one table where changes should require an Admin role and
get their own audit row.)*

### `compliance_checks`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| scene_id | uuid, FK | |
| status | enum('approved','blocked') | |
| violations | text[] | |
| checked_by_agent | text | which agent/session ran it |
| grafana_pushed | boolean | |
| overridden_by_user_id | uuid, FK, nullable | human override, if any |
| override_reason | text, nullable | |
| created_at | timestamptz | |

This table is append-only — never update a row, always insert a new
check. The audit trail is the point.

### `media_assets`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| scene_id | uuid, FK | |
| type | enum('storyboard_panel','mood_music','dialogue_read') | |
| storage_uri | text | Cloud Storage path |
| generated_by_agent | text | |
| prompt_used | text | for regeneration/audit |
| approved | boolean, default false | |
| approved_by_user_id | uuid, FK, nullable | |
| created_at | timestamptz | |

### `rehearsal_sessions`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| scene_id | uuid, FK | |
| actor_id | uuid, FK → users.id | |
| transcript_uri | text | Cloud Storage path (text or audio log) |
| summary | text | agent-generated self-assessment |
| started_at | timestamptz | |
| ended_at | timestamptz, nullable | |

### `dailies`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| scene_id | uuid, FK | |
| video_uri | text | Cloud Storage path |
| transcript | jsonb | timestamped transcription |
| captions_uri | text, nullable | |
| sentiment_flags | jsonb | mismatches vs. script tone |
| created_at | timestamptz | |

## BigQuery Schema (RAG / analytics)

### `script_embeddings`
| Column | Type | Notes |
|---|---|---|
| id | string | |
| production_id | string | |
| script_id | string | |
| chunk_text | string | |
| embedding | array<float64> | Gemini embedding vector |
| scene_ref | string, nullable | which scene this chunk belongs to |

### `compliance_history_embeddings`
| Column | Type | Notes |
|---|---|---|
| id | string | |
| compliance_check_id | string | mirrors Postgres `compliance_checks.id` |
| summary_text | string | e.g. "vehicle_chase blocked, missing medic, wind 22kmh" |
| embedding | array<float64> | |

Used for "has something like this happened before" queries from
`ComplianceAgent` — grounding precedent answers in real history instead
of the model guessing.

## MCP Server Resource Map

The MCP server (see TRD §2.3) exposes these as MCP tools/resources —
this is the contract every agent talks to, not a direct DB connection:

- `get_scene(scene_id)` → scene record + latest compliance status
- `list_scenes(production_id, filters)` → paginated scene list
- `get_compliance_history(scene_id | stunt_type)` → past checks
- `get_script_text(script_id, scene_ref?)` → grounded script chunks
- `list_media_assets(scene_id, type?)` → generated assets
- `write_compliance_check(...)` → the only write path compliance results go through
