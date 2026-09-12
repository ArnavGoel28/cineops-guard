"""
ScriptIntakeAgent — parses uploaded script PDFs into structured scene records.

Flow:
  1. receive script_id (already created, status='uploaded')
  2. parse_script_pdf → extracts scenes, characters, locations, stunt flags
  3. For each scene: create_scene via MCP server
  4. embed_and_index → chunks text to BigQuery script_embeddings (Phase C stub)
  5. update_script_status → 'parsed'

Uses Gemini for intelligent extraction (long-context PDF understanding).
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from google.adk.agents import Agent
from google.genai import Client as GenAIClient

from agent.mcp_client import mcp

def _get_client():
    from agent.secret_manager import get_secret
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or get_secret("GEMINI_API_KEY")
    if api_key:
        os.environ["GEMINI_API_KEY"] = api_key
        return GenAIClient(api_key=api_key)
    return GenAIClient()


INTAKE_INSTRUCTION = """
You are the CineOps Guard ScriptIntakeAgent. Your job is to ingest a
script or call sheet and convert it into structured scene records.

When given a script_id and production_id:
1. Call parse_script_pdf to extract all scenes from the document.
2. For each extracted scene, call create_scene_record to write it to the database.
3. Call finalize_intake when all scenes are written.

Always be thorough — extract every scene, noting stunt requirements,
locations, and any safety flags. If a stunt type isn't one of the known
types (high_fall, vehicle_chase, fire_gag, underwater, practical_effect, none),
default to 'practical_effect' for anything with a physical risk, or 'none'
for dialogue-only scenes.
"""


def _run_async(coro):
    try:
        return asyncio.run(coro)
    except RuntimeError:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            return executor.submit(lambda: asyncio.run(coro)).result()


def parse_script_pdf(script_id: str, production_id: str, pdf_text: str) -> dict:
    """
    Parse a script/call sheet text into structured scene records using Gemini.

    Args:
        script_id: UUID of the script record (already created in DB).
        production_id: UUID of the production this belongs to.
        pdf_text: the raw text content extracted from the uploaded PDF.

    Returns:
        dict with scenes list and extraction summary.
    """
    return _run_async(
        _async_parse(script_id, production_id, pdf_text)
    )


async def _async_parse(script_id: str, production_id: str, pdf_text: str) -> dict:
    # Mark as parsing
    await mcp.update_script_status(script_id, "parsing")

    # Use Gemini to extract structured scene data
    client = _get_client()

    extraction_prompt = f"""
You are parsing a film script or production call sheet. Extract ALL stunt and action scenes, returning
a JSON array of scene objects. Each object must have these fields:
  - scene_number: string (automatically assigned sequential identifier e.g. "SC-001", "SC-002", "SC-003")
  - header: string (the scene header or slugline telling what is inside the scene/stunt e.g. "EXT. JAIPUR HIGHWAY - NIGHT", "INT. WAREHOUSE - DAY")
  - description: string (detailed, full description of the stunt sequence, action mechanics, and dialogue context)
  - stunt_type: string (dynamic stunt category decided by you based on scene content e.g. "High-Speed Vehicle Chase", "Pyrotechnic Explosion", "Freefall Aerial Jump", "Wirework Martial Arts", "Underwater Rescue", "Hand-to-Hand Combat", etc.)
  - location: string (e.g. "highway", "rooftop", "riverbank", "soundstage")
  - characters: list of objects with character details, each having:
      - name: string (character name e.g. "ARJUN", "VIKRAM")
      - gender: string ("male" or "female")
  - dialogue_script: list of objects representing sequential lines of dialogue and action cues. Each object must have:
      - speaker: string (character name or "ACTION")
      - text: string (exact spoken dialogue or action description)
      - pause_hint: string optional direction (e.g. "pauses 2s", "shouting", "intense", "whispers")
      - gender: string ("male", "female", or "neutral" for ACTION lines)
  - risk_rating: string ("Low", "Medium", "High", or "Critical")
  - equipment_required: list of strings (e.g. ["Stunt Harness", "Crash Pads", "Fire Retardant Suit"])
  - safety_precautions: list of strings (e.g. ["On-set Medic", "Traffic Lockout", "Fire Extinguisher Crew"])
  - performers_needed: integer
  - notes: string (additional safety and execution notes)

Return ONLY valid JSON — no markdown, no explanation.

