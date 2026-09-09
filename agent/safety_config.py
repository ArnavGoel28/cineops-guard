"""
CineOps Guard — Gemini Safety Settings & Guardrails Config

Defines safety thresholds for ADK agents across standard harm categories:
  - HATE_SPEECH
  - HARASSMENT
  - DANGEROUS_CONTENT
  - SEXUALLY_EXPLICIT
"""

from __future__ import annotations

from google.genai import types

# Default safety settings across all CineOps Guard ADK agents
DEFAULT_SAFETY_SETTINGS = [
    types.SafetySetting(
        category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    ),
    types.SafetySetting(
        category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    ),
    types.SafetySetting(
        category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH,  # Allow realistic stunt descriptions while blocking high real-world danger
    ),
    types.SafetySetting(
        category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold=types.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    ),
]
