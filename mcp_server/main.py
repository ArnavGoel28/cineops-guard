"""
CineOps Guard — MCP Server

This is the single data-access layer that every agent talks to.
No agent or frontend ever touches the database directly — all reads and
writes go through these endpoints. This is what makes it an MCP server
in spirit: a standard protocol/interface over production data.

Run standalone:
    uvicorn mcp_server.main:app --reload --port 8001

Endpoints follow the resource contract from BACKEND_SCHEMA.md:
    GET  /scenes/{scene_id}                   → get_scene
    GET  /scenes                              → list_scenes
    POST /scenes                              → write_scene (ScriptIntakeAgent)
    GET  /compliance-history                  → get_compliance_history
    POST /compliance-checks                   → write_compliance_check (append-only)
    POST /compliance-checks/{id}/override     → human override
    GET  /script-text/{script_id}             → get_script_text
    GET  /media-assets                        → list_media_assets
    POST /media-assets                        → write_media_asset
    POST /media-assets/{id}/approve           → approve asset
    GET  /scripts/{script_id}                 → get script metadata
    POST /scripts                             → create script record
    PATCH /scripts/{script_id}/status        → update parsing status
    POST /rehearsal-sessions                  → create session
    PATCH /rehearsal-sessions/{id}           → end session (save transcript)
    GET  /rehearsal-sessions                  → list sessions
    POST /dailies                             → create dailies record
    PATCH /dailies/{id}                      → update with transcript/sentiment
    GET  /dailies                             → list dailies
    GET  /productions                         → list productions
    POST /productions                         → create production
    GET  /safety-rules                        → list all safety rules
    PUT  /safety-rules/{stunt_type}          → update a rule (Admin only)
    GET  /health                              → health check
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Query
from sqlalchemy import select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from .database import (
    get_db, init_db,
    Scene, SafetyRule, ComplianceCheck, MediaAsset,
    Script, RehearsalSession, Dailies, Production, User, ActorProfile,
)
from .models import (
    SceneOut, SceneCreate, SceneUpdate,
    SafetyRuleOut, SafetyRuleCreate,
    ComplianceCheckOut, ComplianceCheckCreate, OverrideRequest,
    MediaAssetOut, MediaAssetCreate, ApproveAssetRequest,
    ScriptOut, ScriptCreate, ScriptStatusUpdate,
    RehearsalSessionOut, RehearsalSessionCreate, RehearsalSessionEnd,
    DailiesOut, DailiesCreate, DailiesUpdate,
    ProductionOut, ProductionCreate, ProductionUpdate,
    UserOut, UserCreate, UserUpdate,
    ActorProfileOut, ActorProfileCreate,
    BoxOfficePredictionRequest,
)
from agent.ml.boxoffice_model import boxoffice_predictor
from agent.ml.feature_extractor import MoviePredictionInput


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="CineOps Guard — MCP Server",
    description="The single data-access layer for all CineOps Guard agents.",
    version="2.0.0",
    lifespan=lifespan,
)


# ─────────────────────────────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "mcp-server"}


# ─────────────────────────────────────────────────────────────────────
# PRODUCTIONS
# ─────────────────────────────────────────────────────────────────────
@app.get("/productions", response_model=List[ProductionOut])
async def list_productions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Production).order_by(desc(Production.created_at)))
    return result.scalars().all()


@app.post("/productions", response_model=ProductionOut, status_code=201)
async def create_production(body: ProductionCreate, db: AsyncSession = Depends(get_db)):
    prod_data = body.model_dump(exclude_unset=True)
    prod = Production(**prod_data)
    db.add(prod)
    await db.commit()
    await db.refresh(prod)
    return prod


@app.put("/productions/{id}", response_model=ProductionOut)
async def update_production(id: str, body: ProductionUpdate, db: AsyncSession = Depends(get_db)):
    prod = await db.get(Production, id)
    if not prod:
        raise HTTPException(404, f"Production '{id}' not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(prod, k, v)
    await db.commit()
    await db.refresh(prod)
    return prod


@app.delete("/productions/{id}")
async def delete_production(id: str, db: AsyncSession = Depends(get_db)):
    prod = await db.get(Production, id)
    if not prod:
        raise HTTPException(404, f"Production '{id}' not found")

    # Delete scenes and associated compliance checks/media assets
    scenes_res = await db.execute(select(Scene).where(Scene.production_id == id))
    for sc in scenes_res.scalars().all():
        checks = await db.execute(select(ComplianceCheck).where((ComplianceCheck.scene_id == sc.id) | (ComplianceCheck.scene_id == sc.scene_number)))
        for chk in checks.scalars().all():
            await db.delete(chk)
        assets = await db.execute(select(MediaAsset).where(MediaAsset.scene_id == sc.id))
        for ast in assets.scalars().all():
            await db.delete(ast)
        await db.delete(sc)

    # Delete scripts
    scripts_res = await db.execute(select(Script).where(Script.production_id == id))
    for s in scripts_res.scalars().all():
        await db.delete(s)

    await db.delete(prod)
    await db.commit()
    return {"status": "deleted", "id": id}


# ─────────────────────────────────────────────────────────────────────
# SCENES  — get_scene / list_scenes / write_scene
# ─────────────────────────────────────────────────────────────────────
@app.get("/scenes/{scene_id}", response_model=SceneOut)
async def get_scene(scene_id: str, db: AsyncSession = Depends(get_db)):
    scene = await db.get(Scene, scene_id)
    if not scene:
        # Try by scene_number or header (case-insensitive)
        result = await db.execute(select(Scene).where(or_(Scene.scene_number.ilike(scene_id), Scene.header.ilike(f"%{scene_id}%"))))
        scene = result.scalars().first()
    if not scene:
        # Try by matching description text
        result = await db.execute(select(Scene).where(Scene.description.ilike(f"%{scene_id}%")))
        scene = result.scalars().first()
    if not scene:
        # Try by matching location
        result = await db.execute(select(Scene).where(Scene.location.ilike(f"%{scene_id}%")))
        scene = result.scalars().first()

    if not scene:
        raise HTTPException(404, f"Scene '{scene_id}' not found")

    out = SceneOut.model_validate(scene)

    # Attach latest compliance status
    checks = await db.execute(
        select(ComplianceCheck)
        .where(ComplianceCheck.scene_id == scene.id)
        .order_by(desc(ComplianceCheck.created_at))
        .limit(1)
    )
    latest = checks.scalars().first()
    if latest:
        out.latest_compliance_status = latest.status
    return out


@app.get("/scenes", response_model=List[SceneOut])
async def list_scenes(
    production_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    shoot_date: Optional[str] = Query(None),
    stunt_type: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    q = select(Scene)
    if production_id:
        q = q.where(Scene.production_id == production_id)
    if stunt_type:
        q = q.where(Scene.stunt_type == stunt_type)
    if shoot_date:
        q = q.where(Scene.shoot_date == shoot_date)
    q = q.order_by(Scene.scene_number).offset(offset).limit(limit)

    result = await db.execute(q)
    scenes = result.scalars().all()

    # Attach latest compliance status to each
    out_list = []
    for scene in scenes:
        out = SceneOut.model_validate(scene)
        checks = await db.execute(
            select(ComplianceCheck)
            .where(ComplianceCheck.scene_id == scene.id)
            .order_by(desc(ComplianceCheck.created_at))
            .limit(1)
        )
        latest = checks.scalars().first()
        if latest:
            out.latest_compliance_status = latest.status
        out_list.append(out)

    return out_list


@app.post("/scenes", response_model=SceneOut, status_code=201)
async def create_scene(body: SceneCreate, db: AsyncSession = Depends(get_db)):
    scene = Scene(**body.model_dump())
    db.add(scene)
    await db.commit()
    await db.refresh(scene)
    return SceneOut.model_validate(scene)


@app.put("/scenes/{scene_id}", response_model=SceneOut)
async def update_scene(scene_id: str, body: SceneUpdate, db: AsyncSession = Depends(get_db)):
    scene = await db.get(Scene, scene_id)
    if not scene:
        raise HTTPException(404, f"Scene '{scene_id}' not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(scene, k, v)
    await db.commit()
    await db.refresh(scene)
    return SceneOut.model_validate(scene)


@app.delete("/scenes/{scene_id}")
async def delete_scene(scene_id: str, db: AsyncSession = Depends(get_db)):
    scene = await db.get(Scene, scene_id)
    if not scene:
        result = await db.execute(select(Scene).where(Scene.scene_number == scene_id))
        scene = result.scalars().first()
    if not scene:
        raise HTTPException(404, f"Scene '{scene_id}' not found")

    checks = await db.execute(select(ComplianceCheck).where((ComplianceCheck.scene_id == scene.id) | (ComplianceCheck.scene_id == scene.scene_number)))
    for chk in checks.scalars().all():
        await db.delete(chk)

    assets = await db.execute(select(MediaAsset).where(MediaAsset.scene_id == scene.id))
    for ast in assets.scalars().all():
        await db.delete(ast)

    await db.delete(scene)
    await db.commit()
    return {"status": "deleted", "id": scene_id}


# ─────────────────────────────────────────────────────────────────────
# SAFETY RULES
# ─────────────────────────────────────────────────────────────────────
@app.get("/safety-rules", response_model=List[SafetyRuleOut])
async def list_safety_rules(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SafetyRule))
    return result.scalars().all()


@app.post("/safety-rules", response_model=SafetyRuleOut, status_code=201)
async def create_safety_rule(body: SafetyRuleCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.get(SafetyRule, body.stunt_type)
    if existing:
        raise HTTPException(400, f"Safety rule for stunt type '{body.stunt_type}' already exists")
    rule = SafetyRule(**body.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@app.get("/safety-rules/{stunt_type}", response_model=SafetyRuleOut)
async def get_safety_rule(stunt_type: str, db: AsyncSession = Depends(get_db)):
    rule = await db.get(SafetyRule, stunt_type)
    if not rule:
        lower_type = stunt_type.lower()
        if any(k in lower_type for k in ["vehicle", "car", "chase", "bike", "driving", "highway", "traffic"]):
            rule = await db.get(SafetyRule, "vehicle_chase")
        elif any(k in lower_type for k in ["fall", "jump", "drop", "height", "roof", "rooftop"]):
            rule = await db.get(SafetyRule, "high_fall")
        elif any(k in lower_type for k in ["fire", "burn", "explosion", "pyro", "blast", "firework"]):
            rule = await db.get(SafetyRule, "fire_gag")
        elif any(k in lower_type for k in ["water", "dive", "underwater", "sea", "swim", "ocean"]):
            rule = await db.get(SafetyRule, "underwater")
        elif any(k in lower_type for k in ["practical", "combat", "fight", "stunt", "wire", "action"]):
            rule = await db.get(SafetyRule, "practical_effect")
    if not rule:
        rule = await db.get(SafetyRule, "practical_effect") or await db.get(SafetyRule, "none")
    if not rule:
        raise HTTPException(404, f"No rule for stunt type '{stunt_type}'")
    return rule


@app.put("/safety-rules/{stunt_type}", response_model=SafetyRuleOut)
async def update_safety_rule(
    stunt_type: str, body: SafetyRuleOut, db: AsyncSession = Depends(get_db)
):
    rule = await db.get(SafetyRule, stunt_type)
    if not rule:
        rule = SafetyRule(stunt_type=stunt_type)
        db.add(rule)
    for k, v in body.model_dump(exclude={"stunt_type"}).items():
        setattr(rule, k, v)
    await db.commit()
    await db.refresh(rule)
    return rule


@app.delete("/safety-rules/{stunt_type}")
async def delete_safety_rule(stunt_type: str, db: AsyncSession = Depends(get_db)):
    rule = await db.get(SafetyRule, stunt_type)
    if not rule:
        raise HTTPException(404, f"No rule for stunt type '{stunt_type}'")
    await db.delete(rule)
    await db.commit()
    return {"status": "deleted", "stunt_type": stunt_type}


# ─────────────────────────────────────────────────────────────────────
# COMPLIANCE CHECKS  — get_compliance_history / write_compliance_check
# ─────────────────────────────────────────────────────────────────────
@app.get("/compliance-history", response_model=List[ComplianceCheckOut])
async def get_compliance_history(
    scene_id: Optional[str] = Query(None),
    stunt_type: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    q = select(ComplianceCheck)
    if scene_id:
        sc_res = await db.execute(
            select(Scene).where(
                (Scene.id == scene_id) | 
                (Scene.scene_number.ilike(scene_id)) | 
                (Scene.description.ilike(f"%{scene_id}%"))
            )
        )
        scene = sc_res.scalars().first()
        if scene:
            q = q.where((ComplianceCheck.scene_id == scene.id) | (ComplianceCheck.scene_id == scene.scene_number))
        else:
            q = q.where(ComplianceCheck.scene_id == scene_id)
    if stunt_type:
        q = q.join(Scene, ComplianceCheck.scene_id == Scene.id).where(Scene.stunt_type == stunt_type)
    q = q.order_by(desc(ComplianceCheck.created_at)).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@app.post("/compliance-checks", response_model=ComplianceCheckOut, status_code=201)
async def write_compliance_check(
    body: ComplianceCheckCreate, db: AsyncSession = Depends(get_db)
):
    """The ONLY write path for compliance results. Always inserts — never updates."""
    check = ComplianceCheck(**body.model_dump())
    db.add(check)

    # Update scene latest_compliance_status
    scene = await db.get(Scene, body.scene_id)
    if not scene:
        sc_res = await db.execute(select(Scene).where(Scene.scene_number == body.scene_id))
        scene = sc_res.scalars().first()
    if scene:
        scene.latest_compliance_status = body.status

    await db.commit()
    await db.refresh(check)
    return check


@app.post("/compliance-checks/{check_id}/override", response_model=ComplianceCheckOut, status_code=201)
async def override_compliance(
    check_id: str, body: OverrideRequest, db: AsyncSession = Depends(get_db)
):
    """
    Human override: inserts a NEW approved check row with override metadata.
    The original blocked check is never touched — the audit trail shows a
    human made this call, not the agent.
    """
    original = await db.get(ComplianceCheck, check_id)
    if not original:
        raise HTTPException(404, "Compliance check not found")
    if original.status != "blocked":
        raise HTTPException(400, "Can only override a blocked check")

    new_check = ComplianceCheck(
        scene_id=original.scene_id,
        status="approved",
        violations=[],
        checked_by_agent="human_override",
        grafana_pushed=False,
        overridden_by_user_id=body.user_id,
        override_reason=body.reason,
    )
    db.add(new_check)
    await db.commit()
    await db.refresh(new_check)
    return new_check


# ─────────────────────────────────────────────────────────────────────
# SCRIPTS  — intake state machine
# ─────────────────────────────────────────────────────────────────────
@app.get("/scripts/{script_id}", response_model=ScriptOut)
async def get_script(script_id: str, db: AsyncSession = Depends(get_db)):
    script = await db.get(Script, script_id)
    if not script:
        raise HTTPException(404, "Script not found")
    return script


@app.post("/scripts", response_model=ScriptOut, status_code=201)
async def create_script(body: ScriptCreate, db: AsyncSession = Depends(get_db)):
    script = Script(**body.model_dump())
    db.add(script)
    await db.commit()
    await db.refresh(script)
    return script


@app.patch("/scripts/{script_id}/status", response_model=ScriptOut)
async def update_script_status(
    script_id: str, body: ScriptStatusUpdate, db: AsyncSession = Depends(get_db)
):
    script = await db.get(Script, script_id)
    if not script:
        raise HTTPException(404, "Script not found")
    script.status = body.status
    if body.parsed_at:
        script.parsed_at = body.parsed_at
    await db.commit()
    await db.refresh(script)
    return script


# ─────────────────────────────────────────────────────────────────────
# ACTOR PROFILES — Directory & Cached Dialogues
# ─────────────────────────────────────────────────────────────────────
@app.get("/actor-profiles", response_model=List[ActorProfileOut])
async def list_actor_profiles(
    production_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    q = select(ActorProfile)
    if production_id:
        q = q.where(ActorProfile.production_id == production_id)
    result = await db.execute(q)
    return result.scalars().all()


@app.post("/actor-profiles", response_model=ActorProfileOut, status_code=201)
async def create_or_update_actor_profile(body: ActorProfileCreate, db: AsyncSession = Depends(get_db)):
    # Check if character already exists for production
    q = select(ActorProfile).where(
        ActorProfile.production_id == body.production_id,
        ActorProfile.character_name.ilike(body.character_name)
    )
    res = await db.execute(q)
    existing = res.scalars().first()

    if existing:
        for k, v in body.model_dump(exclude_none=True).items():
            if k == "assigned_scene_ids":
                existing.assigned_scene_ids = list(set((existing.assigned_scene_ids or []) + v))
            elif k == "dialogues_by_scene":
                cur = dict(existing.dialogues_by_scene or {})
                cur.update(v)
                existing.dialogues_by_scene = cur
            else:
                setattr(existing, k, v)
        await db.commit()
        await db.refresh(existing)
        return existing

    profile = ActorProfile(**body.model_dump())
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile


@app.get("/script-text/{script_id}")
async def get_script_text(
    script_id: str,
    scene_ref: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns grounded script chunks for a given script (and optionally a specific scene).
    In Phase C these will come from BigQuery vector search; for now returns scene
    descriptions from Postgres as the grounding data.
    """
    script = await db.get(Script, script_id)
    if not script:
        raise HTTPException(404, "Script not found")

    q = select(Scene).where(Scene.script_id == script_id)
    if scene_ref:
        q = q.where(Scene.scene_number == scene_ref)
    result = await db.execute(q)
    scenes = result.scalars().all()

    chunks = [
        {
            "scene_number": s.scene_number,
            "description": s.description,
            "stunt_type": s.stunt_type,
            "location": s.location,
        }
        for s in scenes
    ]
    return {"script_id": script_id, "scene_ref": scene_ref, "chunks": chunks}


