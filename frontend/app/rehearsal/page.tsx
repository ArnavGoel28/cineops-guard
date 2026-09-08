"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { listRehearsalSessions, startRehearsalSession, listScenes, listActorProfiles } from "@/lib/api";
import { Mic, MicOff, Square, Clock, ChevronRight, FileText, Film, MapPin, Sparkles, BookOpen, User, Volume2, PauseCircle, Play, ChevronLeft, VolumeX } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";

import { useProject } from "@/components/ProjectContext";

const WS_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/^http/, "ws");

// ─── Gender-based voice selection helper ──────────────────────────────
// Common female names for Indian cinema scripts — extend as needed
const FEMALE_NAMES = new Set([
  "PRIYA", "ANANYA", "MEERA", "KAVYA", "SITA", "RADHA", "LAKSHMI", "NISHA",
  "DIVYA", "ANJALI", "POOJA", "RIYA", "NEHA", "SNEHA", "MAYA", "TARA",
  "ISHA", "SUNITA", "REKHA", "RANI", "DEEPA", "GEETA", "SHALINI", "AISHA",
  "FATIMA", "ZARA", "SAIRA", "NINA", "LATA", "PADMA", "DURGA", "RUHI",
  "OFFICER_F", "DOCTOR_F", "NURSE", "MOTHER", "SISTER", "WIFE", "GIRLFRIEND",
  "INSPECTOR_F", "SARAH", "MARIA", "EMMA", "OLIVIA", "SOPHIA", "ELENA",
]);

function inferGender(speakerName: string, actorProfiles: any[]): "male" | "female" {
  const upper = (speakerName || "").toUpperCase().trim();
  if (FEMALE_NAMES.has(upper)) return "female";
  // Check actor profile bio_notes for gender hints
  const profile = actorProfiles.find(
    (p: any) => p.character_name?.toUpperCase() === upper
  );
  if (profile?.bio_notes) {
    const bio = profile.bio_notes.toLowerCase();
    if (bio.includes("female") || bio.includes("woman") || bio.includes("she ") || bio.includes("actress") || bio.includes("heroine")) {
      return "female";
    }
  }
  return "male"; // default
}

function selectVoiceForGender(
  gender: "male" | "female",
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  const enVoices = voices.filter(v => v.lang.startsWith("en"));
  if (gender === "female") {
    // Prefer female-sounding voices
    return (
      enVoices.find(v => /zira|female|samantha|fiona|karen|moira|tessa|victoria/i.test(v.name)) ||
      enVoices.find(v => /google.*female|microsoft.*zira/i.test(v.name)) ||
      enVoices.find(v => v.name.includes("Google")) ||
      enVoices[1] || // second voice is often female on many systems
      voices[1] ||
      null
    );
  }
  // Male
  return (
    enVoices.find(v => /david|male|mark|daniel|james|google uk english male/i.test(v.name)) ||
    enVoices.find(v => v.name.includes("Google")) ||
    enVoices[0] ||
    voices[0] ||
    null
  );
}

