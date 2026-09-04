# backend/scoring/hazard_engine.py
# Hazard Scoring Engine — Section 5 formula.
#
# DESIGN PRINCIPLES (§5, §7):
#   - Pure functions only: no DB calls, no side effects, no randomness.
#   - Every weight is a named constant visible at the top of this file.
#   - The primary score is transparent and deterministic; AI inputs feed
#     only two of the six components (sar_deformation, ndvi_change).
#   - The full audit trail (explanation_json) is produced here, not in the
#     API layer, so it is always consistent with the number returned.
#
# Formula (§5):
#   hazard_score = 0.30 × hazard_intensity_norm
#                + 0.20 × frequency_history_norm
#                + 0.15 × terrain_vulnerability_norm
#                + 0.15 × proximity_to_hazard_source_norm
#                + 0.10 × sar_deformation_signal_norm
#                + 0.10 × ndvi_change_signal_norm
#
#   final_hazard_score = hazard_score × live_trigger_multiplier
#
# Classification thresholds (§5):
#   0.75–1.00  →  Immediate   (Red)
#   0.55–0.74  →  Short-term  (Orange)
#   0.35–0.54  →  Medium-term (Yellow)
#   0.00–0.34  →  Stable      (Green)
# ============================================================================

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional


# ============================================================================
# Formula weights (§5 — expert-calibrated per spec; SYNTH per data_sources.md §E.3)
# Changing a weight here propagates automatically to the audit trail.
# ============================================================================

W_HAZARD_INTENSITY   = 0.30
W_FREQUENCY_HISTORY  = 0.20
W_TERRAIN_VULN       = 0.15
W_PROXIMITY          = 0.15
W_SAR_DEFORMATION    = 0.10
W_NDVI_CHANGE        = 0.10

_WEIGHT_SUM = (W_HAZARD_INTENSITY + W_FREQUENCY_HISTORY + W_TERRAIN_VULN +
               W_PROXIMITY + W_SAR_DEFORMATION + W_NDVI_CHANGE)
assert abs(_WEIGHT_SUM - 1.0) < 1e-9, f"Weights must sum to 1.0, got {_WEIGHT_SUM}"

# Live trigger multiplier bounds (§5: "incorporating live rainfall/seismic multiplier")
MULTIPLIER_MIN = 1.0
MULTIPLIER_MAX = 1.35   # capped: live signals can raise score but not dominate it

# Rainfall threshold above which the multiplier activates (mm/hr)
RAINFALL_TRIGGER_MM_HR = 15.0     # moderate monsoon rainfall
RAINFALL_EXTREME_MM_HR = 50.0     # extreme; hits MULTIPLIER_MAX

# Seismic magnitude threshold (Mw) within 200 km for multiplier activation
SEISMIC_TRIGGER_MAG = 4.0
SEISMIC_EXTREME_MAG = 5.5

# Normalization constants
SLOPE_MAX_DEGREES   = 45.0   # slope ≥ 45° → full terrain vulnerability score
PROXIMITY_MAX_KM    = 5.0    # distance ≥ 5 km from hazard source → 0 proximity score
SAR_DEFORMATION_MAX = 5.0    # cm/yr; deformation ≥ this → full score
NDVI_DROP_MAX       = 0.30   # absolute NDVI drop ≥ this → full score (30% → 1.0)


# ============================================================================
# Result dataclass — carries score + full §6 audit trail
# ============================================================================

