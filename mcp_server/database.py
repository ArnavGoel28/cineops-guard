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
    String, Text, ForeignKey, JSON, ARRAY, func
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, ARRAY as PG_ARRAY
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite+aiosqlite:///./cineops.db"
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    production = relationship("Production", back_populates="scenes")
    compliance_checks = relationship(
        "ComplianceCheck", back_populates="scene",
        order_by="ComplianceCheck.created_at.desc()", lazy="select",
        cascade="all, delete-orphan"
    )
    media_assets = relationship("MediaAsset", back_populates="scene", lazy="select", cascade="all, delete-orphan")


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
    created_at = Column(DateTime(timezone=True), server_default=func.now())


async def init_db():
    """Create all tables (idempotent). Call on startup."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