SCRIPT TEXT:
{pdf_text[:12000]}
"""

    print(f"[_async_parse] [STEP 1/6] PDF text extracted successfully. Length: {len(pdf_text)} characters")

    try:
        from google.genai import types as genai_types
        
        print("[_async_parse] [STEP 2/6] Initializing GenAI Client...")
        client = _get_client()
        
        env_model = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
        candidate_models = [env_model, "gemini-3.6-flash", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-2.0-flash"]
        candidate_models = list(dict.fromkeys(candidate_models))

        raw = None
        last_error = None
        for model in candidate_models:
            try:
                print(f"[_async_parse] [STEP 3/6] Sending request to Gemini API (model={model})...")
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=model,
                    contents=extraction_prompt,
                    config=genai_types.GenerateContentConfig(
                        response_mime_type="application/json"
                    ),
                )
                if response and response.text:
                    raw = response.text.strip()
                    print(f"[_async_parse] [STEP 4/6] Gemini API response received from model '{model}'. Response length: {len(raw)} characters")
                    break
            except Exception as m_err:
                print(f"[_async_parse] [STEP 3/6 ERROR] Model '{model}' failed: {type(m_err).__name__}: {m_err}")
                last_error = f"[{model}] {type(m_err).__name__}: {m_err}"

        if not raw:
            k_val = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
            print(f"[_async_parse] [STEP 4/6 FAILED] All Gemini models failed. Key Loaded: {bool(k_val)} (len={len(k_val)}). Details: {last_error}")
            raise RuntimeError(
                f"Gemini API generation failed. "
                f"Key Loaded: {bool(k_val)} (len={len(k_val)}). "
                f"Details: {last_error}"
            )

        print("[_async_parse] [STEP 5/6] Cleaning raw output & parsing JSON...")
        # Strip markdown fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        
        # Extract JSON array substring if extra text surrounds it
        json_match = re.search(r"\[\s*\{.*\}\s*\]", raw, re.DOTALL)
        if json_match:
            raw = json_match.group(0)

        scenes_data: List[Dict] = json.loads(raw)
        print(f"[_async_parse] [STEP 6/6] Structured scene array parsed successfully: {len(scenes_data)} scenes extracted.")

        # Auto-assign scene_number if missing or non-standard
        for idx, sc in enumerate(scenes_data):
            if not sc.get("scene_number") or not sc["scene_number"].startswith("SC-"):
                sc["scene_number"] = f"SC-{idx + 1:03d}"
            if not sc.get("header"):
                sc["header"] = sc.get("location") or f"SCENE {sc['scene_number']}"
            if not sc.get("characters"):
                sc["characters"] = []
            else:
                # Normalize characters: may come as list of objects {name, gender} or strings
                normalized_chars = []
                for ch in sc["characters"]:
                    if isinstance(ch, dict):
                        normalized_chars.append(ch.get("name", str(ch)))
                    else:
                        normalized_chars.append(str(ch))
                sc["characters"] = normalized_chars
            if not sc.get("dialogue_script"):
                sc["dialogue_script"] = []
    except Exception as exc:
        await mcp.update_script_status(script_id, "failed")
        raise RuntimeError(f"Script PDF parsing failed: {exc}") from exc

    return {"script_id": script_id, "scenes_extracted": scenes_data}


def create_scene_record(
    production_id: str,
    script_id: str,
    scene_number: str,
    description: str,
    header: str = "",
    stunt_type: str = "practical_effect",
    location: str = "",
    characters: list = None,
    dialogue_script: list = None,
) -> dict:
    """
    Write a single extracted scene to the database via the MCP server.
    Also creates or updates ActorProfiles for extracted characters.
    """
    chars = characters or []
    dialogues = dialogue_script or []

    sc = _run_async(
        mcp.create_scene({
            "production_id": production_id,
            "script_id": script_id,
            "scene_number": scene_number,
            "header": header,
            "description": description,
            "stunt_type": stunt_type,
            "location": location,
            "characters": chars,
            "dialogue_script": dialogues,
        })
    )

    # Auto-create or update ActorProfile records for extracted characters
    for char in chars:
        if char.upper() in ["ACTION", "ALL", "NARRATOR"]:
            continue
        try:
            _run_async(mcp.post("/actor-profiles", json={
                "production_id": production_id,
                "character_name": char.upper(),
                "assigned_scene_ids": [sc.get("id") or scene_number],
                "dialogues_by_scene": {
                    sc.get("id") or scene_number: [d for d in dialogues if d.get("speaker", "").upper() == char.upper()]
                }
            }))
        except Exception as e:
            print(f"[create_scene_record] ActorProfile notice for '{char}': {e}")

    return sc


def embed_and_index(script_id: str, scene_chunks: List[Dict[str, Any]]) -> dict:
    """
    Embed script text chunks into BigQuery vector store for RAG grounding.

    Phase C stub — currently logs the chunks that would be embedded.
    Will be wired to BigQuery Vector Search in Phase C.

    Args:
        script_id: the script whose text is being indexed.
        scene_chunks: list of {scene_number, description} dicts.

    Returns:
        Summary of indexing operation.
    """
    # TODO Phase C: embed via Gemini embedding model, write to BigQuery
    print(f"[embed_and_index] Phase C stub — would embed {len(scene_chunks)} chunks for script {script_id}")
    return {
        "status": "stub",
        "script_id": script_id,
        "chunks_queued": len(scene_chunks),
        "note": "BigQuery vector indexing will be wired in Phase C",
    }


def finalize_intake(script_id: str, scenes_created: int) -> dict:
    """
    Mark a script as fully parsed and indexed.

    Args:
        script_id: the script to finalize.
        scenes_created: how many scene records were written.

    Returns:
        Updated script record.
    """
    from datetime import datetime, timezone
    result = _run_async(
        mcp.update_script_status(
            script_id,
            "parsed",
            parsed_at=datetime.now(timezone.utc).isoformat(),
        )
    )
    return {**result, "scenes_created": scenes_created}


script_intake_agent = Agent(
    name="script_intake_agent",
    model=os.getenv("GEMINI_MODEL", "gemini-3.6-flash"),
    description=(
        "Parses uploaded script PDFs into structured scene records. "
        "Extracts scenes, characters, locations, and stunt flags. "
        "Writes scenes to the database via the MCP server and queues "
        "text for RAG indexing."
    ),
    instruction=INTAKE_INSTRUCTION,
    tools=[parse_script_pdf, create_scene_record, embed_and_index, finalize_intake],
)
