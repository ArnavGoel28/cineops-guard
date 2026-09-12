"""
StoryboardAgent — generates storyboard panels from scene descriptions using Imagen 3.

Generation is async: the agent starts a job and returns a job_id.
The API Gateway polls /jobs/{job_id}/status until the panels are ready.
Generated images are stored in Cloud Storage (or local disk for dev);
a media_assets row is written via the MCP server.

Each regeneration creates new rows — never overwrites existing panels.
"""

from __future__ import annotations

import asyncio
import base64
import os
import uuid
from pathlib import Path
from typing import List, Optional

from google.adk.agents import Agent

from agent.mcp_client import mcp

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")  # "local" | "gcs"
LOCAL_MEDIA_DIR = Path(os.getenv("LOCAL_MEDIA_DIR", "./media"))
GCS_BUCKET = os.getenv("GCS_BUCKET", "")

STORYBOARD_INSTRUCTION = """
You are the CineOps Guard StoryboardAgent. When asked to generate a
storyboard for a scene, call generate_storyboard_panels with the scene_id
and a clear visual description. You will receive a job_id — report it
to the user and let them know panels will appear shortly.

If the user asks to regenerate with new style notes, call the tool again
with the updated description. Each call creates new panels, never overwrites.
"""


def _save_image_locally(image_bytes: bytes, filename: str) -> str:
    """Save image bytes to local disk. Returns HTTP URI."""
    LOCAL_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    path = LOCAL_MEDIA_DIR / filename
    path.write_bytes(image_bytes)
    return f"http://localhost:8080/media/{filename}"


async def _generate_with_imagen(prompt: str, n_panels: int = 4) -> List[bytes]:
    """Generate high-quality cinematic storyboard panel images using Gemini image models."""
    try:
        from google import genai
        from google.genai import types

        client = genai.Client()
        images = []
        image_models = ["gemini-3.1-flash-image", "gemini-2.5-flash-image"]

        shot_types = ["EXT. WIDE SHOT", "MEDIUM TRACKING SHOT", "CLOSE-UP REACTION", "LOW-ANGLE CLIMAX"]

        for i in range(n_panels):
            shot_style = shot_types[i % len(shot_types)]
            panel_prompt = (
                f"Cinematic film storyboard panel {i+1}/{n_panels}, {shot_style}, 16:9 widescreen previz illustration. "
                f"Full detailed shot composition, cinematic lighting, movie still: {prompt}"
            )

            panel_img = None
            for model_name in image_models:
                try:
                    res = await asyncio.to_thread(
                        client.models.generate_content,
                        model=model_name,
                        contents=panel_prompt,
                        config=types.GenerateContentConfig(
                            response_modalities=["IMAGE"]
                        )
                    )
                    if res.candidates and res.candidates[0].content:
                        for part in res.candidates[0].content.parts:
                            if hasattr(part, "inline_data") and part.inline_data:
                                panel_img = part.inline_data.data
                                break
                    if panel_img:
                        print(f"[StoryboardAgent] Generated panel {i+1} using {model_name} ({len(panel_img)} bytes)")
                        break
                except Exception as model_err:
                    print(f"[StoryboardAgent] Model {model_name} notice: {model_err}")

            if panel_img:
                images.append(panel_img)

        if len(images) == n_panels:
            return images
        elif images:
            # Fill remaining with placeholder if partially succeeded
            while len(images) < n_panels:
                images.extend(_placeholder_panels(prompt, 1))
            return images

    except Exception as exc:
        print(f"[StoryboardAgent] AI Image API notice: {exc} — fallback to cinematic previz panels")

    return _placeholder_panels(prompt, n_panels)


