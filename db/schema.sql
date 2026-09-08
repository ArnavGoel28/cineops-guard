-- CineOps Guard — Postgres DDL
-- Run once against a fresh Cloud SQL (Postgres) instance.
-- All IDs are UUIDs. Timestamps are timestamptz (UTC).
-- compliance_checks is append-only — never UPDATE a row there.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────
-- USERS & AUTH
-- ─────────────────────────────────────────
CREATE TYPE user_role AS ENUM (
    'safety_lead', 'ad', 'director', 'actor', 'sound', 'admin'
);

CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role         user_role NOT NULL DEFAULT 'ad',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PRODUCTIONS
-- ─────────────────────────────────────────
CREATE TABLE productions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    owner_id   UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- SCRIPTS (uploaded PDF state machine)
-- ─────────────────────────────────────────
CREATE TYPE script_status AS ENUM ('uploaded', 'parsing', 'parsed', 'failed');

CREATE TABLE scripts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_id  UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    source_pdf_uri TEXT,
    parsed_at      TIMESTAMPTZ,
    status         script_status NOT NULL DEFAULT 'uploaded',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- SAFETY RULES  (seeded from safety_rules.json, editable by Admin)
-- ─────────────────────────────────────────
CREATE TABLE safety_rules (
    stunt_type                TEXT PRIMARY KEY,
    requires_stunt_coordinator BOOLEAN NOT NULL DEFAULT FALSE,
    requires_medic_onset       BOOLEAN NOT NULL DEFAULT FALSE,
    max_wind_speed_kmh         NUMERIC NOT NULL DEFAULT 100,
    min_crew_signoffs          INTEGER NOT NULL DEFAULT 0,
    required_equipment         TEXT[]  NOT NULL DEFAULT '{}'
);

-- ─────────────────────────────────────────
-- SCENES
-- ─────────────────────────────────────────
CREATE TABLE scenes (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_id               UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
    script_id                   UUID REFERENCES scripts(id),
    scene_number                TEXT NOT NULL,
    description                 TEXT NOT NULL DEFAULT '',
    stunt_type                  TEXT NOT NULL REFERENCES safety_rules(stunt_type) DEFAULT 'none',
    location                    TEXT NOT NULL DEFAULT '',
    shoot_date                  DATE,
    forecast_wind_kmh           NUMERIC,
    stunt_coordinator_assigned  BOOLEAN NOT NULL DEFAULT FALSE,
    medic_onset                 BOOLEAN NOT NULL DEFAULT FALSE,
    crew_signoffs               INTEGER NOT NULL DEFAULT 0,
    equipment_confirmed         TEXT[] NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (production_id, scene_number)
);

-- ─────────────────────────────────────────
-- COMPLIANCE CHECKS  (append-only — never UPDATE)
-- ─────────────────────────────────────────
CREATE TYPE compliance_status AS ENUM ('approved', 'blocked');

CREATE TABLE compliance_checks (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id             UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    status               compliance_status NOT NULL,
    violations           TEXT[] NOT NULL DEFAULT '{}',
    checked_by_agent     TEXT NOT NULL,
    grafana_pushed       BOOLEAN NOT NULL DEFAULT FALSE,
    overridden_by_user_id UUID REFERENCES users(id),
    override_reason      TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast "latest check per scene" queries
CREATE INDEX idx_compliance_scene_time ON compliance_checks (scene_id, created_at DESC);

-- ─────────────────────────────────────────
-- MEDIA ASSETS (storyboard panels, music, dialogue reads)
-- ─────────────────────────────────────────
CREATE TYPE asset_type AS ENUM ('storyboard_panel', 'mood_music', 'dialogue_read');

CREATE TABLE media_assets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id            UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    type                asset_type NOT NULL,
    storage_uri         TEXT NOT NULL,
    generated_by_agent  TEXT NOT NULL,
    prompt_used         TEXT,
    approved            BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by_user_id UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_scene_type ON media_assets (scene_id, type);

-- ─────────────────────────────────────────
-- REHEARSAL SESSIONS
-- ─────────────────────────────────────────
CREATE TABLE rehearsal_sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id       UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    actor_id       UUID NOT NULL REFERENCES users(id),
    transcript_uri TEXT,
    summary        TEXT,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at       TIMESTAMPTZ
);

-- ─────────────────────────────────────────
-- DAILIES
-- ─────────────────────────────────────────
CREATE TABLE dailies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id        UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    video_uri       TEXT NOT NULL,
    transcript      JSONB,
    captions_uri    TEXT,
    sentiment_flags JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