@dataclass
class HazardResult:
    """
    Output of compute_hazard_score().
    All fields needed to populate zone_scores.explanation_json.
    """
    habitation_name: str

    # Normalised component values (0–1)
    hazard_intensity_norm:    float
    frequency_history_norm:   float
    terrain_vulnerability_norm: float
    proximity_norm:           float
    sar_deformation_norm:     float
    ndvi_change_norm:         float

    # Intermediate and final scores
    base_hazard_score:        float   # before multiplier
    live_trigger_multiplier:  float
    final_hazard_score:       float   # = base × multiplier, clipped to [0, 1]

    # Classification
    classification:           str     # "immediate" | "short_term" | "medium_term" | "stable"
    classification_label:     str     # human-readable with colour hint

    # Free-text evidence strings (populated by caller from real data)
    evidence:                 list[str] = field(default_factory=list)

    def to_explanation_json(self) -> dict:
        """
        Returns the §6 audit trail dict, ready to store in zone_scores.explanation_json.
        The breakdown math always adds up to base_hazard_score (within floating-point).
        """
        return {
            "habitation": self.habitation_name,
            "hazard_score": round(self.final_hazard_score, 4),
            "base_hazard_score": round(self.base_hazard_score, 4),
            "live_trigger_multiplier": round(self.live_trigger_multiplier, 4),
            "classification": self.classification_label,
            "breakdown": {
                "hazard_intensity": {
                    "value":        round(self.hazard_intensity_norm, 4),
                    "weight":       W_HAZARD_INTENSITY,
                    "contribution": round(self.hazard_intensity_norm * W_HAZARD_INTENSITY, 4),
                },
                "frequency_history": {
                    "value":        round(self.frequency_history_norm, 4),
                    "weight":       W_FREQUENCY_HISTORY,
                    "contribution": round(self.frequency_history_norm * W_FREQUENCY_HISTORY, 4),
                },
                "terrain_vulnerability": {
                    "value":        round(self.terrain_vulnerability_norm, 4),
                    "weight":       W_TERRAIN_VULN,
                    "contribution": round(self.terrain_vulnerability_norm * W_TERRAIN_VULN, 4),
                },
                "proximity_to_hazard_source": {
                    "value":        round(self.proximity_norm, 4),
                    "weight":       W_PROXIMITY,
                    "contribution": round(self.proximity_norm * W_PROXIMITY, 4),
                },
                "sar_deformation": {
                    "value":        round(self.sar_deformation_norm, 4),
                    "weight":       W_SAR_DEFORMATION,
                    "contribution": round(self.sar_deformation_norm * W_SAR_DEFORMATION, 4),
                    "source":       "Sentinel-1 SAR amplitude-change proxy",
                    "ai_input":     True,
                },
                "ndvi_change": {
                    "value":        round(self.ndvi_change_norm, 4),
                    "weight":       W_NDVI_CHANGE,
                    "contribution": round(self.ndvi_change_norm * W_NDVI_CHANGE, 4),
                    "source":       "Sentinel-2 NDVI differencing",
                    "ai_input":     True,
                },
            },
            "evidence": self.evidence,
            "formula": (
                f"{W_HAZARD_INTENSITY}×hazard_intensity "
                f"+ {W_FREQUENCY_HISTORY}×frequency_history "
                f"+ {W_TERRAIN_VULN}×terrain_vulnerability "
                f"+ {W_PROXIMITY}×proximity "
                f"+ {W_SAR_DEFORMATION}×sar_deformation "
                f"+ {W_NDVI_CHANGE}×ndvi_change "
                f"× live_trigger_multiplier"
            ),
        }


# ============================================================================
# Normalization helpers
# All inputs raw → output in [0, 1].
# ============================================================================

def normalize_hazard_intensity(intensity_class: int) -> float:
    """
    Maps hazard zone intensity class (1–5) to a normalised score.
    Class 5 (most severe) → 1.0; class 1 → 0.15.
    Linear interpolation with a floor so class 1 is not zero.
    """
    if intensity_class <= 0:
        return 0.0
    return min(1.0, max(0.0, (intensity_class - 1) / 4 * 0.85 + 0.15))


def normalize_frequency_history(
    event_count: int,
    max_severity_ever: int = 1,
    years_lookback: int = 25,
) -> float:
    """
    Combines event frequency and maximum severity over a lookback window.
    event_count: number of documented events in `years_lookback` years.
    max_severity_ever: highest severity (1–5) across those events.

    Score = 0.6 × freq_component + 0.4 × severity_component
    where freq_component saturates at 4 events (habitations with ≥4 events get 1.0).
    """
    freq_component = min(1.0, event_count / 4.0)
    severity_component = (max_severity_ever - 1) / 4.0 if max_severity_ever >= 1 else 0.0
    return min(1.0, 0.6 * freq_component + 0.4 * severity_component)


def normalize_terrain_vulnerability(slope_degrees: float) -> float:
    """
    Steeper slope → higher vulnerability.
    slope ≥ SLOPE_MAX_DEGREES (45°) → 1.0; flat (0°) → 0.05 floor.
    """
    if slope_degrees <= 0:
        return 0.05
    raw = slope_degrees / SLOPE_MAX_DEGREES
    return min(1.0, max(0.05, raw))


def normalize_proximity(distance_to_hazard_km: float) -> float:
    """
    Closer to hazard source → higher score.
    distance ≤ 0 km (inside hazard zone) → 1.0.
    distance ≥ PROXIMITY_MAX_KM (5 km) → 0.0.
    """
    if distance_to_hazard_km <= 0:
        return 1.0
    raw = 1.0 - (distance_to_hazard_km / PROXIMITY_MAX_KM)
    return min(1.0, max(0.0, raw))


