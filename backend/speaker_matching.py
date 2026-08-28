"""
Speaker profile matching.

Gemini's API is stateless across chunks, so it cannot reliably remember
"Speaker 2 from 3 chunks ago sounds like this new voice" on its own - in
testing this caused speaker counts to explode (a real 2-person
conversation producing 8+ speaker labels, most appearing only once).

This module moves that matching responsibility to the backend: whenever
Gemini reports a "new" speaker in a chunk, we compare its profile
(gender/pitch/pace/quality) against every speaker already known in this
session, using simple rule-based similarity. If it's a reasonable match,
we merge it into the existing speaker instead of creating a new one.
Only if no known speaker is a plausible match do we register a genuinely
new speaker, with a clean sequential label assigned by the backend
(not whatever label Gemini happened to use internally in that response).
"""
from __future__ import annotations
from typing import Optional

from models import VoiceProfile

PITCH_ORDER = {"low": 0, "medium": 1, "high": 2}
PACE_ORDER = {"slow": 0, "medium": 1, "fast": 2}


def _pitch_distance(a: str, b: str) -> int:
    return abs(PITCH_ORDER.get(a, 1) - PITCH_ORDER.get(b, 1))


def _pace_distance(a: str, b: str) -> int:
    return abs(PACE_ORDER.get(a, 1) - PACE_ORDER.get(b, 1))


def _similarity_score(a: VoiceProfile, b: VoiceProfile) -> float:
    """
    Higher is more similar. Returns -infinity for a hard disqualification
    (clearly different gender), otherwise a score based on how close the
    pitch/pace estimates are.
    """
    # Gender is the strongest, most reliable signal (male vs female is a
    # very hard acoustic difference to confuse). Only allow a mismatch to
    # pass through if one side is "unclear".
    if (
        a.gender_estimate != b.gender_estimate
        and "unclear" not in (a.gender_estimate, b.gender_estimate)
    ):
        return float("-inf")

    score = 0.0
    score -= _pitch_distance(a.pitch, b.pitch) * 2  # pitch differences matter most
    score -= _pace_distance(a.pace, b.pace) * 1
    return score


def find_matching_known_speaker(
    new_profile: VoiceProfile,
    known_profiles: dict[str, VoiceProfile],
    threshold: float = -2.0,
) -> Optional[str]:
    """
    Returns the speaker label of the best-matching known speaker, or None
    if no known speaker is a close enough match (meaning this is likely a
    genuinely new speaker).

    threshold: minimum acceptable similarity score. -2.0 allows a
    one-step difference in either pitch or pace (but not both, and never
    a gender mismatch) to still count as the same person - text-based
    descriptions of the same voice can vary slightly between calls.
    """
    best_label: Optional[str] = None
    best_score = float("-inf")

    for label, existing in known_profiles.items():
        score = _similarity_score(new_profile, existing)
        if score > best_score:
            best_score = score
            best_label = label

    if best_label is not None and best_score >= threshold:
        return best_label
    return None