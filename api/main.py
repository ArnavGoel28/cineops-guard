"""
CineOps Guard API Gateway v2

Expanded from v1's minimal FastAPI wrapper to cover all flows:

  GET  /health
  POST /check/{scene_id}          — fast compliance check (no LLM)
  POST /ask                       — Director agent natural-language interface
  GET  /productions               — proxy to MCP server
  POST /productions
  GET  /scenes                    — proxy to MCP server
  POST /scenes
  GET  /scenes/{scene_id}
  POST /scripts                   — create script record
  POST /scripts/{id}/upload       — upload PDF, trigger ScriptIntakeAgent
  GET  /scripts/{id}/status       — parsing progress
  GET  /compliance-history        — proxy to MCP server
  POST /compliance-checks/{id}/override  — human override (requires reason)
  POST /generate/storyboard       — async Imagen 3 job
  POST /generate/music            — async Lyria 3 job
  POST /generate/dialogue-read    — sync Gemini TTS
  GET  /jobs/{job_id}             — poll async job status
  GET  /media-assets              — proxy to MCP server
  POST /media-assets/{id}/approve — approve a generated asset
  GET  /rehearsal-sessions        — list sessions
  POST /rehearsal-sessions        — start session
  WS   /ws/rehearsal/{session_id} — Live API voice session
  POST /dailies/upload            — upload video, trigger DailiesAgent
  GET  /dailies                   — list dailies
  GET  /safety-rules              — list safety rules (Admin)
  PUT  /safety-rules/{stunt_type} — update rule (Admin)
  GET  /users                     — list users

Run:
    uvicorn api.main:app --reload --port 8080
"""

from __future__ import annotations

import asyncio
import io
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
load_dotenv()
if os.getenv("GOOGLE_API_KEY") and not os.getenv("GEMINI_API_KEY"):
    os.environ["GEMINI_API_KEY"] = os.environ["GOOGLE_API_KEY"]

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from google.adk.runners import InMemoryRunner
from google.genai import types as genai_types

from agent.agent import root_agent
from agent.tools import check_safety_compliance
from api.jobs import create_job, get_job, run_job_background, all_jobs

MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://localhost:8001")
LOCAL_MEDIA_DIR = Path(os.getenv("LOCAL_MEDIA_DIR", "./media"))
GCS_BUCKET = os.getenv("GCS_BUCKET", "")