def normalize_sar_deformation(deformation_cm_yr: float) -> float:
    """
    SAR amplitude-change proxy for ground deformation.
    0 cm/yr → 0.0; ≥ SAR_DEFORMATION_MAX (5 cm/yr) → 1.0.
    Note: this is NOT full InSAR phase unwrapping — see §8 data table.
    """
    return min(1.0, max(0.0, deformation_cm_yr / SAR_DEFORMATION_MAX))


def normalize_ndvi_change(ndvi_delta: float) -> float:
    """
    NDVI differencing: negative delta = vegetation loss.
    ndvi_delta should be negative (drop) to produce a positive score.
    e.g. ndvi_delta = -0.12 (12% NDVI drop) → score = 0.12 / 0.30 = 0.40.
    Pass a positive value directly if already expressed as |drop|.
    """
    magnitude = abs(ndvi_delta)
    return min(1.0, max(0.0, magnitude / NDVI_DROP_MAX))


def compute_live_trigger_multiplier(
    rainfall_mm_hr: Optional[float] = None,
    seismic_magnitude: Optional[float] = None,
    rainfall_mm_per_hr: Optional[float] = None,
    live_rainfall_mm_per_hr: Optional[float] = None,
    live_seismic_magnitude: Optional[float] = None,
    **kwargs,
) -> float:
    """
    Computes the live_trigger_multiplier from OpenWeatherMap and USGS signals.
    Returns a value in [MULTIPLIER_MIN, MULTIPLIER_MAX].

    The multiplier is a max() of the two signal contributions — the more
    extreme signal dominates, and they do not compound multiplicatively
    (that would over-weight live signals relative to the formula).

    If both signals are None (no live data / cached), returns 1.0.
    """
    if rainfall_mm_hr is None:
        rainfall_mm_hr = rainfall_mm_per_hr if rainfall_mm_per_hr is not None else live_rainfall_mm_per_hr

    if seismic_magnitude is None and live_seismic_magnitude is not None:
        seismic_magnitude = live_seismic_magnitude

    mult = MULTIPLIER_MIN

    if rainfall_mm_hr is not None and rainfall_mm_hr >= RAINFALL_TRIGGER_MM_HR:
        # Linear interpolation between trigger and extreme
        t = (rainfall_mm_hr - RAINFALL_TRIGGER_MM_HR) / (
            RAINFALL_EXTREME_MM_HR - RAINFALL_TRIGGER_MM_HR
        )
        rain_mult = MULTIPLIER_MIN + t * (MULTIPLIER_MAX - MULTIPLIER_MIN)
        mult = max(mult, min(MULTIPLIER_MAX, rain_mult))

    if seismic_magnitude is not None and seismic_magnitude >= SEISMIC_TRIGGER_MAG:
        t = (seismic_magnitude - SEISMIC_TRIGGER_MAG) / (
            SEISMIC_EXTREME_MAG - SEISMIC_TRIGGER_MAG
        )
        seismic_mult = MULTIPLIER_MIN + t * (MULTIPLIER_MAX - MULTIPLIER_MIN)
        mult = max(mult, min(MULTIPLIER_MAX, seismic_mult))

    return round(mult, 4)


# ============================================================================
# Primary scoring function
# ============================================================================

def compute_hazard_score(
    habitation_name: str,
    hazard_intensity_norm: float,
    frequency_history_norm: float,
    terrain_vulnerability_norm: float,
    proximity_norm: float,
    sar_deformation_norm: float,
    ndvi_change_norm: float,
    live_trigger_multiplier: float = 1.0,
    evidence: Optional[list[str]] = None,
) -> HazardResult:
    """
    Computes the transparent weighted hazard score for one habitation.

    All norm arguments must be in [0, 1]. The function clamps them rather
    than raising, because a downstream normalization error should degrade
    gracefully, not crash the entire scoring run.

    Returns a HazardResult with the full audit trail.
    """
    # Clamp all inputs to [0, 1]
    hi   = _clamp(hazard_intensity_norm)
    fh   = _clamp(frequency_history_norm)
    tv   = _clamp(terrain_vulnerability_norm)
    prox = _clamp(proximity_norm)
    sar  = _clamp(sar_deformation_norm)
    ndvi = _clamp(ndvi_change_norm)
    mult = max(MULTIPLIER_MIN, min(MULTIPLIER_MAX, live_trigger_multiplier))

    base = (
        W_HAZARD_INTENSITY  * hi
        + W_FREQUENCY_HISTORY * fh
        + W_TERRAIN_VULN      * tv
        + W_PROXIMITY         * prox
        + W_SAR_DEFORMATION   * sar
        + W_NDVI_CHANGE       * ndvi
    )

    final = _clamp(base * mult)
    classification, label = classify_hazard_score(final)

    return HazardResult(
        habitation_name=habitation_name,
        hazard_intensity_norm=hi,
        frequency_history_norm=fh,
        terrain_vulnerability_norm=tv,
        proximity_norm=prox,
        sar_deformation_norm=sar,
        ndvi_change_norm=ndvi,
        base_hazard_score=round(base, 6),
        live_trigger_multiplier=mult,
        final_hazard_score=round(final, 6),
        classification=classification,
        classification_label=label,
        evidence=evidence or [],
    )


