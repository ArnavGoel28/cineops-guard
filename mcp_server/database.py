"""
SQLAlchemy ORM models for CineOps Guard.

DATABASE_URL env var controls the backend:
  sqlite+aiosqlite:///./cineops.db   — local dev (default)
  postgresql+asyncpg://...           — Cloud SQL (production)

All tables mirror db/schema.sql exactly.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, date
from typing import List, Optional

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Enum, Float, Integer,
    String, Text, ForeignKey, JSON, ARRAY, func, select, text
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, ARRAY as PG_ARRAY
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "cineops.db").replace("\\", "/")
DEFAULT_DB_URL = f"sqlite+aiosqlite:///{DB_PATH}"

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    DEFAULT_DB_URL
)

# SQLite doesn't support ARRAY or UUID natively — use Text as fallback
IS_POSTGRES = DATABASE_URL.startswith("postgresql")


def _uuid_col(primary_key=False, fk=None):
    """Create a UUID column, using native UUID on Postgres, Text on SQLite."""
    if IS_POSTGRES:
        col_type = PG_UUID(as_uuid=True)
    else:
        col_type = String(36)

    if fk:
        return Column(col_type, ForeignKey(fk), primary_key=primary_key)
    return Column(col_type, primary_key=primary_key, default=lambda: str(uuid.uuid4()))


def _array_col(nullable=False):
    """Text-based array column (JSON array string on SQLite, TEXT[] on Postgres)."""
    return Column(JSON, nullable=nullable, default=list)


engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, nullable=False)
    display_name = Column(String, nullable=False)
    role = Column(
        Enum("safety_lead", "ad", "director", "actor", "sound", "admin", name="user_role"),
        nullable=False, default="ad"
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Production(Base):
    __tablename__ = "productions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    owner_id = Column(String(36), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    scenes = relationship("Scene", back_populates="production", lazy="select", cascade="all, delete-orphan")
    scripts = relationship("Script", back_populates="production", lazy="select", cascade="all, delete-orphan")


class Script(Base):
    __tablename__ = "scripts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    production_id = Column(String(36), ForeignKey("productions.id"), nullable=False)
    source_pdf_uri = Column(String)
    parsed_at = Column(DateTime(timezone=True))
    status = Column(
        Enum("uploaded", "parsing", "parsed", "failed", name="script_status"),
        nullable=False, default="uploaded"
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    production = relationship("Production", back_populates="scripts")


class SafetyRule(Base):
    __tablename__ = "safety_rules"

    stunt_type = Column(String, primary_key=True)
    requires_stunt_coordinator = Column(Boolean, nullable=False, default=False)
    requires_medic_onset = Column(Boolean, nullable=False, default=False)
    max_wind_speed_kmh = Column(Float, nullable=False, default=100.0)
    min_crew_signoffs = Column(Integer, nullable=False, default=0)
    required_equipment = Column(JSON, nullable=False, default=list)


class Scene(Base):
    __tablename__ = "scenes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    production_id = Column(String(36), ForeignKey("productions.id"), nullable=False)
    script_id = Column(String(36), ForeignKey("scripts.id"))
    scene_number = Column(String, nullable=False)
    header = Column(String, default="")
    description = Column(Text, default="")
    stunt_type = Column(String, default="practical_effect")
    location = Column(String, default="")
    shoot_date = Column(Date)
    forecast_wind_kmh = Column(Float)
    stunt_coordinator_assigned = Column(Boolean, default=False)
    medic_onset = Column(Boolean, default=False)
    crew_signoffs = Column(Integer, default=0)
    equipment_confirmed = Column(JSON, default=list)
    characters = Column(JSON, default=list)
    dialogue_script = Column(JSON, default=list)
    risk_rating = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    production = relationship("Production", back_populates="scenes")
    compliance_checks = relationship(
        "ComplianceCheck", back_populates="scene",
        order_by="ComplianceCheck.created_at.desc()", lazy="select",
        cascade="all, delete-orphan"
    )
    safety_budgets = relationship("SafetyBudget", back_populates="scene", cascade="all, delete-orphan")
    media_assets = relationship("MediaAsset", back_populates="scene", cascade="all, delete-orphan")


class SafetyBudget(Base):
    __tablename__ = "safety_budgets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scene_id = Column(String(36), ForeignKey("scenes.id"), nullable=False)
    category = Column(String, nullable=False)
    allocated_amount = Column(Float, nullable=False)
    spent_amount = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    scene = relationship("Scene", back_populates="safety_budgets")


class ActorProfile(Base):
    __tablename__ = "actor_profiles"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    production_id = Column(String(36), ForeignKey("productions.id"), nullable=False)
    character_name = Column(String, nullable=False)
    actor_name = Column(String, default="Unassigned")
    bio_notes = Column(Text, default="")
    assigned_scene_ids = Column(JSON, default=list)
    dialogues_by_scene = Column(JSON, default=dict)
    rehearsal_stats = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ComplianceCheck(Base):
    __tablename__ = "compliance_checks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scene_id = Column(String(36), ForeignKey("scenes.id"), nullable=False)
    status = Column(
        Enum("approved", "blocked", name="compliance_status"), nullable=False
    )
    violations = Column(JSON, default=list)
    checked_by_agent = Column(String, nullable=False)
    grafana_pushed = Column(Boolean, default=False)
    overridden_by_user_id = Column(String(36), ForeignKey("users.id"))
    override_reason = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    scene = relationship("Scene", back_populates="compliance_checks")


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scene_id = Column(String(36), ForeignKey("scenes.id"), nullable=False)
    type = Column(
        Enum("storyboard_panel", "mood_music", "dialogue_read", name="asset_type"),
        nullable=False
    )
    storage_uri = Column(String, nullable=False)
    generated_by_agent = Column(String, nullable=False)
    prompt_used = Column(Text)
    approved = Column(Boolean, default=False)
    approved_by_user_id = Column(String(36), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    scene = relationship("Scene", back_populates="media_assets")


class RehearsalSession(Base):
    __tablename__ = "rehearsal_sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scene_id = Column(String(36), ForeignKey("scenes.id"), nullable=False)
    actor_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    transcript_uri = Column(String)
    summary = Column(Text)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True))


class Dailies(Base):
    __tablename__ = "dailies"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scene_id = Column(String(36), ForeignKey("scenes.id"), nullable=False)
    video_uri = Column(String, nullable=False)
    transcript = Column(JSON)
    captions_uri = Column(String)
    sentiment_flags = Column(JSON)
    caption_metadata = Column(JSON)
    safety_hazard_flags = Column(JSON)
    vfx_concept_uris = Column(JSON, default=list)
    score_audio_uri = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


async def init_db():
    """Create all tables (idempotent) and seed sample Dailies data if empty."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Auto-migrate SQLite schema if columns were added after initial table creation
        for col, col_type in [
            ("caption_metadata", "JSON"),
            ("safety_hazard_flags", "JSON"),
            ("vfx_concept_uris", "JSON"),
            ("score_audio_uri", "TEXT"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE dailies ADD COLUMN {col} {col_type}"))
            except Exception:
                pass

        for col, col_type in [
            ("risk_rating", "TEXT"),
            ("header", "TEXT"),
            ("description", "TEXT"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE scenes ADD COLUMN {col} {col_type}"))
            except Exception:
                pass

    async with AsyncSession(engine) as db:
        try:
            result = await db.execute(select(Dailies))
            if not result.scalars().first():
                p_res = await db.execute(select(Production))
                prod = p_res.scalars().first()
                if not prod:
                    prod = Production(id="prod-001", name="OPERATION AGNI (2026 Production)")
                    db.add(prod)
                    await db.commit()
                    await db.refresh(prod)

                s_res = await db.execute(select(Scene))
                scene = s_res.scalars().first()
                if not scene:
                    scene = Scene(
                        id="SC-014",
                        production_id=prod.id,
                        scene_number="SC-014",
                        header="EXT. JAIPUR HIGHWAY - NIGHT",
                        description="High-speed motorcycle chase sequence through narrow crowded bazaar.",
                        stunt_type="vehicle_chase",
                        location="highway",
                        risk_rating="High"
                    )
                    db.add(scene)
                    await db.commit()
                    await db.refresh(scene)

                d1 = Dailies(
                    id="dailies-sample-01",
                    scene_id=scene.id,
                    video_uri="http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
                    transcript=[
                        {"timestamp": "0:02", "speaker": "VIKRAM", "text": "Move! We've got 90 seconds before Metro PD locks down!"},
                        {"timestamp": "0:08", "speaker": "PRIYA", "text": "Main vault doors are sealed! Plant the charge!"},
                        {"timestamp": "0:15", "speaker": "VIKRAM", "text": "Hold on tight! LEAP!"}
                    ],
                    caption_metadata={
                        "summary": "Vault breaching sequence inside high-tech bank interior. Fast-paced tracking camera with practical smoke effects.",
                        "camera_techniques": ["Handheld Tracking Shot", "Dynamic Zoom-In"],
                        "lighting": "High-contrast emergency strobe lighting with blue lens flare",
                        "tags": ["Action", "Stunt", "Vault Breach", "Pyrotechnic"],
                        "director_take_score": 92
                    },
                    safety_hazard_flags=[
                        {
                            "timestamp": "0:12",
                            "hazard": "Practical smoke density near breach zone approaching visibility threshold",
                            "severity": "medium",
                            "recommended_action": "Ensure active ventilation on set before Take 2"
                        }
                    ],
                    sentiment_flags=[
                        {
                            "timestamp": "0:08",
                            "script_tone": "High Panic & Urgency",
                            "delivered_tone": "Measured & Calm",
                            "severity": "medium"
                        }
                    ],
                    vfx_concept_uris=["http://localhost:8080/media/vfx_sample1.png"],
                    score_audio_uri="http://localhost:8080/media/score_sample1.mp3"
                )
                db.add(d1)
                await db.commit()
        except Exception as seed_err:
            print(f"[init_db] Seed notice: {seed_err}")

