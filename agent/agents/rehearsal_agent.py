"""
RehearsalAgent — live bidirectional voice rehearsal via the Gemini Live API.

This is NOT a standard request/response agent. It manages a persistent
WebSocket session where the actor speaks lines and the AI voices the
scene partner in real time.

The API Gateway WebSocket at /ws/rehearsal/{session_id} handles the
browser↔Gemini Live API bridge. This module provides:
  - The Gemini Live API session handler
  - Session transcript accumulation
  - Post-session summary generation
  - MCP server writes for session persistence
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Optional

from google.adk.agents import Agent

from agent.mcp_client import mcp

LOCAL_MEDIA_DIR = Path(os.getenv("LOCAL_MEDIA_DIR", "./media"))
GCS_BUCKET = os.getenv("GCS_BUCKET", "")

REHEARSAL_INSTRUCTION = """
You are the CineOps Guard RehearsalAgent — a scene partner for actor rehearsals.

When an actor starts a rehearsal session, you will:
1. Call start_rehearsal_session with the scene_id and actor_id.
2. Voice all characters EXCEPT the actor's own character in the scene.
3. Respond naturally to the actor's delivered lines, in character.
4. After the session ends, call save_rehearsal_transcript with the
   full transcript and a brief coaching summary (pacing, missed cues,
   tone notes).

