import math
import numpy as np
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

STANDARD_GENRES = [
    "Action", "Adventure", "Animation", "Comedy", "Crime",
    "Documentary", "Drama", "Family", "Fantasy", "History",
    "Horror", "Music", "Mystery", "Romance", "Science Fiction",
    "TV Movie", "Thriller", "War", "Western"
]

ACTION_KEYWORDS = [
    "chase", "explosion", "fight", "car", "gun", "fire", "fall",
    "stunt", "hero", "battle", "heist", "superhero", "war", "rescue",
    "danger", "survival", "assassin", "agent", "mission", "weapon"
]

class MoviePredictionInput(BaseModel):
    budget: float = Field(..., description="Estimated production budget in USD (e.g. 50000000)")
    release_month: int = Field(6, ge=1, le=12, description="Target release month (1-12)")
    genres: List[str] = Field(default_factory=lambda: ["Action", "Adventure"])
    runtime: int = Field(110, ge=30, le=300, description="Runtime in minutes")
    is_franchise: bool = Field(False, description="Is part of an existing franchise or collection")
    has_homepage: bool = Field(True, description="Has dedicated marketing site & digital campaign")
    stunt_count: int = Field(2, ge=0, description="Total planned stunt scenes")
    has_high_impact_stunt: bool = Field(True, description="Includes high fall, vehicle chase, or pyrotechnics")
    director_tier: str = Field("mid_tier", description="Director tier: top_tier, mid_tier, indie, debut")
    lead_cast_tier: str = Field("established", description="Lead cast tier: superstar, established, rising, unknown")
    production_company_tier: str = Field("major_studio", description="Studio tier: major_studio, mid_major, indie")
    script_overview: str = Field("", description="Short synopsis or logline")

FEATURE_NAMES = [
    "log_budget",
    "budget_category",
    "release_month_sin",
    "release_month_cos",
    "is_summer_window",
    "is_holiday_window",
    "is_dump_month",
    "runtime_norm",
    "is_franchise",
    "has_homepage",
    "stunt_count_norm",
    "has_high_impact_stunt",
    "director_score",
    "cast_score",
    "studio_score",
    "script_length_norm",
    "action_density_score"
] + [f"genre_{g.lower().replace(' ', '_')}" for g in STANDARD_GENRES]


def extract_feature_dict(data: MoviePredictionInput) -> Dict[str, float]:
    """Extract named feature dictionary from movie prediction input."""
    # 1. Budget features
    budget_usd = max(10000.0, data.budget)
    log_budget = math.log1p(budget_usd)
    
    if budget_usd < 5_000_000:
        budget_category = 0.0  # Micro
    elif budget_usd < 25_000_000:
        budget_category = 1.0  # Low
    elif budget_usd < 75_000_000:
        budget_category = 2.0  # Mid
    else:
        budget_category = 3.0  # Tentpole

    # 2. Seasonality
    month = max(1, min(12, data.release_month))
    month_rad = (2.0 * math.pi * month) / 12.0
    release_month_sin = math.sin(month_rad)
    release_month_cos = math.cos(month_rad)
    
    is_summer = 1.0 if month in [5, 6, 7] else 0.0
    is_holiday = 1.0 if month in [11, 12] else 0.0
    is_dump = 1.0 if month in [1, 2, 8] else 0.0

    # 3. Scale & Operations
    runtime_norm = max(30.0, min(300.0, float(data.runtime))) / 120.0
    is_franchise_val = 1.0 if data.is_franchise else 0.0
    has_homepage_val = 1.0 if data.has_homepage else 0.0

    # 4. Stunts & Action
    stunt_count_norm = min(15.0, float(data.stunt_count)) / 5.0
    has_high_stunt_val = 1.0 if data.has_high_impact_stunt else 0.0

    # 5. Star Power & Track Record
    director_scores = {"top_tier": 3.5, "mid_tier": 2.0, "indie": 1.0, "debut": 0.5}
    cast_scores = {"superstar": 4.0, "established": 2.5, "rising": 1.5, "unknown": 0.5}
    studio_scores = {"major_studio": 3.0, "mid_major": 1.8, "indie": 1.0}

    director_score = director_scores.get(data.director_tier, 1.5)
    cast_score = cast_scores.get(data.lead_cast_tier, 1.5)
    studio_score = studio_scores.get(data.production_company_tier, 1.5)

    # 6. Text NLP & Keywords
    overview_text = (data.script_overview or "").lower()
    words = overview_text.split()
    script_length_norm = min(500.0, float(len(words))) / 100.0
    
    action_match_count = sum(1 for kw in ACTION_KEYWORDS if kw in overview_text)
    action_density_score = min(5.0, float(action_match_count))

    # 7. Genres (Multi-hot)
    genre_set = {g.strip().lower() for g in data.genres}

    feat_dict: Dict[str, float] = {
        "log_budget": log_budget,
        "budget_category": budget_category,
        "release_month_sin": release_month_sin,
        "release_month_cos": release_month_cos,
        "is_summer_window": is_summer,
        "is_holiday_window": is_holiday,
        "is_dump_month": is_dump,
        "runtime_norm": runtime_norm,
        "is_franchise": is_franchise_val,
        "has_homepage": has_homepage_val,
        "stunt_count_norm": stunt_count_norm,
        "has_high_impact_stunt": has_high_stunt_val,
        "director_score": director_score,
        "cast_score": cast_score,
        "studio_score": studio_score,
        "script_length_norm": script_length_norm,
        "action_density_score": action_density_score,
    }

    for genre in STANDARD_GENRES:
        key = f"genre_{genre.lower().replace(' ', '_')}"
        feat_dict[key] = 1.0 if genre.lower() in genre_set else 0.0

    return feat_dict


def extract_feature_vector(data: MoviePredictionInput) -> np.ndarray:
    """Extract numeric numpy vector matching FEATURE_NAMES ordering."""
    feat_map = extract_feature_dict(data)
    return np.array([feat_map[name] for name in FEATURE_NAMES], dtype=np.float32)
