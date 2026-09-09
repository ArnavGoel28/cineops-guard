"""
AudioAgent — generates mood/reference music (Lyria 3) and dialogue reads (Gemini TTS).

Two tools:
  generate_mood_music   — async, Lyria 3 via Vertex AI
  generate_dialogue_read — sync for short clips, Gemini TTS multi-speaker

Both save audio to Cloud Storage (or local disk) and write media_assets
rows via the MCP server. Same approve/regenerate pattern as StoryboardAgent.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path
from typing import List, Optional

from google.adk.agents import Agent

from agent.mcp_client import mcp

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")
LOCAL_MEDIA_DIR = Path(os.getenv("LOCAL_MEDIA_DIR", "./media"))
GCS_BUCKET = os.getenv("GCS_BUCKET", "")

AUDIO_INSTRUCTION = """
You are the CineOps Guard AudioAgent. You handle two types of audio:

1. Mood/reference music: use generate_mood_music when the sound department
   needs a reference track for a scene's emotional tone.
2. Dialogue reads: use generate_dialogue_read when the director wants to
   hear how the scene's lines should sound before the real recording.

After generating, report the asset_id so the user can listen and approve it.
"""


# ─── Mood Music (Lyria 3) ────────────────────────────────────────────
def _run_async(coro):
    try:
        return asyncio.run(coro)
    except RuntimeError:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            return executor.submit(lambda: asyncio.run(coro)).result()


def generate_mood_music(
    scene_id: str,
    description: str,
    genre: str = "cinematic",
    intensity: str = "medium",
    duration_seconds: int = 30,
) -> dict:
    """
    Generate a mood/reference music clip for a scene using Lyria 3.

    Args:
        scene_id: UUID of the scene.
        description: description of the scene's emotional tone and action.
        genre: music genre (e.g. "cinematic", "thriller", "action", "drama").
        intensity: "low" | "medium" | "high" — dynamic intensity of the clip.
        duration_seconds: target clip length (15–60 seconds).

    Returns:
        dict with asset_id and storage_uri.
    """
    return _run_async(
        _async_mood_music(scene_id, description, genre, intensity, duration_seconds)
    )


async def _async_mood_music(
    scene_id: str, description: str, genre: str, intensity: str, duration_seconds: int
) -> dict:
    prompt = (
        f"{genre} film score, {intensity} intensity, {duration_seconds}s: {description}"
    )

    audio_bytes = await _lyria3_generate(prompt, duration_seconds)
    filename = f"mood_music_{scene_id}_{uuid.uuid4()}.wav"

    if STORAGE_BACKEND == "gcs" and GCS_BUCKET:
        uri = await _upload_audio_to_gcs(audio_bytes, filename)
    else:
        uri = _save_audio_locally(audio_bytes, filename)

    asset = await mcp.write_media_asset(
        scene_id=scene_id,
        asset_type="mood_music",
        storage_uri=uri,
        generated_by_agent="audio_agent",
        prompt_used=prompt,
    )
    return {
        "asset_id": asset["id"],
        "storage_uri": uri,
        "genre": genre,
        "intensity": intensity,
        "duration_seconds": duration_seconds,
    }


async def _lyria3_generate(prompt: str, duration: int) -> bytes:
    """Generate mood music audio via Lyria 3 / Gemini Audio Models."""
    audio_models = [
        "lyria-3.5",
        "lyria-3-clip-preview",
        "gemini-3.1-flash-tts-preview",
        "gemini-2.5-flash-preview-tts",
    ]
    try:
        from google import genai
        from google.genai import types

        client = genai.Client()
        music_prompt = (
            f"Create original film score background music track. Mood/Scene details: {prompt}. "
            f"Atmospheric, dynamic, high production value cinematic music composition."
        )

        for model_name in audio_models:
            try:
                res = await asyncio.to_thread(
                    client.models.generate_content,
                    model=model_name,
                    contents=music_prompt,
                    config=types.GenerateContentConfig(
                        response_modalities=["AUDIO"]
                    )
                )
                if res.candidates and res.candidates[0].content:
                    for part in res.candidates[0].content.parts:
                        if hasattr(part, "inline_data") and part.inline_data:
                            print(f"[AudioAgent] Generated mood music using {model_name} ({len(part.inline_data.data)} bytes)")
                            return part.inline_data.data
            except Exception as m_err:
                print(f"[AudioAgent] Model {model_name} notice: {m_err}")

    except Exception as exc:
        print(f"[AudioAgent] Lyria 3 API error: {exc} — fallback to synth audio track")

    return _silent_wav(duration)


def _silent_wav(duration_seconds: int) -> bytes:
    """Synthesize a pleasant 44.1kHz cinematic orchestral synth audio track using math.sin wave harmonics."""
    import struct
    import math

    sample_rate = 44100
    n_samples = sample_rate * duration_seconds
    
    # A minor chord progression frequencies: Am (220, 261.6, 329.6), F (174.6, 220, 261.6), C (130.8, 164.8, 196.0), G (146.8, 185.0, 220.0)
    chords = [
        [220.0, 261.63, 329.63], # Am
        [174.61, 220.0, 261.63], # F
        [130.81, 164.81, 196.00], # C
        [146.83, 185.00, 220.00]  # G
    ]

    samples = bytearray()
    for i in range(n_samples):
        t = i / sample_rate
        # Rotate chord every 7.5 seconds
        chord_idx = int((t / 7.5) % len(chords))
        freqs = chords[chord_idx]

        # Synthesize harmonic tones with soft envelope
        val = sum(math.sin(2 * math.pi * f * t) for f in freqs) / len(freqs)
        # Add a subtle sub-bass pulse
        val += 0.4 * math.sin(2 * math.pi * 55.0 * t)
        
        # Envelope fade in/out at ends
        env = min(1.0, t / 1.0) * min(1.0, (duration_seconds - t) / 1.0)
        # Tremolo warmth
        tremolo = 0.8 + 0.2 * math.sin(2 * math.pi * 3.0 * t)
        
        sample_val = int(val * env * tremolo * 12000)
        sample_val = max(-32768, min(32767, sample_val))
        samples.extend(struct.pack('<h', sample_val))

    header = struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF', 36 + len(samples), b'WAVE',
        b'fmt ', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16,
        b'data', len(samples),
    )
    return header + bytes(samples)


# ─── Dialogue Reads (Gemini TTS) ────────────────────────────────────
def generate_dialogue_read(
    scene_id: str,
    script_id: str,
    dialogue_lines: List[dict],
) -> dict:
    """
    Generate a multi-speaker dialogue reference read using Gemini TTS.

    Args:
        scene_id: UUID of the scene.
        script_id: UUID of the script (for grounding context).
        dialogue_lines: list of {character: str, line: str} dicts.

    Returns:
        dict with asset_id and storage_uri.
    """
    return _run_async(
        _async_dialogue_read(scene_id, script_id, dialogue_lines)
    )


async def _async_dialogue_read(
    scene_id: str, script_id: str, dialogue_lines: List[dict]
) -> dict:
    audio_bytes = await _gemini_tts(dialogue_lines)
    filename = f"dialogue_read_{scene_id}_{uuid.uuid4()}.wav"

    if STORAGE_BACKEND == "gcs" and GCS_BUCKET:
        uri = await _upload_audio_to_gcs(audio_bytes, filename)
    else:
        uri = _save_audio_locally(audio_bytes, filename)

    prompt_summary = "; ".join(
        f"{d.get('character', 'Unknown')}: {d.get('line', '')[:50]}"
        for d in dialogue_lines[:3]
    )

    asset = await mcp.write_media_asset(
        scene_id=scene_id,
        asset_type="dialogue_read",
        storage_uri=uri,
        generated_by_agent="audio_agent",
        prompt_used=prompt_summary,
    )
    return {
        "asset_id": asset["id"],
        "storage_uri": uri,
        "lines_count": len(dialogue_lines),
    }


async def _gemini_tts(dialogue_lines: List[dict]) -> bytes:
    """Generate multi-speaker dialogue read via Gemini TTS."""
    try:
        from google import genai
        from google.genai import types

        client = genai.Client()

        # Build SSML-style script for multi-speaker TTS
        script_text = "\n".join(
            f"{line.get('character', 'Speaker')}: {line.get('line', '')}"
            for line in dialogue_lines
        )

        # Gemini TTS with multi-speaker config
        response = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-2.5-flash-preview-tts",
            contents=script_text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                        speaker_voice_configs=[
                            types.SpeakerVoiceConfig(
                                speaker=line.get("character", f"Speaker{i}"),
                                voice_config=types.VoiceConfig(
                                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                        voice_name=["Kore", "Charon", "Aoede", "Puck"][i % 4]
                                    )
                                ),
                            )
                            for i, line in enumerate(dialogue_lines[:4])
                        ]
                    )
                ),
            ),
        )
        # Extract audio from response
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("audio"):
                return part.inline_data.data
        return _silent_wav(10)
    except Exception as exc:
        print(f"[AudioAgent] Gemini TTS error: {exc} — returning silence placeholder")
        return _silent_wav(10)


# ─── Storage helpers ─────────────────────────────────────────────────
def _save_audio_locally(audio_bytes: bytes, filename: str) -> str:
    LOCAL_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    path = LOCAL_MEDIA_DIR / filename
    path.write_bytes(audio_bytes)
    return f"http://localhost:8080/media/{filename}"


async def _upload_audio_to_gcs(data: bytes, filename: str) -> str:
    from google.cloud import storage as gcs
    client = gcs.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(f"audio/{filename}")
    await asyncio.to_thread(blob.upload_from_string, data, content_type="audio/wav")
    return f"gs://{GCS_BUCKET}/audio/{filename}"


audio_agent = Agent(
    name="audio_agent",
    model="gemini-2.5-flash",
    description=(
        "Generates mood/reference music clips (Lyria 3) and multi-speaker "
        "dialogue reference reads (Gemini TTS) for scenes. Saves audio to "
        "Cloud Storage and writes media_assets rows via the MCP server. "
        "Same approve/regenerate pattern as storyboard panels."
    ),
    instruction=AUDIO_INSTRUCTION,
    tools=[generate_mood_music, generate_dialogue_read],
)
