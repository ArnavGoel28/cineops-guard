"""Pydantic models for MCP server request/response validation."""

from __future__ import annotations

from datetime import datetime, date
from typing import List, Optional, Any
from pydantic import BaseModel


# ─── Safety Rules ───────────────────────────────────────────────────
class SafetyRuleOut(BaseModel):
    stunt_type: str
    requires_stunt_coordinator: bool
    requires_medic_onset: bool
    max_wind_speed_kmh: float
    min_crew_signoffs: int
    required_equipment: List[str]

    model_config = {"from_attributes": True}


# ─── Scenes ─────────────────────────────────────────────────────────
class DialogueTurn(BaseModel):
    id: Optional[str] = None
    speaker: str
    text: str
    pause_hint: Optional[str] = None
    gender: Optional[str] = None  # "male", "female", or "neutral"


class SceneOut(BaseModel):
    id: str
    production_id: str
    script_id: Optional[str]
    scene_number: str
    header: Optional[str] = ""
    description: str
    stunt_type: str
    location: str
    shoot_date: Optional[date]
    forecast_wind_kmh: Optional[float]
    stunt_coordinator_assigned: bool
    medic_onset: bool
    crew_signoffs: int
    equipment_confirmed: List[str]
    characters: List[str] = []
    dialogue_script: List[Any] = []
    created_at: datetime
    latest_compliance_status: Optional[str] = None  # joined field

    model_config = {"from_attributes": True}


class SceneCreate(BaseModel):
    production_id: str
    script_id: Optional[str] = None
    scene_number: str
    header: Optional[str] = ""
    description: str = ""
    stunt_type: str = "practical_effect"
    location: str = ""
    shoot_date: Optional[date] = None
    forecast_wind_kmh: Optional[float] = None
    stunt_coordinator_assigned: bool = False
    medic_onset: bool = False
    crew_signoffs: int = 0
    equipment_confirmed: List[str] = []
    characters: List[str] = []
    dialogue_script: List[Any] = []


# ─── Actor Profiles ──────────────────────────────────────────────────
class ActorProfileOut(BaseModel):
    id: str
    production_id: str
    character_name: str
    actor_name: str = "Unassigned"
    bio_notes: Optional[str] = ""
    assigned_scene_ids: List[str] = []
    dialogues_by_scene: dict = {}
    rehearsal_stats: dict = {}
    created_at: datetime

    model_config = {"from_attributes": True}


class ActorProfileCreate(BaseModel):
    production_id: str
    character_name: str
    actor_name: str = "Unassigned"
    bio_notes: Optional[str] = ""
    assigned_scene_ids: List[str] = []
    dialogues_by_scene: dict = {}
    rehearsal_stats: dict = {}


# ─── Compliance Checks ──────────────────────────────────────────────
class ComplianceCheckOut(BaseModel):
    id: str
    scene_id: str
    status: str
    violations: List[str]
    checked_by_agent: str
    grafana_pushed: bool
    overridden_by_user_id: Optional[str]
    override_reason: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class ComplianceCheckCreate(BaseModel):
    scene_id: str
    status: str  # "approved" | "blocked"
    violations: List[str] = []
    checked_by_agent: str
    grafana_pushed: bool = False
    overridden_by_user_id: Optional[str] = None
    override_reason: Optional[str] = None


class OverrideRequest(BaseModel):
    user_id: str
    reason: str  # required — no silent overrides


# ─── Scripts ────────────────────────────────────────────────────────
class ScriptOut(BaseModel):
    id: str
    production_id: str
    source_pdf_uri: Optional[str]
    parsed_at: Optional[datetime]
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ScriptCreate(BaseModel):
    production_id: str
    source_pdf_uri: Optional[str] = None


class ScriptStatusUpdate(BaseModel):
    status: str  # "uploading" | "parsing" | "parsed" | "failed"
    parsed_at: Optional[datetime] = None


