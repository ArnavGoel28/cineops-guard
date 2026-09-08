"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  predictBoxOfficeROI,
  BoxOfficePredictionInput,
  BoxOfficePredictionResult,
} from "@/lib/api";
import {
  TrendingUp,
  DollarSign,
  Calendar,
  Sparkles,
  ShieldAlert,
  Film,
  Award,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Flame,
  PieChart,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BoxOfficePredictorModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName?: string;
}

const ALL_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Drama",
  "Horror",
  "Romance",
  "Science Fiction",
  "Thriller",
];

export function BoxOfficePredictorModal({
  isOpen,
  onClose,
  projectName = "Active Project",
}: BoxOfficePredictorModalProps) {
  const [budget, setBudget] = useState<number>(45000000);
  const [releaseMonth, setReleaseMonth] = useState<number>(6); // June
  const [genres, setGenres] = useState<string[]>(["Action", "Science Fiction"]);
  const [runtime, setRuntime] = useState<number>(115);
  const [isFranchise, setIsFranchise] = useState<boolean>(false);
  const [hasHomepage, setHasHomepage] = useState<boolean>(true);
  const [stuntCount, setStuntCount] = useState<number>(3);
  const [hasHighStunt, setHasHighStunt] = useState<boolean>(true);
  const [directorTier, setDirectorTier] = useState<
    "top_tier" | "mid_tier" | "indie" | "debut"
  >("mid_tier");
  const [castTier, setCastTier] = useState<
    "superstar" | "established" | "rising" | "unknown"
  >("established");
  const [studioTier, setStudioTier] = useState<
    "major_studio" | "mid_major" | "indie"
  >("major_studio");
  const [overview, setOverview] = useState<string>(
    "A high-stakes thriller featuring intense vehicle chases and rooftop stunt sequences."
  );

  const [result, setResult] = useState<BoxOfficePredictionResult | null>(null);

  const mutation = useMutation({
    mutationFn: (input: BoxOfficePredictionInput) => predictBoxOfficeROI(input),
    onSuccess: (data) => {
      setResult(data);
    },
  });

  if (!isOpen) return null;

  const toggleGenre = (g: string) => {
    setGenres((prev) =>
      prev.includes(g) ? prev.filter((item) => item !== g) : [...prev, g]
    );
  };

  const handlePredict = () => {
    mutation.mutate({
      budget,
      release_month: releaseMonth,
      genres,
      runtime,
      is_franchise: isFranchise,
      has_homepage: hasHomepage,
      stunt_count: stuntCount,
      has_high_impact_stunt: hasHighStunt,
      director_tier: directorTier,
      lead_cast_tier: castTier,
      production_company_tier: studioTier,
      script_overview: overview,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#111118] border border-[#27272f] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272f] bg-[#161622]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#f4f4f8] flex items-center gap-2">
                Box Office Revenue & ROI Predictor
                <span className="text-xs font-mono font-normal px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  ML GBDT Model
                </span>
              </h2>
              <p className="text-xs text-[#a1a1aa]">
                Historical statistical & NLP prediction framework for {projectName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#71717a] hover:text-[#f4f4f8] hover:bg-[#27272f] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Input Controls Panel */}
            <div className="space-y-4 bg-[#181824] p-4 rounded-xl border border-[#27272f]">
              <h3 className="text-sm font-semibold text-[#f4f4f8] border-b border-[#27272f] pb-2 flex items-center gap-2">
                <Film className="w-4 h-4 text-violet-400" /> Project Parameters
              </h3>

              {/* Budget */}
              <div>
                <label className="block text-[#a1a1aa] font-medium mb-1 flex justify-between">
                  <span>Production Budget ($)</span>
                  <span className="text-emerald-400 font-mono font-bold">
                    ${(budget / 1e6).toFixed(1)}M
                  </span>
                </label>
                <input
                  type="range"
                  min={1000000}
                  max={250000000}
                  step={1000000}
                  value={budget}
                  onChange={(e) => setBudget(+e.target.value)}
                  className="w-full accent-violet-500 bg-[#111118]"
                />
              </div>

              {/* Genres */}
              <div>
                <label className="block text-[#a1a1aa] font-medium mb-1.5">
                  Primary Genres
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_GENRES.map((g) => {
                    const active = genres.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => toggleGenre(g)}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all border",
                          active
                            ? "bg-violet-600 text-white border-violet-500 shadow-sm"
                            : "bg-[#111118] text-[#a1a1aa] border-[#27272f] hover:text-[#f4f4f8]"
                        )}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Timing & Scale */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">
                    Release Month
                  </label>
                  <select
                    value={releaseMonth}
                    onChange={(e) => setReleaseMonth(+e.target.value)}
                    className="w-full bg-[#111118] border border-[#27272f] rounded-lg px-2.5 py-1.5 text-xs text-[#f4f4f8]"
                  >
                    {[
                      "Jan (Dump)",
                      "Feb (Dump)",
                      "Mar (Spring)",
                      "Apr (Spring)",
                      "May (Summer)",
                      "Jun (Summer)",
                      "Jul (Summer)",
                      "Aug (Late)",
                      "Sep (Fall)",
                      "Oct (Awards)",
                      "Nov (Holiday)",
                      "Dec (Holiday)",
                    ].map((m, idx) => (
                      <option key={idx} value={idx + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">
                    Runtime (mins)
                  </label>
                  <input
                    type="number"
                    value={runtime}
                    onChange={(e) => setRuntime(+e.target.value)}
                    className="w-full bg-[#111118] border border-[#27272f] rounded-lg px-2.5 py-1.5 text-xs text-[#f4f4f8]"
                  />
                </div>
              </div>

              {/* Talent Tiers */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">
                    Director
                  </label>
                  <select
                    value={directorTier}
                    onChange={(e) => setDirectorTier(e.target.value as any)}
                    className="w-full bg-[#111118] border border-[#27272f] rounded-lg px-2 py-1.5 text-[11px] text-[#f4f4f8]"
                  >
                    <option value="top_tier">Top Tier</option>
                    <option value="mid_tier">Mid Tier</option>
                    <option value="indie">Indie</option>
                    <option value="debut">Debut</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">
                    Lead Cast
                  </label>
                  <select
                    value={castTier}
                    onChange={(e) => setCastTier(e.target.value as any)}
                    className="w-full bg-[#111118] border border-[#27272f] rounded-lg px-2 py-1.5 text-[11px] text-[#f4f4f8]"
                  >
                    <option value="superstar">Superstar</option>
                    <option value="established">Established</option>
                    <option value="rising">Rising</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[#a1a1aa] font-medium mb-1">
                    Studio
                  </label>
                  <select
                    value={studioTier}
                    onChange={(e) => setStudioTier(e.target.value as any)}
                    className="w-full bg-[#111118] border border-[#27272f] rounded-lg px-2 py-1.5 text-[11px] text-[#f4f4f8]"
                  >
                    <option value="major_studio">Major Studio</option>
                    <option value="mid_major">Mid Major</option>
                    <option value="indie">Indie</option>
                  </select>
                </div>
              </div>

              {/* Flags & Stunts */}
              <div className="flex flex-wrap gap-4 pt-1 text-[#f4f4f8]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isFranchise}
                    onChange={(e) => setIsFranchise(e.target.checked)}
                    className="rounded accent-violet-500"
                  />
                  Franchise / Sequel
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasHighStunt}
                    onChange={(e) => setHasHighStunt(e.target.checked)}
                    className="rounded accent-violet-500"
                  />
                  High-Impact Stunts
                </label>
              </div>

              {/* Logline Overview */}
              <div>
                <label className="block text-[#a1a1aa] font-medium mb-1">
                  Script Logline / Overview (NLP Analysis)
                </label>
                <textarea
                  rows={2}
                  value={overview}
                  onChange={(e) => setOverview(e.target.value)}
                  className="w-full bg-[#111118] border border-[#27272f] rounded-lg px-3 py-2 text-xs text-[#f4f4f8]"
                />
              </div>

              {/* Predict Trigger Button */}
              <button
                onClick={handlePredict}
                disabled={mutation.isPending}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20 transition-all"
              >
                {mutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Run ML Box Office & ROI Prediction
              </button>
            </div>

            {/* Prediction Output & Explainability Panel */}
            <div className="space-y-4 bg-[#181824] p-4 rounded-xl border border-[#27272f] flex flex-col justify-between">
              {result ? (
                <div className="space-y-4 fade-in">
                  <h3 className="text-sm font-semibold text-[#f4f4f8] border-b border-[#27272f] pb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <PieChart className="w-4 h-4 text-emerald-400" />
                      Prediction Results
                    </span>
                    <span
                      className={cn(
                        "text-xs px-2.5 py-0.5 rounded-full font-bold font-mono",
                        result.roi_category === "Blockbuster"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : result.roi_category === "Hit"
                          ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                          : result.roi_category === "Break-even"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-red-500/20 text-red-300 border border-red-500/30"
                      )}
                    >
                      {result.roi_category} ({result.predicted_roi_multiple}x)
                    </span>
                  </h3>

                  {/* Main Metric Cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#111118] p-3 rounded-xl border border-[#27272f]">
                      <div className="text-[#a1a1aa] text-[11px] mb-1">
                        Predicted Box Office Gross
                      </div>
                      <div className="text-xl font-bold font-mono text-emerald-400">
                        ${(result.predicted_revenue_usd / 1e6).toFixed(1)}M
                      </div>
                      <div className="text-[10px] text-[#71717a]">
                        Range: ${(result.revenue_range_min / 1e6).toFixed(1)}M – $
                        {(result.revenue_range_max / 1e6).toFixed(1)}M
                      </div>
                    </div>

                    <div className="bg-[#111118] p-3 rounded-xl border border-[#27272f]">
                      <div className="text-[#a1a1aa] text-[11px] mb-1">
                        Financial Risk Rating
                      </div>
                      <div className="text-xl font-bold font-mono text-violet-300">
                        {result.financial_risk_score} / 100
                      </div>
                      <div className="text-[10px] text-[#71717a]">
                        Confidence: {result.confidence_score}%
                      </div>
                    </div>
                  </div>

                  {/* SHAP Feature Drivers */}
                  <div>
                    <h4 className="text-xs font-semibold text-[#a1a1aa] mb-2 uppercase font-mono">
                      Top Revenue Drivers (SHAP Attribution)
                    </h4>
                    <div className="space-y-1.5">
                      {result.feature_drivers.map((drv, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between bg-[#111118] px-3 py-1.5 rounded-lg border border-[#27272f]"
                        >
                          <span className="text-[#f4f4f8] font-medium">
                            {drv.feature}
                          </span>
                          <span
                            className={cn(
                              "font-mono font-bold text-xs px-2 py-0.5 rounded",
                              drv.direction === "positive"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-red-500/10 text-red-400"
                            )}
                          >
                            {drv.impact_formatted}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Model Explanation */}
                  <div className="bg-[#111118] p-3 rounded-xl border border-[#27272f] text-[#a1a1aa] text-[11px] leading-relaxed">
                    <span className="text-[#f4f4f8] font-semibold">Model Insight: </span>
                    {result.explanation}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#71717a] space-y-3">
                  <div className="p-4 rounded-full bg-violet-500/5 border border-violet-500/10 text-violet-400">
                    <TrendingUp className="w-8 h-8" />
                  </div>
                  <h4 className="text-sm font-semibold text-[#f4f4f8]">
                    Ready for Financial Inference
                  </h4>
                  <p className="text-xs max-w-xs">
                    Adjust budget, talent tiers, genre combinations, and stunt parameters on the left to compute projected Box Office ROI.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