# Demo user ID (no auth in hackathon mode)
DEMO_USER_ID = os.getenv("DEMO_USER_ID", "demo-user-id")
DEMO_PRODUCTION_ID = os.getenv("DEMO_PRODUCTION_ID", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    LOCAL_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="CineOps Guard API Gateway",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/media", StaticFiles(directory="media"), name="media")

_runner = InMemoryRunner(agent=root_agent, app_name="cineops_guard")
_mcp = httpx.AsyncClient(base_url=MCP_SERVER_URL, timeout=30.0)


def _normalize_media_uri(uri: str) -> str:
    if not uri:
        return uri
    if uri.startswith("http://") or uri.startswith("https://") or uri.startswith("gs://"):
        return uri
    filename = Path(uri).name
    return f"http://localhost:8080/media/{filename}"


# ── Request/Response models ───────────────────────────────────────────
class AskRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class OverrideRequest(BaseModel):
    check_id: str
    reason: str
    user_id: str = DEMO_USER_ID


class StoryboardRequest(BaseModel):
    scene_id: str
    description: str
    n_panels: int = 4
    style_notes: Optional[str] = None


class MusicRequest(BaseModel):
    scene_id: str
    description: str
    genre: str = "cinematic"
    intensity: str = "medium"
    duration_seconds: int = 30


class DialogueReadRequest(BaseModel):
    scene_id: str
    script_id: str
    dialogue_lines: List[Dict[str, str]]


class RehearsalStartRequest(BaseModel):
    scene_id: str
    actor_id: str = DEMO_USER_ID


class ApproveAssetRequest(BaseModel):
    user_id: str = DEMO_USER_ID


# ── Helpers ───────────────────────────────────────────────────────────
async def _mcp_get(path: str, **params) -> Any:
    r = await _mcp.get(path, params={k: v for k, v in params.items() if v is not None})
    if r.status_code == 404:
        raise HTTPException(404, r.json().get("detail", "Not found"))
    r.raise_for_status()
    return r.json()


async def _mcp_post(path: str, body: dict) -> Any:
    r = await _mcp.post(path, json=body)
    r.raise_for_status()
    return r.json()


async def _mcp_patch(path: str, body: dict) -> Any:
    r = await _mcp.patch(path, json=body)
    r.raise_for_status()
    return r.json()


async def _mcp_put(path: str, body: dict) -> Any:
    r = await _mcp.put(path, json=body)
    if r.status_code == 404:
        raise HTTPException(404, r.json().get("detail", "Not found"))
    r.raise_for_status()
    return r.json()


async def _mcp_delete(path: str) -> Any:
    r = await _mcp.delete(path)
    if r.status_code == 404:
        raise HTTPException(404, r.json().get("detail", "Not found"))
    r.raise_for_status()
    return r.json()


async def _save_upload(file: UploadFile, subdir: str) -> str:
    """Save an uploaded file to local disk or GCS. Returns URI."""
    content = await file.read()
    filename = f"{uuid.uuid4()}_{file.filename}"

    if GCS_BUCKET:
        from google.cloud import storage as gcs
        client = gcs.Client()
        bucket = client.bucket(GCS_BUCKET)
        blob = bucket.blob(f"{subdir}/{filename}")
        blob.upload_from_string(content, content_type=file.content_type)
        return f"gs://{GCS_BUCKET}/{subdir}/{filename}"
    else:
        path = LOCAL_MEDIA_DIR / subdir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return str(path)


# ─────────────────────────────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    try:
        mcp_health = await _mcp.get("/health")
        mcp_ok = mcp_health.status_code == 200
    except Exception:
        mcp_ok = False
    return {"status": "ok", "mcp_server": "ok" if mcp_ok else "unreachable"}


# ─────────────────────────────────────────────────────────────────────
# FAST COMPLIANCE CHECK (no LLM — for automation / "run all checks" button)
# ─────────────────────────────────────────────────────────────────────
@app.post("/check/{scene_id}")
def check_scene(scene_id: str):
    """Deterministic compliance check — synchronous, no LLM, always available."""
    return check_safety_compliance(scene_id)


# ─────────────────────────────────────────────────────────────────────
# AGENT NATURAL-LANGUAGE INTERFACE
# ─────────────────────────────────────────────────────────────────────
@app.post("/ask")
async def ask_agent(req: AskRequest):
    """Route a natural-language request through the Director Agent."""
    session_id = req.session_id or str(uuid.uuid4())
    user_id = "demo-user"

    try:
        session = await _runner.session_service.get_session(
            app_name="cineops_guard", user_id=user_id, session_id=session_id
        )
        if session is None:
            session = await _runner.session_service.create_session(
                app_name="cineops_guard", user_id=user_id, session_id=session_id
            )

        content = genai_types.Content(
            role="user", parts=[genai_types.Part(text=req.message)]
        )

        final_text = None
        async for event in _runner.run_async(
            user_id=user_id, session_id=session_id, new_message=content
        ):
            if event.content and event.content.parts:
                for p in event.content.parts:
                    if p.text:
                        final_text = (final_text or "") + p.text

        if final_text is None:
            raise HTTPException(500, "Agent produced no final response.")

        return {"session_id": session_id, "response": final_text}
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────
# PRODUCTIONS (proxy to MCP)
# ─────────────────────────────────────────────────────────────────────
@app.get("/productions")
async def list_productions():
    return await _mcp_get("/productions")


@app.post("/productions", status_code=201)
async def create_production(body: dict):
    return await _mcp_post("/productions", body)


@app.put("/productions/{id}")
async def update_production(id: str, body: dict):
    return await _mcp_put(f"/productions/{id}", body)


@app.delete("/productions/{id}")
async def delete_production(id: str):
    return await _mcp_delete(f"/productions/{id}")


# ─────────────────────────────────────────────────────────────────────
# SCENES (proxy to MCP)
# ─────────────────────────────────────────────────────────────────────
@app.get("/scenes")
async def list_scenes(
    production_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    stunt_type: Optional[str] = Query(None),
    shoot_date: Optional[str] = Query(None),
    limit: int = Query(100),
):
    return await _mcp_get(
        "/scenes",
        production_id=production_id,
        status=status,
        stunt_type=stunt_type,
        shoot_date=shoot_date,
        limit=limit,
    )


@app.get("/scenes/{scene_id}")
async def get_scene(scene_id: str):
    return await _mcp_get(f"/scenes/{scene_id}")


@app.post("/scenes", status_code=201)
async def create_scene(body: dict):
    return await _mcp_post("/scenes", body)


@app.put("/scenes/{scene_id}")
async def update_scene(scene_id: str, body: dict):
    return await _mcp_put(f"/scenes/{scene_id}", body)


@app.delete("/scenes/{scene_id}")
async def delete_scene(scene_id: str):
    return await _mcp_delete(f"/scenes/{scene_id}")


@app.post("/scenes/batch", status_code=201)
async def create_scenes_batch(body: dict):
    """Batch ingest user-confirmed scene/stunt records into active production."""
    production_id = body.get("production_id")
    raw_script_id = body.get("script_id")
    script_id = raw_script_id if (raw_script_id and str(raw_script_id).strip() not in ("", "null", "undefined")) else None
    scenes = body.get("scenes", [])
    
    created_records = []
    for idx, s in enumerate(scenes):
        scene_num = s.get("scene_number") or f"SC-{str(idx + 1).zfill(3)}"
        chars = s.get("characters", [])
        dialogues = s.get("dialogue_script", [])

        record = await _mcp_post("/scenes", {
            "production_id": production_id,
            "script_id": script_id,
            "scene_number": scene_num,
            "header": s.get("header") or s.get("location") or f"SCENE {scene_num}",
            "description": s.get("description", ""),
            "stunt_type": s.get("stunt_type", "practical_effect"),
            "location": s.get("location", ""),
            "stunt_coordinator_assigned": s.get("stunt_coordinator_assigned", True),
            "medic_onset": s.get("medic_onset", True),
            "characters": chars,
            "dialogue_script": dialogues,
        })
        created_records.append(record)

        # Create/Update ActorProfiles for extracted characters
        for char in chars:
            if not char or char.upper() in ["ACTION", "ALL", "NARRATOR"]:
                continue
            try:
                char_dialogues = [d for d in dialogues if d.get("speaker", "").upper() == char.upper()]
                await _mcp_post("/actor-profiles", {
                    "production_id": production_id,
                    "character_name": char.upper(),
                    "assigned_scene_ids": [record.get("id") or scene_num],
                    "dialogues_by_scene": {
                        record.get("id") or scene_num: char_dialogues
                    }
                })
            except Exception as e:
                print(f"[create_scenes_batch] ActorProfile notice for '{char}': {e}")

    if script_id:
        from datetime import datetime, timezone
        await _mcp_patch(f"/scripts/{script_id}/status", {
            "status": "parsed",
            "parsed_at": datetime.now(timezone.utc).isoformat(),
        })

    return {"production_id": production_id, "total_created": len(created_records), "scenes": created_records}


# ─────────────────────────────────────────────────────────────────────
# SCRIPTS — intake flow
# ─────────────────────────────────────────────────────────────────────
@app.post("/scripts", status_code=201)
async def create_script(production_id: str = Query(...)):
    return await _mcp_post("/scripts", {"production_id": production_id})


@app.get("/scripts/{script_id}")
async def get_script(script_id: str):
    return await _mcp_get(f"/scripts/{script_id}")


@app.post("/scripts/{script_id}/upload")
async def upload_script_pdf(
    script_id: str,
    file: UploadFile = File(...),
    production_id: str = Query(...),
):
    """Upload a PDF and trigger ScriptIntakeAgent parsing."""
    uri = await _save_upload(file, "scripts")

    # Update script record with PDF URI
    await _mcp_patch(f"/scripts/{script_id}/status", {"status": "uploaded"})

    # Extract text from PDF
    pdf_text = await _extract_pdf_text(file, uri)

    # Trigger parsing as background job
    job = create_job("script_intake", {"script_id": script_id, "production_id": production_id})

    async def _intake():
        from agent.agents.script_intake_agent import _async_parse
        from agent.mcp_client import mcp
        from datetime import datetime, timezone

        result = await _async_parse(script_id, production_id, pdf_text)
        scenes = result.get("scenes_extracted", [])
        return {
            "script_id": script_id,
            "production_id": production_id,
            "scenes": scenes,
            "scenes_created": len(scenes),
            "status": "review_required",
        }

    asyncio.create_task(run_job_background(job, _intake()))

    return {
        "script_id": script_id,
        "pdf_uri": uri,
        "job_id": job.id,
        "status": "parsing",
        "message": "Script uploaded. Poll /jobs/{job_id} for parsing progress.",
    }


async def _extract_pdf_text(file: UploadFile, uri: str) -> str:
    """Extract text from PDF. Returns raw text."""
    try:
        from pypdf import PdfReader
        # Re-read file (already consumed for upload)
        if uri.startswith("gs://"):
            # Fetch from GCS
            from google.cloud import storage as gcs
            client = gcs.Client()
            bucket_name, blob_name = uri[5:].split("/", 1)
            blob = client.bucket(bucket_name).blob(blob_name)
            pdf_bytes = blob.download_as_bytes()
        else:
            pdf_bytes = Path(uri).read_bytes()

        reader = PdfReader(io.BytesIO(pdf_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:
        print(f"[_extract_pdf_text] Error: {exc}")
        return f"[PDF extraction failed: {exc}]"


# ─────────────────────────────────────────────────────────────────────
# COMPLIANCE
# ─────────────────────────────────────────────────────────────────────
@app.get("/compliance-history")
async def get_compliance_history(
    scene_id: Optional[str] = Query(None),
    stunt_type: Optional[str] = Query(None),
    limit: int = Query(50),
):
    return await _mcp_get("/compliance-history", scene_id=scene_id, stunt_type=stunt_type, limit=limit)


@app.post("/compliance-checks/{check_id}/override", status_code=201)
async def override_compliance(check_id: str, req: OverrideRequest):
    """Human override — inserts a new approved check row with audit metadata."""
    r = await _mcp.post(
        f"/compliance-checks/{check_id}/override",
        json={"user_id": req.user_id, "reason": req.reason},
    )
    r.raise_for_status()
    return r.json()


# ─────────────────────────────────────────────────────────────────────
# GENERATION JOBS (async)
# ─────────────────────────────────────────────────────────────────────
@app.post("/generate/storyboard", status_code=202)
async def generate_storyboard(req: StoryboardRequest):
    """Start async storyboard generation. Returns job_id."""
    from agent.agents.storyboard_agent import _async_generate_storyboard

    job = create_job("storyboard", req.model_dump())
    asyncio.create_task(run_job_background(
        job,
        _async_generate_storyboard(
            req.scene_id, req.description, min(req.n_panels, 6), req.style_notes
        )
    ))
    return {"job_id": job.id, "status": "pending", "message": "Storyboard generation started."}


@app.post("/generate/music", status_code=202)
async def generate_music(req: MusicRequest):
    """Start async mood music generation. Returns job_id."""
    from agent.agents.audio_agent import _async_mood_music

    job = create_job("mood_music", req.model_dump())
    asyncio.create_task(run_job_background(
        job,
        _async_mood_music(
            req.scene_id, req.description, req.genre,
            req.intensity, req.duration_seconds,
        )
    ))
    return {"job_id": job.id, "status": "pending", "message": "Music generation started."}


@app.post("/generate/dialogue-read")
async def generate_dialogue_read(req: DialogueReadRequest):
    """Synchronous dialogue read generation (short clips)."""
    from agent.agents.audio_agent import _async_dialogue_read
    return await _async_dialogue_read(req.scene_id, req.script_id, req.dialogue_lines)


@app.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job.to_dict()


@app.get("/jobs")
async def list_all_jobs():
    return all_jobs()


# ─────────────────────────────────────────────────────────────────────
# MEDIA ASSETS
# ─────────────────────────────────────────────────────────────────────
@app.get("/media-assets")
async def list_media_assets(
    scene_id: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
):
    assets = await _mcp_get("/media-assets", scene_id=scene_id, type=type)
    for asset in assets:
        if isinstance(asset, dict) and "storage_uri" in asset:
            asset["storage_uri"] = _normalize_media_uri(asset["storage_uri"])
    return assets


@app.post("/media-assets/{asset_id}/approve")
async def approve_media_asset(asset_id: str, req: ApproveAssetRequest):
    r = await _mcp.post(f"/media-assets/{asset_id}/approve", json={"user_id": req.user_id})
    r.raise_for_status()
    return r.json()


# ─── ACTOR PROFILES ──────────────────────────────────────────────────
@app.get("/actor-profiles")
async def list_actor_profiles(production_id: Optional[str] = Query(None)):
    return await _mcp_get("/actor-profiles", production_id=production_id)


# ─────────────────────────────────────────────────────────────────────
# REHEARSAL SESSIONS
# ─────────────────────────────────────────────────────────────────────
@app.get("/rehearsal-sessions")
async def list_rehearsal_sessions(
    actor_id: Optional[str] = Query(None),
    scene_id: Optional[str] = Query(None),
):
    return await _mcp_get("/rehearsal-sessions", actor_id=actor_id, scene_id=scene_id)


@app.post("/rehearsal-sessions", status_code=201)
async def start_rehearsal_session(req: RehearsalStartRequest):
    return await _mcp_post("/rehearsal-sessions", req.model_dump())


@app.websocket("/ws/rehearsal/{session_id}")
async def rehearsal_websocket(
    websocket: WebSocket,
    session_id: str,
    actor_character: str = Query("Actor")
):
    """
    WebSocket proxy for Gemini Live API actor rehearsal sessions.
    The actor's audio goes in; the AI-voiced scene partner's audio comes out.
    Live transcript is sent as JSON text messages alongside audio.
    """
    await websocket.accept()

    # Get session context from MCP
    try:
        r = await _mcp.get("/rehearsal-sessions", params={"actor_id": DEMO_USER_ID})
        sessions = r.json()
        session_info = next((s for s in sessions if s["id"] == session_id), None)
        scene_id = session_info["scene_id"] if session_info else ""
    except Exception:
        scene_id = ""

    scene_description = ""
    dialogue_script = []
    scene_characters = []

    if scene_id:
        try:
            scene = await _mcp_get(f"/scenes/{scene_id}")
            scene_description = scene.get("description", "")
            dialogue_script = scene.get("dialogue_script", [])
            scene_characters = scene.get("characters", [])
        except Exception:
            pass

    transcript_lines = []

    async def ws_send(data: bytes):
        await websocket.send_bytes(data)

    async def ws_recv():
        while True:
            try:
                msg = await websocket.receive()
                if "bytes" in msg:
                    yield msg["bytes"]
                elif "text" in msg:
                    yield msg["text"]
                    if '"type": "end"' in msg["text"] or '"type":"end"' in msg["text"]:
                        break
            except WebSocketDisconnect:
                break

    try:
        from agent.agents.rehearsal_agent import run_live_session
        transcript, summary = await run_live_session(
            scene_id=scene_id,
            scene_description=scene_description,
            actor_character=actor_character,
            scene_characters=scene_characters,
            dialogue_script=dialogue_script,
            websocket_send=ws_send,
            websocket_recv=ws_recv(),
        )

        # Save transcript
        await _mcp_patch(f"/rehearsal-sessions/{session_id}", {
            "transcript_uri": None,
            "summary": summary,
        })

        await websocket.send_json({
            "type": "session_end",
            "transcript": transcript,
            "summary": summary,
        })
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────
# DAILIES
# ─────────────────────────────────────────────────────────────────────
@app.post("/dailies/upload", status_code=202)
async def upload_dailies(
    scene_id: str = Query(...),
    file: UploadFile = File(...),
):
    """Upload a video clip and trigger DailiesAgent processing."""
    uri = await _save_upload(file, "dailies")

    # Create dailies record
    dailies = await _mcp_post("/dailies", {"scene_id": scene_id, "video_uri": uri})
    dailies_id = dailies["id"]

    # Trigger processing as background job
    job = create_job("dailies_processing", {"dailies_id": dailies_id, "scene_id": scene_id})

    async def _process():
        from agent.agents.dailies_agent import _async_transcribe, _async_analyze_sentiment
        await _async_transcribe(dailies_id, uri)
        result = await _async_analyze_sentiment(dailies_id, scene_id)
        return result

    asyncio.create_task(run_job_background(job, _process()))

    return {
        "dailies_id": dailies_id,
        "video_uri": uri,
        "job_id": job.id,
        "status": "processing",
        "message": "Video uploaded. Transcription and sentiment analysis started.",
    }


@app.get("/dailies")
async def list_dailies(scene_id: Optional[str] = Query(None)):
    return await _mcp_get("/dailies", scene_id=scene_id)


# ─────────────────────────────────────────────────────────────────────
# SAFETY RULES (Admin)
# ─────────────────────────────────────────────────────────────────────
@app.get("/safety-rules")
async def list_safety_rules():
    return await _mcp_get("/safety-rules")


@app.post("/safety-rules", status_code=201)
async def create_safety_rule(body: dict):
    return await _mcp_post("/safety-rules", body)


@app.put("/safety-rules/{stunt_type}")
async def update_safety_rule(stunt_type: str, body: dict):
    return await _mcp_put(f"/safety-rules/{stunt_type}", body)


@app.delete("/safety-rules/{stunt_type}")
async def delete_safety_rule(stunt_type: str):
    return await _mcp_delete(f"/safety-rules/{stunt_type}")


# ─────────────────────────────────────────────────────────────────────
# USERS (Admin)
# ─────────────────────────────────────────────────────────────────────
@app.get("/users")
async def list_users():
    return await _mcp_get("/users")


@app.post("/users", status_code=201)
async def create_user(body: dict):
    return await _mcp_post("/users", body)


@app.put("/users/{user_id}")
async def update_user(user_id: str, body: dict):
    return await _mcp_put(f"/users/{user_id}", body)


@app.delete("/users/{user_id}")
async def delete_user(user_id: str):
    return await _mcp_delete(f"/users/{user_id}")


# ─────────────────────────────────────────────────────────────────────
# RUN ALL COMPLIANCE CHECKS (bulk dashboard button)
# ─────────────────────────────────────────────────────────────────────
@app.post("/run-all-checks")
async def run_all_checks(production_id: str = Query(...)):
    """Run compliance checks on all scenes for a production."""
    scenes = await _mcp_get("/scenes", production_id=production_id, limit=200)
    results = []
    for scene in scenes:
        try:
            result = check_safety_compliance(scene["scene_number"])
            results.append(result)
        except Exception as exc:
            results.append({"scene_id": scene["scene_number"], "error": str(exc)})
    return {"production_id": production_id, "total": len(results), "results": results}


# ─────────────────────────────────────────────────────────────────────
# BOX OFFICE & ROI ML PREDICTION ENDPOINT
# ─────────────────────────────────────────────────────────────────────
@app.post("/analytics/predict-roi")
async def predict_boxoffice_roi(body: dict):
    """Predict Box Office revenue, ROI multiple, financial risk score, and SHAP feature drivers."""
    return await _mcp_post("/predict-boxoffice", body)