Keep responses in-character and at the pace of the scene. If the actor
pauses too long, gently re-prompt with the next cue line.
"""


def _run_async(coro):
    try:
        return asyncio.run(coro)
    except RuntimeError:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            return executor.submit(lambda: asyncio.run(coro)).result()


def start_rehearsal_session(scene_id: str, actor_id: str) -> dict:
    """
    Create a new rehearsal session record in the database.

    Args:
        scene_id: UUID of the scene being rehearsed.
        actor_id: UUID of the actor starting the session.

    Returns:
        dict with session_id to use for the duration of the session.
    """
    session = _run_async(
        mcp.create_rehearsal_session(scene_id, actor_id)
    )
    return {"session_id": session["id"], "scene_id": scene_id, "actor_id": actor_id}


def save_rehearsal_transcript(
    session_id: str,
    transcript: str,
    summary: str,
) -> dict:
    """
    Save the completed rehearsal transcript and coaching summary.

    Args:
        session_id: UUID of the rehearsal session.
        transcript: full text transcript of the session.
        summary: agent-generated coaching notes (pacing, missed cues, tone).

    Returns:
        Updated session record.
    """
    return _run_async(
        _async_save_transcript(session_id, transcript, summary)
    )


async def _async_save_transcript(
    session_id: str, transcript: str, summary: str
) -> dict:
    # Save transcript text to local file / GCS
    filename = f"rehearsal_transcript_{session_id}.txt"
    LOCAL_MEDIA_DIR.mkdir(parents=True, exist_ok=True)

    if GCS_BUCKET:
        uri = await _upload_text_to_gcs(transcript, filename)
    else:
        path = LOCAL_MEDIA_DIR / filename
        path.write_text(transcript)
        uri = str(path)

    result = await mcp.end_rehearsal_session(
        session_id=session_id,
        transcript_uri=uri,
        summary=summary,
    )
    return result


async def _upload_text_to_gcs(text: str, filename: str) -> str:
    from google.cloud import storage as gcs
    client = gcs.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(f"rehearsals/{filename}")
    await asyncio.to_thread(blob.upload_from_string, text.encode(), content_type="text/plain")
    return f"gs://{GCS_BUCKET}/rehearsals/{filename}"


async def run_live_session(
    scene_id: str,
    scene_description: str,
    actor_character: str,
    scene_characters: list = None,
    dialogue_script: list = None,
    websocket_send=None,
    websocket_recv: AsyncIterator = None,
) -> tuple[str, str]:
    """
    Run a Gemini Live API session for actor rehearsal.
    """
    try:
        from google import genai
        from google.genai import types

        client = genai.Client()

        other_chars = [c for c in (scene_characters or []) if c.upper() != actor_character.upper()]
        other_chars_str = ", ".join(other_chars) if other_chars else "all other characters in scene"

        script_context = ""
        if dialogue_script and isinstance(dialogue_script, list):
            script_lines = []
            for d in dialogue_script:
                spk = d.get("speaker", "ACTION")
                txt = d.get("text", "")
                p_hint = f" ({d['pause_hint']})" if d.get("pause_hint") else ""
                script_lines.append(f"{spk}: {txt}{p_hint}")
            script_context = "\nPRE-EXTRACTED SCENE DIALOGUE SCRIPT:\n" + "\n".join(script_lines)

        system_prompt = (
            f"You are the CineOps Guard AI scene partner for actor rehearsal. "
            f"The human actor is rehearsing as character '{actor_character}'. "
            f"You will voice all opposing characters ({other_chars_str}) in the scene. "
            f"Wait for the actor to speak their lines for '{actor_character}', then deliver your lines in character with natural pacing and emotion. "
            f"Scene Context: {scene_description}. "
            f"{script_context}"
        )

        transcript_lines = []
        summary = ""

        config = {
            "response_modalities": ["AUDIO"],
            "system_instruction": system_prompt,
        }

        # Priority list of supported Gemini Live / Bidirectional models
        live_models = [
            "gemini-3.1-flash-live-preview",
            "gemini-2.5-flash-native-audio-latest",
            "gemini-2.0-flash-exp",
        ]

        session_established = False
        last_err = None

        for model_name in live_models:
            try:
                print(f"[RehearsalAgent] Connecting to Gemini Live API with model '{model_name}'...")
                async with client.aio.live.connect(
                    model=model_name,
                    config=config,
                ) as session:
                    session_established = True
                    async def send_loop():
                        async for msg in websocket_recv:
                            if isinstance(msg, bytes):
                                try:
                                    await session.send(input=types.LiveClientRealtimeInput(media_chunks=[types.Blob(data=msg, mime_type="audio/pcm")]))
                                except Exception:
                                    await session.send(input={"data": msg, "mime_type": "audio/pcm"})
                            elif isinstance(msg, str):
                                try:
                                    data = json.loads(msg)
                                    if data.get("type") == "end":
                                        break
                                    txt = data.get("text", "")
                                    if txt:
                                        transcript_lines.append(f"Actor: {txt}")
                                        await session.send(input=types.LiveClientContent(turns=[types.Content(role="user", parts=[types.Part.from_text(text=txt)])]))
                                except Exception:
                                    pass

                    async def recv_loop():
                        async for response in session.receive():
                            if hasattr(response, "data") and response.data:
                                await websocket_send(response.data)
                            if hasattr(response, "text") and response.text:
                                transcript_lines.append(f"AI: {response.text}")
                                await websocket_send(json.dumps({"type": "ai_text", "text": response.text}))

                    await asyncio.gather(send_loop(), recv_loop())
                break
            except Exception as exc:
                print(f"[RehearsalAgent] Live model '{model_name}' connection notice: {exc}")
                last_err = exc

        # Fallback to in-character scene response if live bidirectional stream closed early
        if not transcript_lines:
            opposing_lines = []
            if dialogue_script and isinstance(dialogue_script, list):
                for d in dialogue_script:
                    spk = d.get("speaker", "ACTION")
                    if spk.upper() != actor_character.upper() and spk.upper() != "ACTION":
                        opposing_lines.append(f"{spk}: {d.get('text', '')}")

            resp = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-2.5-flash",
                contents=(
                    f"You are the scene partner for a film rehearsal. The actor is playing {actor_character}. "
                    f"Opposing characters' lines in this scene:\n" + "\n".join(opposing_lines) + "\n\n"
                    f"Generate a supportive, in-character performance cue and brief greeting for the actor to start rehearsing."
                )
            )
            initial_greeting = resp.text or "Ready when you are! Speak your first line."
            transcript_lines.append(f"AI Scene Partner: {initial_greeting}")

        transcript = "\n".join(transcript_lines)

        # Generate coaching summary
        summary = ""
        try:
            resp = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-2.5-flash",
                contents=(
                    f"Analyze this rehearsal transcript and provide brief coaching notes "
                    f"(pacing, missed cues, tone, areas for improvement):\n\n{transcript[:4000]}"
                ),
            )
            summary = resp.text or "Session complete. Great rehearsal!"
        except Exception:
            summary = "Session complete. Good line practice and delivery!"

        return transcript, summary

    except Exception as exc:
        print(f"[RehearsalAgent] Live API error: {exc}")
        return f"[Session error: {exc}]", "Session could not be completed."


rehearsal_agent = Agent(
    name="rehearsal_agent",
    model="gemini-2.5-flash",
    description=(
        "Manages actor rehearsal sessions via the Gemini Live API. "
        "Voices all scene partners in real-time bidirectional audio. "
        "Saves transcripts and coaching summaries via the MCP server."
    ),
    instruction=REHEARSAL_INSTRUCTION,
    tools=[start_rehearsal_session, save_rehearsal_transcript],
)