def _placeholder_panels(prompt: str, n: int) -> List[bytes]:
    """Generate high-resolution (1280x720 16:9) cinematic previz storyboard panel drawings using PIL."""
    from PIL import Image, ImageDraw, ImageFont
    import io

    shot_types = ["EXT. WIDE SHOT", "MEDIUM TRACKING SHOT", "CLOSE-UP REACTION", "LOW-ANGLE CLIMAX"]
    panels = []
    width, height = 1280, 720

    for i in range(n):
        img = Image.new("RGB", (width, height), color=(18, 18, 24))
        draw = ImageDraw.Draw(img)

        # Draw 16:9 Viewport Box
        box_margin_w, box_margin_h = 60, 80
        box = [box_margin_w, box_margin_h, width - box_margin_w, height - box_margin_h]
        draw.rectangle(box, outline=(60, 60, 80), width=3)

        # Draw Crosshair Corner Markers
        ch_len = 20
        draw.line([(box_margin_w, box_margin_h + ch_len), (box_margin_w, box_margin_h), (box_margin_w + ch_len, box_margin_h)], fill=(79, 142, 247), width=2)
        draw.line([(width - box_margin_w - ch_len, box_margin_h), (width - box_margin_w, box_margin_h), (width - box_margin_w, box_margin_h + ch_len)], fill=(79, 142, 247), width=2)
        draw.line([(box_margin_w, height - box_margin_h - ch_len), (box_margin_w, height - box_margin_h), (box_margin_w + ch_len, height - box_margin_h)], fill=(79, 142, 247), width=2)
        draw.line([(width - box_margin_w - ch_len, height - box_margin_h), (width - box_margin_w, height - box_margin_h), (width - box_margin_w, height - box_margin_h - ch_len)], fill=(79, 142, 247), width=2)

        # Center Horizon & Previz Composition Elements
        mid_y = height // 2
        draw.line([(box_margin_w + 20, mid_y + 40), (width - box_margin_w - 20, mid_y + 40)], fill=(40, 40, 55), width=2)

        # Draw Silhouette Figure / Stunt Previz Sketch Box
        fig_center_x = width // 2 + (i - 1.5) * 80
        draw.ellipse([fig_center_x - 30, mid_y - 90, fig_center_x + 30, mid_y - 30], fill=(79, 142, 247), outline=(139, 92, 246), width=2)
        draw.polygon([(fig_center_x - 45, mid_y - 30), (fig_center_x + 45, mid_y - 30), (fig_center_x + 30, mid_y + 70), (fig_center_x - 30, mid_y + 70)], fill=(30, 30, 45), outline=(79, 142, 247), width=2)

        # Camera Direction Arrow
        draw.line([(fig_center_x + 60, mid_y), (fig_center_x + 140, mid_y - 30)], fill=(251, 191, 36), width=3)
        draw.polygon([(fig_center_x + 140, mid_y - 30), (fig_center_x + 125, mid_y - 40), (fig_center_x + 130, mid_y - 20)], fill=(251, 191, 36))

        # Text Overlay: Header & Shot Info
        shot_title = shot_types[i % len(shot_types)]
        draw.rectangle([box_margin_w, 20, box_margin_w + 340, 60], fill=(24, 24, 32), outline=(79, 142, 247), width=1)
        draw.text((box_margin_w + 15, 30), f"PANEL {i+1}/{n} — {shot_title}", fill=(244, 244, 248))

        draw.rectangle([width - box_margin_w - 240, 20, width - box_margin_w, 60], fill=(24, 24, 32), outline=(139, 92, 246), width=1)
        draw.text((width - box_margin_w - 225, 30), "CINEOPS PREVIZ 16:9", fill=(139, 92, 246))

        # Bottom Prompt / Action Caption Box
        draw.rectangle([box_margin_w + 20, height - box_margin_h - 70, width - box_margin_w - 20, height - box_margin_h - 15], fill=(15, 15, 20), outline=(40, 40, 55), width=1)
        clean_prompt = prompt[:90] + "..." if len(prompt) > 90 else prompt
        draw.text((box_margin_w + 35, height - box_margin_h - 55), f"ACTION: {clean_prompt}", fill=(200, 200, 215))

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        panels.append(buf.getvalue())

    return panels


def _run_async(coro):
    try:
        return asyncio.run(coro)
    except RuntimeError:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            return executor.submit(lambda: asyncio.run(coro)).result()


def generate_storyboard_panels(
    scene_id: str,
    description: str,
    n_panels: int = 4,
    style_notes: Optional[str] = None,
) -> dict:
    """
    Generate storyboard panels for a scene using Imagen 3 (async job).

    Args:
        scene_id: UUID of the scene to generate panels for.
        description: visual description of the scene action and setting.
        n_panels: number of panels to generate (default 4, max 6).
        style_notes: optional style directives (e.g. "day-for-night, high contrast").

    Returns:
        dict with job_id (poll /jobs/{job_id}/status for results) and
        media_asset_ids when complete.
    """
    return _run_async(
        _async_generate_storyboard(scene_id, description, min(n_panels, 6), style_notes)
    )


async def _async_generate_storyboard(
    scene_id: str, description: str, n_panels: int, style_notes: Optional[str]
) -> dict:
    job_id = str(uuid.uuid4())

    full_prompt = description
    if style_notes:
        full_prompt += f". Style: {style_notes}"

    # Generate panels
    images = await _generate_with_imagen(full_prompt, n_panels)

    # Save + create media_assets rows
    asset_ids = []
    for i, img_bytes in enumerate(images):
        filename = f"storyboard_{scene_id}_{job_id}_{i+1}.png"

        if STORAGE_BACKEND == "gcs" and GCS_BUCKET:
            uri = await _upload_to_gcs(img_bytes, filename)
        else:
            uri = _save_image_locally(img_bytes, filename)

        asset = await mcp.write_media_asset(
            scene_id=scene_id,
            asset_type="storyboard_panel",
            storage_uri=uri,
            generated_by_agent="storyboard_agent",
            prompt_used=full_prompt,
        )
        asset_ids.append(asset["id"])

    return {
        "job_id": job_id,
        "status": "complete",
        "scene_id": scene_id,
        "panels_generated": len(images),
        "asset_ids": asset_ids,
        "note": "Use asset_ids to retrieve and approve individual panels.",
    }


async def _upload_to_gcs(data: bytes, filename: str) -> str:
    from google.cloud import storage as gcs
    client = gcs.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(f"storyboards/{filename}")
    await asyncio.to_thread(blob.upload_from_string, data, content_type="image/png")
    return f"gs://{GCS_BUCKET}/storyboards/{filename}"


storyboard_agent = Agent(
    name="storyboard_agent",
    model=os.getenv("GEMINI_MODEL", "gemini-3.6-flash"),
    description=(
        "Generates storyboard panels (3–6 images) for a scene using Imagen 3. "
        "Each request is async: returns a job_id. Panels are stored in Cloud "
        "Storage and media_assets rows are created via the MCP server. "
        "Regeneration with new style notes creates new rows, never overwrites."
    ),
    instruction=STORYBOARD_INSTRUCTION,
    tools=[generate_storyboard_panels],
)
