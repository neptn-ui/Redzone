# backend/scoring/seasonal_risk_engine.py
# Seasonal Risk Engine — §2.5
#
# DESIGN PRINCIPLES (§5, §7):
#   - Pure function: no DB calls. Caller passes the disaster_history events list.
#   - Returns a SeasonalRiskResult with a month-by-month risk profile and
#     a seasonal_multiplier (1.0–2.0) representing peak-season amplification.
#   - The multiplier feeds into hazard_engine.py as a documented additive factor.
#   - Region-agnostic: works from any set of DisasterHistory-like event dicts.
#
# METHOD:
#   1. Build a 12-bucket histogram of event counts by calendar month.
#   2. Identify the peak month and current month.
#   3. Compute seasonal_multiplier proportional to peak severity and
#      proximity of current month to the historical peak.
#   4. "Proximity": 0–1 weight using a Gaussian centred on peak_month,
#      σ=1.5 months.  Jan/Dec wraparound handled correctly.
#
# CALIBRATION REFERENCE (Assam):
#   Brahmaputra flood peak: June–August (monsoon; ASDMA records).
#   Barak valley peak: June–July.
#   Jiadhal flash floods: June–July (Arunachal runoff).
#   At peak_month=7 (July), current_month=7 → multiplier ≈ 1.8–2.0.
#   Out of season (Dec) → multiplier ≈ 1.0 (no seasonal amplification).
# ============================================================================

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
]

# Gaussian sigma for proximity weighting (months); σ=1.5 ≈ 3-month window
PROXIMITY_SIGMA: float = 1.5

# Multiplier range [1.0, MAX_SEASONAL_MULTIPLIER]
MAX_SEASONAL_MULTIPLIER: float = 2.0


@dataclass
class SeasonalRiskResult:
    """
    Result of compute_seasonal_multiplier().

    monthly_counts:       12-element list of event counts per month (Jan=0..Dec=11)
    peak_month_1indexed:  1–12; month with highest historical event count
    peak_month_name:      e.g. "Jul"
    current_month:        1–12
    proximity_weight:     0–1 Gaussian proximity of current month to peak
    max_severity:         highest severity in events (1–5)
    seasonal_multiplier:  1.0–2.0 amplification factor for hazard scoring
    data_source:          "REAL" if events have real dates; "MISSING" if no events
    rationale:            human-readable explanation
    """
    habitation_name:     str
    monthly_counts:      list[int]
    peak_month_1indexed: int
    peak_month_name:     str
    current_month:       int
    proximity_weight:    float
    max_severity:        int
    seasonal_multiplier: float
    data_source:         str
    rationale:           str

    def to_explanation_json(self) -> dict:
        return {
            "habitation":         self.habitation_name,
            "seasonal_multiplier": round(self.seasonal_multiplier, 4),
            "peak_month":         self.peak_month_name,
            "current_month":      MONTH_NAMES[self.current_month - 1],
            "proximity_weight":   round(self.proximity_weight, 4),
            "max_severity":       self.max_severity,
            "monthly_event_counts": {
                MONTH_NAMES[i]: self.monthly_counts[i] for i in range(12)
            },
            "data_source": self.data_source,
            "rationale":   self.rationale,
            "note": (
                "seasonal_multiplier is applied multiplicatively to hazard_score "
                "by the scoring engine (capped at 1.0 after normalization)."
            ),
        }


def compute_seasonal_multiplier(
    habitation_name: str,
    events: list[dict],      # list of {"event_date": date, "severity": int}
    current_month:   int,    # 1–12
) -> SeasonalRiskResult:
    """
    Computes the seasonal risk multiplier for one habitation.

    Parameters
    ----------
    habitation_name : display name for audit trail
    events          : list of event dicts with keys "event_date" (date) and "severity" (1–5)
    current_month   : current calendar month (1–12); typically datetime.utcnow().month

    Returns
    -------
    SeasonalRiskResult
    """
    if not events:
        return SeasonalRiskResult(
            habitation_name=habitation_name,
            monthly_counts=[0] * 12,
            peak_month_1indexed=current_month,
            peak_month_name=MONTH_NAMES[current_month - 1],
            current_month=current_month,
            proximity_weight=0.0,
            max_severity=1,
            seasonal_multiplier=1.0,
            data_source="MISSING",
            rationale="No disaster history — seasonal multiplier = 1.0 (no amplification).",
        )

    # Build monthly histogram
    monthly_counts = [0] * 12
    max_severity = 1
    for ev in events:
        ev_date = ev.get("event_date")
        if ev_date is None:
            continue
        m = ev_date.month - 1  # 0-indexed
        monthly_counts[m] += 1
        max_severity = max(max_severity, ev.get("severity", 1))

    peak_idx = monthly_counts.index(max(monthly_counts))  # 0-indexed
    peak_month_1indexed = peak_idx + 1

    # Gaussian proximity: distance accounting for calendar wraparound
    raw_dist = abs(current_month - peak_month_1indexed)
    dist = min(raw_dist, 12 - raw_dist)  # shortest circular distance
    proximity_weight = math.exp(-(dist ** 2) / (2 * PROXIMITY_SIGMA ** 2))

    # Severity factor: normalise max_severity to [0, 1]
    severity_factor = (max_severity - 1) / 4.0  # 1→0.0, 5→1.0

    # Multiplier: baseline 1.0 + proximity × severity × (MAX − 1)
    mult = 1.0 + proximity_weight * severity_factor * (MAX_SEASONAL_MULTIPLIER - 1.0)
    mult = round(max(1.0, min(MAX_SEASONAL_MULTIPLIER, mult)), 6)

    # Determine data source: if any event has a real date → REAL
    has_real_dates = any(ev.get("event_date") is not None for ev in events)
    data_source = "REAL" if has_real_dates else "SYNTH"

    rationale = (
        f"Peak historical month: {MONTH_NAMES[peak_idx]} "
        f"({monthly_counts[peak_idx]} event(s), max severity {max_severity}). "
        f"Current month: {MONTH_NAMES[current_month - 1]}. "
        f"Proximity (Gaussian σ={PROXIMITY_SIGMA}): {proximity_weight:.2f}. "
        f"Seasonal multiplier: {mult:.3f}."
    )

    return SeasonalRiskResult(
        habitation_name=habitation_name,
        monthly_counts=monthly_counts,
        peak_month_1indexed=peak_month_1indexed,
        peak_month_name=MONTH_NAMES[peak_idx],
        current_month=current_month,
        proximity_weight=round(proximity_weight, 6),
        max_severity=max_severity,
        seasonal_multiplier=mult,
        data_source=data_source,
        rationale=rationale,
    )
