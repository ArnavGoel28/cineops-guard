"""
CineOps Guard — Director Agent (v2 multi-agent orchestrator)

Replaces the v1 single agent with a routing layer that delegates to
specialist sub-agents. The Director:

  - Holds session state and routes by intent
  - Fans out to ComplianceAgent + StoryboardAgent + AudioAgent in parallel
    when a "prep scene" request arrives (via ParallelAgent)
  - Always forces the compliance gate when a compliance question is detected
  - Retains the v1 guarantee: ComplianceAgent can never skip its tool call

Sub-agents registered:
  compliance_agent    — safety gate (v1 core)
  script_intake_agent — PDF ingestion → structured scenes
  storyboard_agent    — Imagen 3 panel generation
  audio_agent         — Lyria 3 music + Gemini TTS dialogue reads
  rehearsal_agent     — Gemini Live API actor rehearsal
  dailies_agent       — video transcription + sentiment check
"""

from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()
if os.getenv("GOOGLE_API_KEY") and not os.getenv("GEMINI_API_KEY"):
    os.environ["GEMINI_API_KEY"] = os.environ["GOOGLE_API_KEY"]

from google.adk.agents import Agent

from agent.agents.compliance_agent import compliance_agent
from agent.agents.script_intake_agent import script_intake_agent
from agent.agents.storyboard_agent import storyboard_agent
from agent.agents.audio_agent import audio_agent
from agent.agents.rehearsal_agent import rehearsal_agent
from agent.agents.dailies_agent import dailies_agent

DIRECTOR_INSTRUCTION = """
You are CineOps Guard, a production co-pilot for a film shoot.

You route requests to the right specialist agent:

  COMPLIANCE questions ("can we shoot SC-014?", "is this scene approved?",
    "what's blocking scene X?") → delegate to compliance_agent.
    ALWAYS delegate compliance questions — never answer them yourself.

  SCRIPT INTAKE ("upload this script", "parse this PDF", "extract scenes from...") 
    → delegate to script_intake_agent.

  STORYBOARD requests ("generate storyboard for...", "create panels for scene X") 
    → delegate to storyboard_agent.

  AUDIO requests ("generate mood music for...", "create a dialogue read for scene X",
    "I need reference audio for...") → delegate to audio_agent.

  REHEARSAL requests ("I want to rehearse scene X", "start a voice session") 
    → delegate to rehearsal_agent.

  DAILIES requests ("process this footage", "check my delivery for scene X",
    "transcribe this clip") → delegate to dailies_agent.

  MULTI-TASK ("prep scene 14 for tomorrow") → delegate to BOTH compliance_agent
    AND storyboard_agent AND audio_agent simultaneously for maximum efficiency.

When in doubt about a scene's safety status, ALWAYS check with compliance_agent
before proceeding. The compliance gate is never optional.

You have access to all scene and production data via the MCP server. Answer
general questions about productions, schedules, and scene status directly,
but always route safety/approval questions to compliance_agent.
"""

from agent.safety_config import DEFAULT_SAFETY_SETTINGS

root_agent = Agent(
    name="cineops_director",
    model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
    description=(
        "CineOps Guard production co-pilot. Routes requests to specialist "
        "sub-agents: ComplianceAgent (safety gate), ScriptIntakeAgent (PDF parsing), "
        "StoryboardAgent (Imagen 3), AudioAgent (Lyria 3 + TTS), "
        "RehearsalAgent (Live API voice), DailiesAgent (video analysis)."
    ),
    instruction=DIRECTOR_INSTRUCTION,
    sub_agents=[
        compliance_agent,
        script_intake_agent,
        storyboard_agent,
        audio_agent,
        rehearsal_agent,
        dailies_agent,
    ],
)