# ─────────────────────────────────────────────────────────────────────
# MEDIA ASSETS  — list_media_assets / write_media_asset / approve
# ─────────────────────────────────────────────────────────────────────
@app.get("/media-assets", response_model=List[MediaAssetOut])
async def list_media_assets(
    scene_id: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(MediaAsset)
    if scene_id:
        q = q.where(MediaAsset.scene_id == scene_id)
    if type:
        q = q.where(MediaAsset.type == type)
    q = q.order_by(desc(MediaAsset.created_at))
    result = await db.execute(q)
    return result.scalars().all()


@app.post("/media-assets", response_model=MediaAssetOut, status_code=201)
async def write_media_asset(body: MediaAssetCreate, db: AsyncSession = Depends(get_db)):
    asset = MediaAsset(**body.model_dump())
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset


@app.post("/media-assets/{asset_id}/approve", response_model=MediaAssetOut)
async def approve_media_asset(
    asset_id: str, body: ApproveAssetRequest, db: AsyncSession = Depends(get_db)
):
    asset = await db.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    asset.approved = True
    asset.approved_by_user_id = body.user_id
    await db.commit()
    await db.refresh(asset)
    return asset


# ─────────────────────────────────────────────────────────────────────
# REHEARSAL SESSIONS
# ─────────────────────────────────────────────────────────────────────
@app.get("/rehearsal-sessions", response_model=List[RehearsalSessionOut])
async def list_rehearsal_sessions(
    actor_id: Optional[str] = Query(None),
    scene_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(RehearsalSession)
    if actor_id:
        q = q.where(RehearsalSession.actor_id == actor_id)
    if scene_id:
        q = q.where(RehearsalSession.scene_id == scene_id)
    q = q.order_by(desc(RehearsalSession.started_at))
    result = await db.execute(q)
    return result.scalars().all()


@app.post("/rehearsal-sessions", response_model=RehearsalSessionOut, status_code=201)
async def create_rehearsal_session(
    body: RehearsalSessionCreate, db: AsyncSession = Depends(get_db)
):
    session = RehearsalSession(**body.model_dump())
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@app.patch("/rehearsal-sessions/{session_id}", response_model=RehearsalSessionOut)
async def end_rehearsal_session(
    session_id: str, body: RehearsalSessionEnd, db: AsyncSession = Depends(get_db)
):
    session = await db.get(RehearsalSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    session.ended_at = datetime.utcnow()
    if body.transcript_uri:
        session.transcript_uri = body.transcript_uri
    if body.summary:
        session.summary = body.summary
    await db.commit()
    await db.refresh(session)
    return session


# ─────────────────────────────────────────────────────────────────────
# DAILIES
# ─────────────────────────────────────────────────────────────────────
@app.get("/dailies", response_model=List[DailiesOut])
async def list_dailies(
    scene_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(Dailies)
    if scene_id:
        q = q.where(Dailies.scene_id == scene_id)
    q = q.order_by(desc(Dailies.created_at))
    result = await db.execute(q)
    return result.scalars().all()


@app.post("/dailies", response_model=DailiesOut, status_code=201)
async def create_dailies(body: DailiesCreate, db: AsyncSession = Depends(get_db)):
    dailies = Dailies(**body.model_dump())
    db.add(dailies)
    await db.commit()
    await db.refresh(dailies)
    return dailies


@app.patch("/dailies/{dailies_id}", response_model=DailiesOut)
async def update_dailies(
    dailies_id: str, body: DailiesUpdate, db: AsyncSession = Depends(get_db)
):
    dailies = await db.get(Dailies, dailies_id)
    if not dailies:
        raise HTTPException(404, "Dailies record not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(dailies, k, v)
    await db.commit()
    await db.refresh(dailies)
    return dailies


# ─────────────────────────────────────────────────────────────────────
# USERS
# ─────────────────────────────────────────────────────────────────────
@app.get("/users", response_model=List[UserOut])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.display_name))
    return result.scalars().all()


@app.post("/users", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, db: AsyncSession = Depends(get_db)):
    user = User(**body.model_dump())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@app.put("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpdate, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, f"User '{user_id}' not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    await db.commit()
    await db.refresh(user)
    return user


@app.delete("/users/{user_id}")
async def delete_user(user_id: str, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, f"User '{user_id}' not found")
    await db.delete(user)
    await db.commit()
    return {"status": "deleted", "id": user_id}


# ─────────────────────────────────────────────────────────────────────
# ML PREDICTION ENDPOINT
# ─────────────────────────────────────────────────────────────────────
@app.post("/predict-boxoffice")
async def predict_boxoffice(body: BoxOfficePredictionRequest):
    input_data = MoviePredictionInput(**body.model_dump())
    result = boxoffice_predictor.predict(input_data)
    return result.model_dump()

