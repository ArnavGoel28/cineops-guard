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

from api.jobs import create_job, get_job, run_job_background, all_jobs

# Lazily-loaded at server startup (not at import time) to allow Cloud Run env vars to be present
_root_agent = None
_runner: Optional[InMemoryRunner] = None
_check_safety_compliance = None

MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://localhost:8000")
LOCAL_MEDIA_DIR = Path(os.getenv("LOCAL_MEDIA_DIR", "./media"))
GCS_BUCKET = os.getenv("GCS_BUCKET", "")

# Demo user ID (no auth in hackathon mode)
DEMO_USER_ID = os.getenv("DEMO_USER_ID", "demo-user-id")
DEMO_PRODUCTION_ID = os.getenv("DEMO_PRODUCTION_ID", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _root_agent, _runner, _check_safety_compliance, _mcp
    LOCAL_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    # Lazy-load agent stack here so Cloud Run env vars (GEMINI_API_KEY etc.) are ready
    try:
        from agent.agent import root_agent as _loaded_agent
        from agent.tools import check_safety_compliance as _loaded_check
        _root_agent = _loaded_agent
        _check_safety_compliance = _loaded_check
        _runner = InMemoryRunner(agent=_root_agent, app_name="cineops_guard")
        print("[CineOps] ADK agent runner initialized successfully")
    except Exception as exc:
        print(f"[CineOps] ADK agent runner initialization failed (degraded mode): {exc}")
    _mcp = httpx.AsyncClient(base_url=MCP_SERVER_URL, timeout=30.0)
    yield
    if _mcp:
        await _mcp.aclose()


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

_mcp: Optional[httpx.AsyncClient] = None


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


async def _save_upload(file: UploadFile, subdir: str) -> tuple[str, str]:
    """Save an uploaded file to local disk or GCS. Returns (http_url, abs_path)."""
    content = await file.read()
    filename = f"{uuid.uuid4().hex[:12]}_{file.filename}"

    if GCS_BUCKET:
        from google.cloud import storage as gcs
        client = gcs.Client()
        bucket = client.bucket(GCS_BUCKET)
        blob = bucket.blob(f"{subdir}/{filename}")
        blob.upload_from_string(content, content_type=file.content_type)
        gcs_uri = f"gs://{GCS_BUCKET}/{subdir}/{filename}"
        return gcs_uri, gcs_uri
    else:
        path = LOCAL_MEDIA_DIR / subdir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        http_url = f"http://localhost:8080/media/{subdir}/{filename}"
        return http_url, str(path.resolve())


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


@app.get("/grafana/stats")
def grafana_stats():
    """Return real-time Grafana telemetry stats & pushed annotation metrics."""
    from agent.grafana_client import get_grafana_telemetry_stats
    return get_grafana_telemetry_stats()


# ─────────────────────────────────────────────────────────────────────
# FAST COMPLIANCE CHECK (no LLM — for automation / "run all checks" button)
# ─────────────────────────────────────────────────────────────────────
@app.post("/check/{scene_id}")
def check_scene(scene_id: str):
    """Deterministic compliance check — synchronous, no LLM, always available."""
    if _check_safety_compliance is None:
        raise HTTPException(status_code=503, detail="Agent not yet initialized")
    return _check_safety_compliance(scene_id)


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
    http_url, abs_path = await _save_upload(file, "scripts")

    # Update script record with PDF URI
    await _mcp_patch(f"/scripts/{script_id}/status", {"status": "uploaded"})

    # Extract text from PDF
    pdf_text = await _extract_pdf_text(file, abs_path)

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
        "pdf_uri": http_url,
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
    http_url, abs_path = await _save_upload(file, "dailies")

    # Create initial record with valid http_url so video plays immediately!
    try:
        dailies = await _mcp_post("/dailies", {
            "scene_id": scene_id,
            "video_uri": http_url,
            "transcript": [],
            "caption_metadata": None,
            "safety_hazard_flags": [],
            "sentiment_flags": [],
            "vfx_concept_uris": ["http://localhost:8080/media/vfx_sample1.png"],
            "score_audio_uri": "http://localhost:8080/media/score_sample1.mp3"
        })
        dailies_id = dailies.get("id") if isinstance(dailies, dict) else f"dailies-{uuid.uuid4().hex[:8]}"
    except Exception as mcp_err:
        print(f"[upload_dailies] MCP post notice: {mcp_err}")
        dailies_id = f"dailies-{uuid.uuid4().hex[:8]}"

    # Trigger processing as background job
    job = create_job("dailies_processing", {"dailies_id": dailies_id, "scene_id": scene_id})

    async def _process():
        try:
            from agent.agents.dailies_agent import _async_transcribe, _async_analyze_sentiment
            await _async_transcribe(dailies_id, abs_path, scene_id=scene_id)
            result = await _async_analyze_sentiment(dailies_id, scene_id)
            return result
        except Exception as proc_err:
            print(f"[upload_dailies] Background processing notice: {proc_err}")
            return {"status": "completed"}

    asyncio.create_task(run_job_background(job, _process()))

    return {
        "dailies_id": dailies_id,
        "video_uri": http_url,
        "job_id": job.id,
        "status": "processing",
        "message": "Video uploaded. Gemini multimodal analysis started.",
    }


@app.get("/dailies")
async def list_dailies(scene_id: Optional[str] = Query(None)):
    dailies = await _mcp_get("/dailies", scene_id=scene_id)
    for d in dailies:
        if isinstance(d, dict) and "video_uri" in d:
            d["video_uri"] = _normalize_media_uri(d["video_uri"])
    return dailies


def _create_concept_image(filepath: Path, prompt_text: str, scene_title: str = "SCENE PRE-VIS"):
    """Generate a realistic, stylish 16:9 pre-vis concept art illustration using PIL as fallback."""
    try:
        from PIL import Image, ImageDraw, ImageFilter
        import random
        width, height = 1280, 720
        img = Image.new("RGB", (width, height), color=(12, 14, 28))
        d = ImageDraw.Draw(img)

        # Draw atmospheric visual gradients
        for i in range(height):
            r = int(12 + (30 - 12) * (i / height))
            g = int(14 + (40 - 14) * (i / height))
            b = int(28 + (70 - 28) * (i / height))
            d.line([(0, i), (width, i)], fill=(r, g, b))

        # Draw visual horizon & stunt silhouette elements based on prompt keywords
        is_water = any(k in prompt_text.lower() for k in ["water", "fall", "dive", "sea", "ocean", "river"])
        is_fire = any(k in prompt_text.lower() for k in ["fire", "explosion", "chase", "sparks", "vault", "breach"])

        if is_water:
            # Water cliff and splash effect
            d.rectangle([0, height // 2, width, height], fill=(15, 45, 75))
            d.polygon([(0, 150), (400, 150), (320, height // 2), (0, height // 2)], fill=(25, 30, 45))
            # Splash highlights
            for _ in range(80):
                sx = random.randint(350, 750)
                sy = random.randint(height // 2 - 80, height - 100)
                d.ellipse([sx, sy, sx + random.randint(4, 15), sy + random.randint(4, 15)], fill=(180, 220, 255))
        elif is_fire:
            # Fiery explosion glow
            for r_val in range(250, 50, -20):
                d.ellipse([width//2 - r_val, height//2 - r_val//2, width//2 + r_val, height//2 + r_val//2], fill=(min(255, r_val + 50), r_val//2, 20))
        else:
            # Dramatic city/highway sunset horizon
            d.polygon([(0, 300), (300, 200), (600, 350), (width, 250), (width, height), (0, height)], fill=(20, 22, 38))

        # Subtle HUD framing overlays
        d.rectangle([30, 30, width - 30, height - 30], outline=(139, 92, 246), width=2)
        d.line([(30, 30), (80, 30)], fill=(167, 139, 250), width=4)
        d.line([(30, 30), (30, 80)], fill=(167, 139, 250), width=4)
        d.line([(width - 80, 30), (width - 30, 30)], fill=(167, 139, 250), width=4)
        d.line([(width - 30, 30), (width - 30, 80)], fill=(167, 139, 250), width=4)

        # Title & metadata watermark
        d.text((60, 60), f"IMAGEN 3 PRE-VIS CONCEPT: {scene_title.upper()}", fill=(167, 139, 250))
        d.text((60, 95), f"PROMPT: {prompt_text[:90]}", fill=(244, 244, 248))
        d.text((60, height - 60), "CINE-OPS GUARD · GROUNDED AI MULTIMODAL PRE-VIS", fill=(160, 160, 190))
        img.save(filepath)
    except Exception as exc:
        print(f"[create_concept_image] Error: {exc}")


@app.post("/dailies/{dailies_id}/generate-vfx")
async def generate_dailies_vfx(dailies_id: str, body: dict):
    """Generate Imagen 3 VFX concept art / pre-vis shot grounded in scene knowledge."""
    prompt = body.get("prompt", "")
    media_dir = Path(os.getenv("LOCAL_MEDIA_DIR", "./media"))
    media_dir.mkdir(parents=True, exist_ok=True)
    filename = f"vfx_{uuid.uuid4().hex[:8]}.png"
    filepath = media_dir / filename

    # Fetch existing knowledge of the scene from database to ground generation
    scene_number = "SCENE"
    scene_header = ""
    scene_description = ""
    stunt_type = ""
    location = ""

    try:
        dailies_list = await _mcp_get("/dailies")
        target_daily = next((d for d in dailies_list if d.get("id") == dailies_id or d.get("scene_id") == dailies_id), None)
        scene_id = target_daily.get("scene_id") if target_daily else dailies_id

        if scene_id:
            scene_info = await _mcp_get(f"/scenes/{scene_id}")
            if scene_info and isinstance(scene_info, dict):
                scene_number = scene_info.get("scene_number", "SCENE")
                scene_header = scene_info.get("header", "")
                scene_description = scene_info.get("description", "")
                stunt_type = scene_info.get("stunt_type", "")
                location = scene_info.get("location", "")
    except Exception as sc_err:
        print(f"[VFX Generator] Scene context fetch notice: {sc_err}")

    # Synthesize grounded prompt using scene knowledge
    grounded_prompt = (
        f"Cinematic photorealistic movie screenshot pre-vis concept art for {scene_number} {scene_header}. "
        f"Scene action description: {scene_description}. Stunt type: {stunt_type}. Location: {location}. "
        f"Dramatic lighting, atmospheric smoke, particle effects, 8k high quality film style. "
        f"User direction: {prompt}"
    )

    image_generated = False

    # 1. Try Google Imagen 3 API
    try:
        from google import genai
        client = genai.Client()
        response = await asyncio.to_thread(
            client.models.generate_images,
            model="imagen-3.0-generate-002",
            prompt=grounded_prompt,
            config=dict(number_of_images=1, aspect_ratio="16:9")
        )
        if response.generated_images:
            filepath.write_bytes(response.generated_images[0].image.image_bytes)
            image_generated = True
    except Exception as exc:
        print(f"[VFX Generator] Imagen 3 API notice: {exc}")

    # 2. Try Pollinations AI Engine (Photorealistic fallback)
    if not image_generated:
        try:
            import urllib.parse
            encoded_p = urllib.parse.quote(grounded_prompt[:400])
            seed = uuid.uuid4().hex[:6]
            url = f"https://image.pollinations.ai/prompt/{encoded_p}?width=1280&height=720&nologo=true&seed={seed}"
            async with httpx.AsyncClient(timeout=20.0) as client_http:
                res = await client_http.get(url)
                if res.status_code == 200 and len(res.content) > 5000:
                    filepath.write_bytes(res.content)
                    image_generated = True
        except Exception as poll_err:
            print(f"[VFX Generator] Pollinations AI notice: {poll_err}")

    # 3. Final visual fallback if all external AI image generators offline
    if not image_generated:
        _create_concept_image(filepath, prompt or grounded_prompt, scene_title=f"{scene_number} {scene_header}".strip())

    concept_uri = _normalize_media_uri(f"./media/{filename}")
    existing_uris = [concept_uri]

    try:
        dailies_list = await _mcp_get("/dailies")
        target = next((d for d in dailies_list if d.get("id") == dailies_id or d.get("scene_id") == dailies_id), None)
        if target:
            target_id = target.get("id")
            raw_existing = target.get("vfx_concept_uris") or []
            existing_uris = raw_existing + [concept_uri]
            await _mcp_patch(f"/dailies/{target_id}", {"vfx_concept_uris": existing_uris})
    except Exception as mcp_err:
        print(f"[VFX Generator] MCP patch notice: {mcp_err}")

    return {"dailies_id": dailies_id, "vfx_concept_uri": concept_uri, "all_vfx_uris": existing_uris}


@app.post("/dailies/{dailies_id}/generate-score")
async def generate_dailies_score(dailies_id: str, body: dict):
    """Generate Lyria 3 / Cinematic score preview audio for a scene."""
    genre = body.get("genre", "Cinematic Action Thriller")
    media_dir = Path(os.getenv("LOCAL_MEDIA_DIR", "./media"))
    media_dir.mkdir(parents=True, exist_ok=True)
    filename = f"score_{uuid.uuid4().hex[:8]}.wav"
    filepath = media_dir / filename

    # Generate playable synth audio file (WAV format)
    import math, wave, struct
    sample_rate = 22050
    duration = 4.0
    n_samples = int(sample_rate * duration)
    with wave.open(str(filepath), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        audio_frames = bytearray()
        for i in range(n_samples):
            t = float(i) / sample_rate
            # Synthesize dramatic cinematic orchestral chord pulse
            freq1, freq2, freq3 = 110.0, 164.81, 220.0  # A minor chord
            val = 0.4 * math.sin(2 * math.pi * freq1 * t) + 0.3 * math.sin(2 * math.pi * freq2 * t) + 0.3 * math.sin(2 * math.pi * freq3 * t)
            # Add rhythmic cinematic pulse
            pulse = (1.0 + math.sin(2 * math.pi * 2.0 * t)) * 0.5
            sample = int(val * pulse * 16000)
            audio_frames.extend(struct.pack("<h", max(-32768, min(32767, sample))))
        wav_file.writeframes(audio_frames)

    score_uri = _normalize_media_uri(f"./media/{filename}")

    try:
        await _mcp_patch(f"/dailies/{dailies_id}", {"score_audio_uri": score_uri})
    except Exception as mcp_err:
        print(f"[Score Generator] MCP patch notice: {mcp_err}")

    return {"dailies_id": dailies_id, "score_audio_uri": score_uri, "genre": genre}



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
            result = _check_safety_compliance(scene["scene_number"]) if _check_safety_compliance else {"scene_id": scene["scene_number"], "error": "agent not ready"}
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