# ─── Media Assets ───────────────────────────────────────────────────
class MediaAssetOut(BaseModel):
    id: str
    scene_id: str
    type: str
    storage_uri: str
    generated_by_agent: str
    prompt_used: Optional[str]
    approved: bool
    approved_by_user_id: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class MediaAssetCreate(BaseModel):
    scene_id: str
    type: str  # "storyboard_panel" | "mood_music" | "dialogue_read"
    storage_uri: str
    generated_by_agent: str
    prompt_used: Optional[str] = None


class ApproveAssetRequest(BaseModel):
    user_id: str


# ─── Rehearsal Sessions ─────────────────────────────────────────────
class RehearsalSessionOut(BaseModel):
    id: str
    scene_id: str
    actor_id: str
    transcript_uri: Optional[str]
    summary: Optional[str]
    started_at: datetime
    ended_at: Optional[datetime]

    model_config = {"from_attributes": True}


class RehearsalSessionCreate(BaseModel):
    scene_id: str
    actor_id: str


class RehearsalSessionEnd(BaseModel):
    transcript_uri: Optional[str] = None
    summary: Optional[str] = None


# ─── Dailies ────────────────────────────────────────────────────────
class DailiesOut(BaseModel):
    id: str
    scene_id: str
    video_uri: str
    transcript: Optional[Any] = None
    captions_uri: Optional[str] = None
    sentiment_flags: Optional[Any] = None
    caption_metadata: Optional[Any] = None
    safety_hazard_flags: Optional[Any] = None
    vfx_concept_uris: Optional[List[str]] = None
    score_audio_uri: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DailiesCreate(BaseModel):
    scene_id: str
    video_uri: str


class DailiesUpdate(BaseModel):
    transcript: Optional[Any] = None
    captions_uri: Optional[str] = None
    sentiment_flags: Optional[Any] = None
    caption_metadata: Optional[Any] = None
    safety_hazard_flags: Optional[Any] = None
    vfx_concept_uris: Optional[List[str]] = None
    score_audio_uri: Optional[str] = None


# ─── Productions ────────────────────────────────────────────────────
class ProductionOut(BaseModel):
    id: str
    name: str
    owner_id: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class ProductionCreate(BaseModel):
    name: str
    owner_id: Optional[str] = None


class SafetyRuleCreate(BaseModel):
    stunt_type: str
    requires_stunt_coordinator: bool = True
    requires_medic_onset: bool = False
    max_wind_speed_kmh: float = 30.0
    min_crew_signoffs: int = 1
    required_equipment: List[str] = []


class SceneUpdate(BaseModel):
    scene_number: Optional[str] = None
    header: Optional[str] = None
    description: Optional[str] = None
    stunt_type: Optional[str] = None
    location: Optional[str] = None
    shoot_date: Optional[date] = None
    forecast_wind_kmh: Optional[float] = None
    stunt_coordinator_assigned: Optional[bool] = None
    medic_onset: Optional[bool] = None
    crew_signoffs: Optional[int] = None
    equipment_confirmed: Optional[List[str]] = None


class ProductionUpdate(BaseModel):
    name: Optional[str] = None
    owner_id: Optional[str] = None


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: str
    display_name: str
    role: str = "ad"


class UserUpdate(BaseModel):
    email: Optional[str] = None
    display_name: Optional[str] = None
    role: Optional[str] = None


# ─── Box Office & ROI ML Prediction Models ──────────────────────────
class BoxOfficePredictionRequest(BaseModel):
    budget: float = 50000000.0
    release_month: int = 6
    genres: List[str] = ["Action", "Adventure"]
    runtime: int = 110
    is_franchise: bool = False
    has_homepage: bool = True
    stunt_count: int = 2
    has_high_impact_stunt: bool = True
    director_tier: str = "mid_tier"  # top_tier, mid_tier, indie, debut
    lead_cast_tier: str = "established"  # superstar, established, rising, unknown
    production_company_tier: str = "major_studio"  # major_studio, mid_major, indie
    script_overview: str = ""

