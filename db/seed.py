"""
CineOps Guard — DB Seed Script

Migrates the existing v1 JSON data (safety_rules.json + schedule.json) into
Postgres/SQLite via the ORM, creating a demo production and demo users.

Run once:
    python -m db.seed

Idempotent — safe to re-run; existing rows are skipped.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import date
from pathlib import Path

# Ensure project root is on the path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mcp_server.database import (
    AsyncSessionLocal, init_db,
    User, Production, SafetyRule, Scene,
)

DATA_DIR = Path(__file__).parent.parent / "agent" / "data"


async def seed_safety_rules(db: AsyncSession) -> None:
    with open(DATA_DIR / "safety_rules.json") as f:
        data = json.load(f)["stunt_types"]

    for stunt_type, rule in data.items():
        existing = await db.get(SafetyRule, stunt_type)
        if existing:
            print(f"  safety_rules: '{stunt_type}' already exists — skipping")
            continue
        db.add(SafetyRule(
            stunt_type=stunt_type,
            requires_stunt_coordinator=rule["requires_stunt_coordinator"],
            requires_medic_onset=rule["requires_medic_onset"],
            max_wind_speed_kmh=rule["max_wind_speed_kmh"],
            min_crew_signoffs=rule["min_crew_signoffs"],
            required_equipment=rule["required_equipment"],
        ))
        print(f"  safety_rules: inserted '{stunt_type}'")

    await db.commit()


async def seed_demo_users(db: AsyncSession) -> dict:
    """Create one demo user per role. Returns dict of role→user_id."""
    demo_users = [
        {"email": "safety@demo.cineops", "display_name": "Alex (Safety Lead)", "role": "safety_lead"},
        {"email": "ad@demo.cineops",     "display_name": "Jordan (1st AD)",     "role": "ad"},
        {"email": "dir@demo.cineops",    "display_name": "Morgan (Director)",   "role": "director"},
        {"email": "actor@demo.cineops",  "display_name": "Riley (Actor)",       "role": "actor"},
        {"email": "sound@demo.cineops",  "display_name": "Sam (Sound)",         "role": "sound"},
        {"email": "admin@demo.cineops",  "display_name": "Dana (Admin)",        "role": "admin"},
    ]
    role_map = {}
    for u in demo_users:
        result = await db.execute(select(User).where(User.email == u["email"]))
        existing = result.scalars().first()
        if existing:
            print(f"  users: '{u['email']}' already exists — skipping")
            role_map[u["role"]] = existing.id
            continue
        user = User(**u)
        db.add(user)
        await db.flush()  # get ID before commit
        role_map[u["role"]] = user.id
        print(f"  users: inserted '{u['display_name']}' ({u['role']})")

    await db.commit()
    return role_map


async def seed_production(db: AsyncSession, owner_id: str) -> str:
    result = await db.execute(select(Production).where(Production.name == "Demo Production"))
    existing = result.scalars().first()
    if existing:
        print(f"  productions: 'Demo Production' already exists — skipping")
        return existing.id

    prod = Production(name="Demo Production", owner_id=owner_id)
    db.add(prod)
    await db.flush()
    await db.commit()
    print(f"  productions: inserted 'Demo Production' (id={prod.id})")
    return prod.id


async def seed_scenes(db: AsyncSession, production_id: str) -> None:
    with open(DATA_DIR / "schedule.json") as f:
        schedule = json.load(f)

    for scene_data in schedule:
        result = await db.execute(
            select(Scene).where(
                Scene.production_id == production_id,
                Scene.scene_number == scene_data["scene_id"],
            )
        )
        existing = result.scalars().first()
        if existing:
            print(f"  scenes: '{scene_data['scene_id']}' already exists — skipping")
            continue

        shoot_date = None
        if scene_data.get("shoot_date"):
            try:
                shoot_date = date.fromisoformat(scene_data["shoot_date"])
            except ValueError:
                pass

        db.add(Scene(
            production_id=production_id,
            scene_number=scene_data["scene_id"],
            description=scene_data.get("description", ""),
            stunt_type=scene_data.get("stunt_type", "none"),
            location=scene_data.get("location", ""),
            shoot_date=shoot_date,
            forecast_wind_kmh=scene_data.get("forecast_wind_kmh"),
            stunt_coordinator_assigned=scene_data.get("stunt_coordinator_assigned", False),
            medic_onset=scene_data.get("medic_onset", False),
            crew_signoffs=scene_data.get("crew_signoffs", 0),
            equipment_confirmed=scene_data.get("equipment_confirmed", []),
        ))
        print(f"  scenes: inserted '{scene_data['scene_id']}'")

    await db.commit()


async def main():
    print("CineOps Guard — seeding database...")
    print(f"  DATABASE_URL: {os.getenv('DATABASE_URL', 'sqlite+aiosqlite:///./cineops.db')}")

    await init_db()
    print("  Tables created / verified.")

    async with AsyncSessionLocal() as db:
        print("\n[1/4] Safety Rules")
        await seed_safety_rules(db)

        print("\n[2/4] Demo Users")
        role_map = await seed_demo_users(db)

        print("\n[3/4] Demo Production")
        production_id = await seed_production(db, owner_id=role_map.get("admin", ""))

        print("\n[4/4] Scenes (from schedule.json)")
        await seed_scenes(db, production_id)

    print("\n[OK] Seed complete.")
    print(f"  Production ID: {production_id}")
    print(f"  Demo user roles: {list(role_map.keys())}")


if __name__ == "__main__":
    asyncio.run(main())