export default function RehearsalPage() {
  const { activeProjectId: productionId } = useProject();

  const { data: scenes = [] } = useQuery({
    queryKey: ["scenes", productionId],
    queryFn: () => listScenes({ production_id: productionId }),
    enabled: !!productionId,
  });

  const { data: actorProfiles = [] } = useQuery({
    queryKey: ["actor-profiles", productionId],
    queryFn: () => listActorProfiles(productionId),
    enabled: !!productionId,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["rehearsal-sessions"],
    queryFn: () => listRehearsalSessions(),
    refetchInterval: 10_000,
  });

  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState<string>("ARJUN");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState<{ role: string; text: string }[]>([]);
  const [summary, setSummary] = useState("");
  const [activeLineIndex, setActiveLineIndex] = useState<number>(0);
  const [isPlayingTTS, setIsPlayingTTS] = useState<boolean>(false);
  // Word-by-word highlighting state
  const [activeWordIndex, setActiveWordIndex] = useState<number>(-1);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);

  // Load voices on mount
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) setVoicesLoaded(true);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Get currently selected scene object
  const selectedScene = scenes.find(s => s.id === selectedSceneId);

  // Auto-select first scene if available
  useEffect(() => {
    if (scenes.length > 0 && !selectedSceneId) {
      setSelectedSceneId(scenes[0].id);
    }
  }, [scenes, selectedSceneId]);

  // Available characters in selected scene
  const availableCharacters = selectedScene?.characters && selectedScene.characters.length > 0
    ? selectedScene.characters
    : actorProfiles.map(p => p.character_name).filter(Boolean);

  // Auto-select character when scene changes
  useEffect(() => {
    if (availableCharacters.length > 0 && (!selectedCharacter || !availableCharacters.includes(selectedCharacter))) {
      setSelectedCharacter(availableCharacters[0]);
    }
  }, [selectedSceneId, availableCharacters, selectedCharacter]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [transcript]);

  // Scroll active line into view
  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeLineIndex]);

  // Scroll active word into view during TTS
  useEffect(() => {
    if (activeWordRef.current) {
      activeWordRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [activeWordIndex]);

  const startSession = useMutation({
    mutationFn: () => startRehearsalSession(selectedSceneId),
    onSuccess: (session) => {
      setSessionId(session.id);
      setTranscript([]);
      setSummary("");
      setActiveLineIndex(0);
      setActiveWordIndex(-1);

      // Open WebSocket with character query param
      const encodedChar = encodeURIComponent(selectedCharacter);
      const ws = new WebSocket(`${WS_URL}/ws/rehearsal/${session.id}?actor_character=${encodedChar}`);
      wsRef.current = ws;

      ws.onopen = () => setIsLive(true);
      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "session_end") {
              setSummary(msg.summary || "");
              if (msg.transcript) {
                setTranscript(t => [...t, ...((msg.transcript as string).split("\n").filter(Boolean).map(line => {
                  const [role, ...rest] = line.split(": ");
                  return { role: role || "Actor", text: rest.join(": ") || line };
                }))]);
              }
              setIsLive(false);
            }
          } catch {}
        }
      };
      ws.onclose = () => { setIsLive(false); setListening(false); };
    },
  });

  const endSession = () => {
    wsRef.current?.send(JSON.stringify({ type: "end" }));
    wsRef.current?.close();
    setIsLive(false);
    setListening(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlayingTTS(false);
    setActiveWordIndex(-1);
  };

  const toggleMic = async () => {
    if (!isLive || !wsRef.current) return;
    if (!listening) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(e.data);
        };
        recorder.start(100);
        setListening(true);
        (wsRef.current as any)._recorder = recorder;
        (wsRef.current as any)._stream = stream;
      } catch (e) {
        alert("Microphone access denied");
      }
    } else {
      const recorder = (wsRef.current as any)._recorder as MediaRecorder;
      const stream = (wsRef.current as any)._stream as MediaStream;
      recorder?.stop();
      stream?.getTracks().forEach(t => t.stop());
      setListening(false);
    }
  };

  // ─── Enhanced TTS Engine with word-by-word highlighting & gender voices ────
  const speakLineTTS = useCallback((text: string, speaker: string, onEndCallback?: () => void, explicitGender?: "male" | "female") => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("Speech synthesis is not supported in this browser.");
      return;
    }

    window.speechSynthesis.cancel();
    setActiveWordIndex(-1);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;

    // Gender-based voice & pitch selection — use explicit gender if provided
    const gender = explicitGender || inferGender(speaker, actorProfiles);
    utterance.pitch = gender === "female" ? 1.15 : 0.85;

    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = selectVoiceForGender(gender, voices);
    if (selectedVoice) utterance.voice = selectedVoice;

    // Split text into words for tracking
    const words = text.split(/\s+/);

    // Word boundary event — fires for each word spoken
    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      if (event.name === "word") {
        // Calculate word index from character offset
        const charIndex = event.charIndex;
        let wordIdx = 0;
        let pos = 0;
        for (let i = 0; i < words.length; i++) {
          // Find the start position of this word in the original text
          const wordStart = text.indexOf(words[i], pos);
          if (wordStart <= charIndex && charIndex < wordStart + words[i].length + 1) {
            wordIdx = i;
            break;
          }
          pos = wordStart + words[i].length;
          wordIdx = i;
        }
        setActiveWordIndex(wordIdx);
      }
    };

    setIsPlayingTTS(true);
    utterance.onend = () => {
      setIsPlayingTTS(false);
      // Keep last word highlighted briefly, then clear
      setTimeout(() => setActiveWordIndex(-1), 400);
      if (onEndCallback) onEndCallback();
    };
    utterance.onerror = () => {
      setIsPlayingTTS(false);
      setActiveWordIndex(-1);
    };

    window.speechSynthesis.speak(utterance);
  }, [actorProfiles]);

  const stopTTS = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlayingTTS(false);
    setActiveWordIndex(-1);
  };

  const dialogueLines = selectedScene?.dialogue_script && selectedScene.dialogue_script.length > 0
    ? selectedScene.dialogue_script
    : [];

  const handleNextLine = useCallback(() => {
    if (dialogueLines.length > 0) {
      const nextIdx = (activeLineIndex + 1) % dialogueLines.length;
      setActiveLineIndex(nextIdx);
      setActiveWordIndex(-1);
      const line = dialogueLines[nextIdx];
      if (line && line.speaker?.toUpperCase() !== selectedCharacter?.toUpperCase() && line.speaker?.toUpperCase() !== "ACTION") {
        // Auto-speak opposing character lines with gender-appropriate voice
        const lineGender = line.gender === "female" ? "female" : line.gender === "male" ? "male" : undefined;
        speakLineTTS(line.text, line.speaker, undefined, lineGender);
      }
    }
  }, [activeLineIndex, dialogueLines, selectedCharacter, speakLineTTS]);

  const handlePrevLine = () => {
    if (dialogueLines.length > 0) {
      const prevIdx = activeLineIndex > 0 ? activeLineIndex - 1 : dialogueLines.length - 1;
      setActiveLineIndex(prevIdx);
      setActiveWordIndex(-1);
    }
  };

  return (
    <div className="p-6 space-y-6 fade-in max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-[#f4f4f8]">Rehearsal Room & Teleprompter</h1>
        <p className="text-sm text-[#9898a8] mt-0.5">
          Select your character role, read synchronized lines from the highlighted teleprompter, and rehearse live with your AI scene partner via Gemini Live API.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column: Teleprompter & Controls (3 Cols) */}
        <div className="lg:col-span-3 space-y-5">
          {/* Scene & Character Selector Bar */}
          <div className="rounded-2xl border border-[#27272f] bg-[#111118] p-5 space-y-4 shadow-xl">
            <div className="space-y-2">
              <label className="block text-xs font-mono text-[#a1a1aa] uppercase font-semibold">
                1. Select Scene to Rehearse
              </label>
              <select
                value={selectedSceneId}
                onChange={e => {
                  setSelectedSceneId(e.target.value);
                  setActiveLineIndex(0);
                }}
                className="w-full bg-[#18181f] border border-[#27272f] rounded-xl px-3.5 py-2.5 text-sm text-[#f4f4f8] focus:outline-none focus:border-violet-500 font-medium"
              >
                <option value="">Choose a scene from project...</option>
                {scenes.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.scene_number} — {s.header || s.description.slice(0, 50)}
                  </option>
                ))}
              </select>
            </div>

            {/* Character Selection Pills */}
            <div className="space-y-2 pt-1 border-t border-[#22222e]">
              <label className="block text-xs font-mono text-[#a1a1aa] uppercase font-semibold">
                2. Select Your Character Role (You will speak these lines)
              </label>
              {availableCharacters.length === 0 ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Enter character name (e.g. ARJUN)..."
                    value={selectedCharacter}
                    onChange={e => setSelectedCharacter(e.target.value)}
                    className="bg-[#18181f] border border-[#27272f] rounded-lg px-3 py-2 text-xs text-[#f4f4f8] focus:outline-none focus:border-violet-500"
                  />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {availableCharacters.map(char => {
                    const isSelected = selectedCharacter.toUpperCase() === char.toUpperCase();
                    return (
                      <button
                        key={char}
                        onClick={() => setSelectedCharacter(char)}
                        className={cn(
                          "px-4 py-2 rounded-xl font-mono text-xs font-bold border transition-all flex items-center gap-2 shadow-md",
                          isSelected
                            ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400 shadow-emerald-600/30 scale-105"
                            : "bg-[#181820] text-[#a1a1aa] border-[#27272f] hover:bg-[#20202c] hover:text-[#f4f4f8]"
                        )}
                      >
                        <User className="w-3.5 h-3.5" />
                        <span>{char}</span>
                        {isSelected && <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping" />}
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="text-[11px] text-[#71717a] font-mono pt-1">
                🎭 You are rehearsing as <strong className="text-emerald-400 font-bold">{selectedCharacter}</strong>. AI partner voices opposing characters out loud via TTS.
              </p>
            </div>
          </div>

          {/* INTERACTIVE SYNCHRONIZED TELEPROMPTER WITH HIGHLIGHTED ACTIVE LINE */}
          {selectedScene && (
            <div className="rounded-2xl border border-violet-500/40 bg-[#111118] p-5 space-y-4 shadow-2xl">
              {/* Header Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#242432] pb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-violet-400 shrink-0" />
                  <span className="text-xs uppercase font-mono font-bold text-violet-300 tracking-wider">
                    Interactive Teleprompter — Synchronized Line Guide
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-violet-400 bg-violet-500/10 px-2.5 py-0.5 rounded-md border border-violet-500/20">
                    {selectedScene.scene_number}
                  </span>
                  <span className="text-xs font-mono px-2.5 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold">
                    {selectedScene.stunt_type || "practical_effect"}
                  </span>
                </div>
              </div>

              {/* Scene Slugline Header */}
              {selectedScene.header && (
                <div className="text-xs font-mono font-bold text-violet-200 bg-[#09090e] px-3.5 py-2.5 rounded-xl border border-[#1e1e2d] flex items-center gap-2">
                  <Film className="w-4 h-4 text-violet-400 shrink-0" />
                  <span>{selectedScene.header}</span>
                </div>
              )}

              {/* Teleprompter Navigation & Audio Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#09090e] p-2.5 rounded-xl border border-[#20202e]">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePrevLine}
                    className="px-3 py-1.5 rounded-lg bg-[#181820] hover:bg-[#222230] text-xs font-mono text-[#f4f4f8] border border-[#27272f] flex items-center gap-1 transition-all"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Prev Line
                  </button>
                  <button
                    onClick={handleNextLine}
                    className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-mono text-white font-semibold flex items-center gap-1 shadow-md shadow-violet-600/20 transition-all"
                  >
                    Next Line <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {isPlayingTTS ? (
                    <button
                      onClick={stopTTS}
                      className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-mono font-semibold flex items-center gap-1.5"
                    >
                      <VolumeX className="w-3.5 h-3.5" /> Stop TTS
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const line = dialogueLines[activeLineIndex];
                        if (line) {
                          const btnGender = line.gender === "female" ? "female" : line.gender === "male" ? "male" : undefined;
                          speakLineTTS(line.text, line.speaker, undefined, btnGender);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 text-xs font-mono font-semibold flex items-center gap-1.5 transition-all"
                    >
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> Play Line TTS
                    </button>
                  )}
                  <span className="text-[11px] font-mono text-[#71717a] px-2">
                    Line {activeLineIndex + 1} of {dialogueLines.length || 1}
                  </span>
                </div>
              </div>

              {/* Line-by-Line Formatted Dialogue Teleprompter Viewport */}
              <div className="bg-[#06060a] border border-[#1f1f2e] rounded-xl p-4 space-y-4 max-h-[380px] overflow-y-auto pr-1">
                {dialogueLines.length > 0 ? (
                  dialogueLines.map((line: any, idx: number) => {
                    const isMyTurn = line.speaker?.toUpperCase() === selectedCharacter?.toUpperCase();
                    const isAction = line.speaker?.toUpperCase() === "ACTION";
                    const isCurrentLine = activeLineIndex === idx;

                    return (
                      <div
                        key={idx}
                        ref={isCurrentLine ? activeLineRef : null}
                        onClick={() => {
                          setActiveLineIndex(idx);
                          setActiveWordIndex(-1);
                          if (!isMyTurn && !isAction) {
                            const clickGender = line.gender === "female" ? "female" : line.gender === "male" ? "male" : undefined;
                            speakLineTTS(line.text, line.speaker, undefined, clickGender);
                          }
                        }}
                        className={cn(
                          "p-4 rounded-xl border transition-all cursor-pointer font-mono space-y-2 relative overflow-hidden",
                          isCurrentLine
                            ? (isMyTurn
                              ? "border-2 border-emerald-400 bg-emerald-950/40 shadow-[0_0_30px_rgba(16,185,129,0.35)] ring-2 ring-emerald-500/40 scale-[1.01]"
                              : isAction
                              ? "border-2 border-amber-400 bg-amber-950/30 shadow-[0_0_20px_rgba(245,158,11,0.25)] ring-2 ring-amber-500/30 scale-[1.01]"
                              : "border-2 border-violet-400 bg-violet-950/40 shadow-[0_0_30px_rgba(139,92,246,0.35)] ring-2 ring-violet-500/40 scale-[1.01]"
                              )
                            : "border-[#1c1c28] bg-[#0e0e16] opacity-75 hover:opacity-100 hover:border-[#2a2a3e]"
                        )}
                      >
                        {/* Glowing Indicator bar for active line */}
                        {isCurrentLine && (
                          <div className={cn("absolute left-0 top-0 bottom-0 w-1.5", isMyTurn ? "bg-emerald-400 animate-pulse" : isAction ? "bg-amber-400" : "bg-violet-400 animate-pulse")} />
                        )}

                        <div className="flex items-center justify-between text-xs pl-1">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "font-bold uppercase tracking-wider text-xs px-2.5 py-1 rounded-md font-mono",
                              isMyTurn
                                ? "bg-emerald-500/30 text-emerald-200 border border-emerald-400"
                                : isAction
                                ? "bg-zinc-800 text-amber-300 border border-amber-500/30"
                                : "bg-violet-500/30 text-violet-200 border border-violet-400"
                            )}>
                              {line.speaker}
                            </span>

                            {isMyTurn && isCurrentLine && (
                              <span className="text-[11px] bg-emerald-500/30 text-emerald-300 border border-emerald-400/50 px-2 py-0.5 rounded-md font-sans font-bold flex items-center gap-1.5 animate-pulse">
                                <Mic className="w-3.5 h-3.5 text-emerald-400" /> YOUR TURN — SPEAK OUT LOUD
                              </span>
                            )}
                            {!isMyTurn && !isAction && isCurrentLine && (() => {
                              const speakerGender = (line.gender === "female" || line.gender === "male") ? line.gender : inferGender(line.speaker, actorProfiles);
                              const totalWords = (line.text || "").split(/\s+/).filter(Boolean).length;
                              return (
                                <span className="text-[11px] bg-violet-500/30 text-violet-200 border border-violet-400/50 px-2 py-0.5 rounded-md font-sans font-semibold flex items-center gap-1.5">
                                  <Volume2 className="w-3.5 h-3.5 text-violet-400 animate-bounce" />
                                  {isPlayingTTS ? (
                                    <>AI SPEAKING {speakerGender === "female" ? "♀" : "♂"} · Word {Math.min(activeWordIndex + 1, totalWords)}/{totalWords}</>
                                  ) : (
                                    <>AI TTS {speakerGender === "female" ? "♀" : "♂"} READY</>
                                  )}
                                </span>
                              );
                            })()}
                          </div>

                          {line.pause_hint && (
                            <span className="text-[11px] text-amber-300 bg-amber-500/15 px-2.5 py-1 rounded-md border border-amber-500/30 font-semibold flex items-center gap-1.5">
                              <PauseCircle className="w-3.5 h-3.5 text-amber-400" /> {line.pause_hint}
                            </span>
                          )}
                        </div>

                        <div className={cn(
                          "text-sm md:text-base leading-[2.2] pl-1 pt-1 font-mono font-medium flex flex-wrap gap-x-[5px]",
                          isCurrentLine ? "text-white font-bold" : "text-[#d1d1e0]"
                        )}>
                          {(() => {
                            const words = (line.text || "").split(/\s+/).filter(Boolean);
                            const isTTSActive = isPlayingTTS && isCurrentLine && !isMyTurn && activeWordIndex >= 0;

                            return words.map((word: string, wIdx: number) => {
                              const isActiveWord = isTTSActive && wIdx === activeWordIndex;
                              const isSpokenWord = isTTSActive && wIdx < activeWordIndex;
                              const isUpcoming = isTTSActive && wIdx > activeWordIndex;

                              return (
                                <span
                                  key={wIdx}
                                  ref={isActiveWord ? activeWordRef : null}
                                  className={cn(
                                    "inline-block transition-all duration-200 ease-out rounded-md px-[3px] py-[1px]",
                                    isActiveWord
                                      ? "bg-gradient-to-r from-violet-500/60 via-fuchsia-500/50 to-violet-500/60 text-white scale-[1.18] font-black shadow-[0_0_20px_rgba(139,92,246,0.7),0_0_40px_rgba(217,70,239,0.4)] ring-1 ring-violet-400/60 -translate-y-[2px]"
                                      : isSpokenWord
                                      ? "text-violet-300/70 scale-100"
                                      : isUpcoming
                                      ? "text-[#9898a8]/80 scale-100"
                                      : ""
                                  )}
                                  style={isActiveWord ? {
                                    textShadow: "0 0 12px rgba(167, 139, 250, 0.9), 0 0 24px rgba(192, 132, 252, 0.5)",
                                    animation: "wordPulse 0.6s ease-in-out infinite alternate",
                                  } : undefined}
                                >
                                  {word}
                                </span>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-xs md:text-sm text-[#f4f4f8] whitespace-pre-wrap leading-relaxed">
                    {selectedScene.description || "No script description available."}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Voice Session Controls Panel */}
          {!isLive && !summary ? (
            <button
              onClick={() => startSession.mutate()}
              disabled={!selectedSceneId || startSession.isPending}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-bold text-sm disabled:opacity-50 transition-all shadow-xl shadow-violet-600/30"
            >
              <Mic className="w-5 h-5" />
              {startSession.isPending ? "Connecting to Gemini Live API..." : `Start Rehearsal as ${selectedCharacter}`}
            </button>
          ) : (
            <div className={cn("rounded-2xl border p-5 space-y-4 shadow-xl", isLive ? "border-violet-500/50 bg-[#111118]" : "border-[#27272f] bg-[#111118]")}>
              {/* Waveform indicator */}
              {isLive && (
                <div className="flex items-center justify-center gap-1.5 h-10">
                  {[...Array(7)].map((_, i) => (
                    <div
                      key={i}
                      className={cn("w-1.5 bg-violet-500 rounded-full transition-all", listening ? "animate-pulse" : "h-1.5")}
                      style={{ height: listening ? `${16 + (i % 4) * 8}px` : "6px" }}
                    />
                  ))}
                </div>
              )}

              {/* Status Indicator */}
              <div className="flex items-center justify-center gap-2">
                <span className={cn("w-2.5 h-2.5 rounded-full", isLive ? (listening ? "bg-red-400 animate-pulse" : "bg-emerald-400") : "bg-zinc-600")} />
                <span className="text-xs font-medium text-[#f4f4f8]">
                  {isLive ? (listening ? `Listening — Speak lines for ${selectedCharacter}...` : `Connected — Click Mic to Speak as ${selectedCharacter}`) : "Session Ended"}
                </span>
              </div>

              {/* Mic & End Session Controls */}
              {isLive && (
                <div className="flex items-center justify-center gap-4 pt-1">
                  <button
                    onClick={toggleMic}
                    className={cn(
                      "w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg",
                      listening
                        ? "bg-red-500 hover:bg-red-600 shadow-red-500/30 text-white"
                        : "bg-violet-600 hover:bg-violet-500 text-white shadow-violet-600/30"
                    )}
                    title={listening ? "Mute Mic" : "Start Speaking Lines"}
                  >
                    {listening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  </button>
                  <button
                    onClick={endSession}
                    className="w-10 h-10 rounded-full bg-[#18181f] hover:bg-red-500/20 border border-[#27272f] flex items-center justify-center transition-colors"
                    title="End Session"
                  >
                    <Square className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Coaching summary */}
          {summary && (
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 fade-in">
              <p className="text-xs text-violet-400 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-violet-400" /> AI Coaching & Performance Notes
              </p>
              <p className="text-xs md:text-sm text-[#f4f4f8] leading-relaxed whitespace-pre-line font-sans">{summary}</p>
            </div>
          )}
        </div>

        {/* Right Column: Past Rehearsal Sessions (2 Cols) */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-[#27272f] bg-[#111118] overflow-hidden sticky top-6">
            <div className="px-4 py-3 border-b border-[#27272f] text-xs uppercase font-mono font-bold text-[#f4f4f8] tracking-wider">
              Past Rehearsal Sessions
            </div>
            {sessions.length === 0 ? (
              <div className="p-6 text-center text-[#5a5a6e] text-xs font-mono">No rehearsal sessions logged yet</div>
            ) : (
              <div className="divide-y divide-[#1d1d24] max-h-[600px] overflow-y-auto">
                {sessions.map(s => (
                  <div key={s.id} className="px-4 py-3 space-y-1.5 hover:bg-[#161622] transition-colors">
                    <div className="flex items-center gap-2">
                      <Mic className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                      <span className="text-xs text-violet-300 font-mono font-semibold">{s.scene_id.slice(0, 12)}</span>
                      {s.ended_at && (
                        <span className="ml-auto text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono font-semibold">
                          Completed
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#5a5a6e] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDateTime(s.started_at)}
                    </p>
                    {s.summary && <p className="text-xs text-[#9898a8] leading-normal line-clamp-2">{s.summary}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