def classify_hazard_score(score: float) -> tuple[str, str]:
    """
    Maps a final_hazard_score to (classification_key, human_label).
    Thresholds per §5.
    """
    if score >= 0.75:
        return "immediate",   "Red — Immediate Relocation Required"
    elif score >= 0.55:
        return "short_term",  "Orange — Short-term (within 1 year)"
    elif score >= 0.35:
        return "medium_term", "Yellow — Medium-term / Monitor"
    else:
        return "stable",      "Green — Stable / No immediate action"


# ============================================================================
# Convenience builder: compute from raw (un-normalised) inputs
# ============================================================================

def compute_hazard_score_from_raw(
    habitation_name: str,
    intensity_class: int,
    event_count: int,
    max_severity_ever: int,
    slope_degrees: float,
    distance_to_hazard_km: float,
    sar_deformation_cm_yr: float,
    ndvi_delta: float,
    rainfall_mm_hr: Optional[float] = None,
    seismic_magnitude: Optional[float] = None,
    evidence: Optional[list[str]] = None,
    live_rainfall_mm_per_hr: Optional[float] = None,
    live_seismic_magnitude: Optional[float] = None,
    rainfall_mm_per_hr: Optional[float] = None,
    **kwargs,
) -> HazardResult:
    """
    Convenience wrapper: accepts raw domain values, normalises internally,
    then calls compute_hazard_score().

    Use this in the API layer and the test gate (§14.3) where raw values
    are more readable than pre-normalised floats.
    """
    if rainfall_mm_hr is None:
        rainfall_mm_hr = rainfall_mm_per_hr if rainfall_mm_per_hr is not None else live_rainfall_mm_per_hr

    if seismic_magnitude is None and live_seismic_magnitude is not None:
        seismic_magnitude = live_seismic_magnitude
    mult = compute_live_trigger_multiplier(rainfall_mm_hr, seismic_magnitude)

    # Build auto-evidence if caller didn't provide any
    if evidence is None:
        evidence = []
        evidence.append(f"Hazard intensity class: {intensity_class}/5")
        evidence.append(f"Documented disaster events (last 25 years): {event_count}")
        evidence.append(f"Max recorded severity: {max_severity_ever}/5")
        evidence.append(f"Terrain slope: {slope_degrees:.1f}°")
        evidence.append(f"Distance to nearest hazard source: {distance_to_hazard_km:.1f} km")
        evidence.append(f"SAR deformation signal: {sar_deformation_cm_yr:.2f} cm/yr")
        evidence.append(f"NDVI change: {ndvi_delta:+.3f}")
        if rainfall_mm_hr is not None:
            evidence.append(f"Live rainfall: {rainfall_mm_hr:.1f} mm/hr "
                            f"(trigger multiplier active: {mult:.3f})")
        if seismic_magnitude is not None:
            evidence.append(f"Recent seismic event: Mw {seismic_magnitude:.1f} "
                            f"(trigger multiplier active: {mult:.3f})")

    return compute_hazard_score(
        habitation_name=habitation_name,
        hazard_intensity_norm=normalize_hazard_intensity(intensity_class),
        frequency_history_norm=normalize_frequency_history(event_count, max_severity_ever),
        terrain_vulnerability_norm=normalize_terrain_vulnerability(slope_degrees),
        proximity_norm=normalize_proximity(distance_to_hazard_km),
        sar_deformation_norm=normalize_sar_deformation(sar_deformation_cm_yr),
        ndvi_change_norm=normalize_ndvi_change(ndvi_delta),
        live_trigger_multiplier=mult,
        evidence=evidence,
    )


# ============================================================================
# Internal utilities
# ============================================================================

def _clamp(v: float, lo: float = 0.0, hi_val: float = 1.0) -> float:
    return max(lo, min(hi_val, float(v)))
