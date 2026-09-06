# backend/scoring/relocation_horizon_engine.py
# Relocation Horizon Engine — §2.2 operational horizon classification.
#
# DESIGN PRINCIPLES (§5, §7):
#   - Pure function: no DB calls, no side effects.
#   - Returns (horizon_key, rationale) tuple — always tells the caller WHY.
#   - IMMEDIATE is NEVER silently downgraded for lack of a matched site.
#     Instead, the rationale flags "escalate emergency shelter search".
#   - This engine is region-agnostic: it operates on normalised scores only.
#
# Horizon definitions (§2.2):
#   IMMEDIATE   — hazard_score ≥ 0.75 (life-safety, hours to days)
#   SHORT_TERM  — hazard_score in [0.55, 0.75) OR ≥ 0.75 with confirmed
#                 interim site but no permanent resettlement plan (weeks–1yr)
#   MEDIUM_TERM — hazard_score in [0.35, 0.55) (1–3 years; formal planning)
#   MONITOR     — hazard_score < 0.35 and no worsening trend
# ============================================================================

from __future__ import annotations
from typing import Optional


# ============================================================================
# Thresholds (match hazard_engine.py §5 classification thresholds)
# ============================================================================

IMMEDIATE_THRESHOLD:   float = 0.75
SHORT_TERM_THRESHOLD:  float = 0.55
MEDIUM_TERM_THRESHOLD: float = 0.35


def classify_relocation_horizon(
    hazard_score:             float,
    urgency_score:            float,
    site_availability_factor: float,
    vulnerability_index:      Optional[float] = None,
    trend_worsening:          bool = False,
) -> tuple[str, str]:
    """
    Classifies one habitation's relocation horizon.

    Parameters
    ----------
    hazard_score             : 0–1 final hazard score (after live_trigger_multiplier)
    urgency_score            : 0–1 composite urgency (hazard × population × site_factor)
    site_availability_factor : 1.0 if a viable site exists, 0.6 otherwise
    vulnerability_index      : optional 0–1 social vulnerability (§2.1); if provided,
                               can elevate MEDIUM_TERM habitations to SHORT_TERM
    trend_worsening          : set True when satellite/seasonal data shows acceleration
                               (§2.4/§2.5 inputs); can elevate MEDIUM_TERM to SHORT_TERM

    Returns
    -------
    (horizon_key, rationale)
        horizon_key : "IMMEDIATE" | "SHORT_TERM" | "MEDIUM_TERM" | "MONITOR"
        rationale   : human-readable explanation of which condition(s) triggered this bucket
    """
    conditions_met: list[str] = []

    # ── IMMEDIATE ──────────────────────────────────────────────────────────
    if hazard_score >= IMMEDIATE_THRESHOLD:
        rationale_parts = [
            f"hazard_score={hazard_score:.3f} ≥ {IMMEDIATE_THRESHOLD} (life-safety threshold)"
        ]
        if site_availability_factor < 1.0:
            rationale_parts.append(
                "No confirmed matched site — ESCALATE EMERGENCY SHELTER SEARCH immediately."
            )
        else:
            rationale_parts.append("Interim site available; confirm temporary shelter capacity.")
        return "IMMEDIATE", " | ".join(rationale_parts)

    # ── SHORT_TERM ─────────────────────────────────────────────────────────
    if hazard_score >= SHORT_TERM_THRESHOLD:
        conditions_met.append(
            f"hazard_score={hazard_score:.3f} in [{SHORT_TERM_THRESHOLD}, {IMMEDIATE_THRESHOLD})"
        )
        # Vulnerability can elevate urgency narrative but horizon is already SHORT_TERM
        if vulnerability_index is not None and vulnerability_index >= 0.6:
            conditions_met.append(
                f"vulnerability_index={vulnerability_index:.2f} ≥ 0.6 (high social vulnerability)"
            )
        if trend_worsening:
            conditions_met.append("satellite/seasonal trend shows worsening acceleration")
        return "SHORT_TERM", " | ".join(conditions_met)

    # ── MEDIUM_TERM with potential elevation ───────────────────────────────
    if hazard_score >= MEDIUM_TERM_THRESHOLD:
        base = f"hazard_score={hazard_score:.3f} in [{MEDIUM_TERM_THRESHOLD}, {SHORT_TERM_THRESHOLD})"
        if trend_worsening:
            # Trend-aware elevation: worsening trend even at moderate snapshot → SHORT_TERM
            return "SHORT_TERM", (
                f"{base} | trend_worsening=True — satellite/seasonal acceleration detected; "
                "elevated from MEDIUM_TERM to SHORT_TERM (proactive planning)"
            )
        if vulnerability_index is not None and vulnerability_index >= 0.75:
            # High vulnerability at moderate hazard → SHORT_TERM
            return "SHORT_TERM", (
                f"{base} | vulnerability_index={vulnerability_index:.2f} ≥ 0.75 — "
                "high social vulnerability elevates from MEDIUM_TERM to SHORT_TERM"
            )
        return "MEDIUM_TERM", (
            f"{base} — formal resettlement planning recommended; monitor trend indicators."
        )

    # ── MONITOR ────────────────────────────────────────────────────────────
    return "MONITOR", (
        f"hazard_score={hazard_score:.3f} < {MEDIUM_TERM_THRESHOLD} — "
        "below action thresholds; continue sensor/satellite/live-signal observation."
    )
