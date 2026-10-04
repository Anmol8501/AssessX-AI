"""Phase 6A risk policy `6A-v1` — the single place every risk value lives.

A risk score in AssessX **summarises observable events for a human reviewer**. It is not a
probability that a candidate cheated, it never rejects anyone, and nothing in this package produces
a verdict (Detect → Correlate → Explain → Evidence → Human Review).

**Every number here is provisional.** The PRD/TRD require an explainable, rule-based, configurable
risk engine (PRD FR-015/FR-016, NFR-006; TRD `RiskModel ← RuleBasedRiskEngine`) but give no weights,
windows or decay. These values were chosen to be proportionate to what each event means *in this
repository*, and must be validated on real sessions before anyone relies on them. Changing any value
means a new `POLICY_VERSION`, so a score can always be traced to the policy that produced it.

Where a signal's meaning in this repository differs from a naive reading, the policy follows the
repository (see `EXCLUDED`): prohibited-app detection belongs to the pre-exam readiness check and is
resolved before the exam can start, so it is not a risk contribution.
"""

from dataclasses import dataclass
from typing import Literal

from app.models.proctoring_event import ProctoringEventType

E = ProctoringEventType

POLICY_VERSION = "6A-v1"

Tier = Literal["LOW", "MEDIUM", "HIGH"]
Level = Literal["NORMAL", "LOW", "MEDIUM", "HIGH"]


@dataclass(frozen=True)
class SignalRule:
    """How one kind of signal contributes: base points, points per second it lasted, and a cap."""

    tier: Tier
    base_points: float
    points_per_second: float
    max_points: float
    reason: str


def _rule(tier: Tier, base: float, per_second: float, cap: float, reason: str) -> SignalRule:
    return SignalRule(tier, base, per_second, cap, reason)


#: Signals that contribute. Duration-based rules apply to episodes/pairs (server timestamps only);
#: an instant signal has duration 0, so only its base points count.
RULES: dict[ProctoringEventType, SignalRule] = {
    # --- HIGH: another person in view; the exam reached from another machine -------------------
    E.MULTIPLE_FACES_DETECTED: _rule(
        "HIGH", 20, 1.0, 40, "More than one face was in the camera view for a sustained interval."
    ),
    E.REMOTE_SESSION_DETECTED: _rule(
        "HIGH", 30, 0, 30, "The exam was running inside a remote-desktop session."
    ),
    # --- MEDIUM: the candidate or the exam window was away; restricted actions attempted -------
    E.FACE_NOT_DETECTED: _rule(
        "MEDIUM", 8, 0.5, 25, "No face was detected in the camera view for a sustained interval."
    ),
    E.FOCUS_LOST: _rule("MEDIUM", 8, 0.5, 25, "The exam window lost focus (another window was in front)."),
    E.FULLSCREEN_EXIT: _rule("MEDIUM", 6, 0.3, 20, "The exam left fullscreen."),
    E.CAMERA_DISCONNECTED: _rule("MEDIUM", 8, 0.5, 25, "The camera was disconnected during the exam."),
    E.MULTIPLE_MONITORS_DETECTED: _rule("MEDIUM", 10, 0, 10, "More than one display was connected."),
    E.COPY_ATTEMPT: _rule("MEDIUM", 6, 0, 6, "A copy was attempted (blocked)."),
    E.CUT_ATTEMPT: _rule("MEDIUM", 6, 0, 6, "A cut was attempted (blocked)."),
    E.PASTE_ATTEMPT: _rule("MEDIUM", 6, 0, 6, "A paste was attempted (blocked)."),
    E.CLIPBOARD_ACCESS_ATTEMPT: _rule("MEDIUM", 6, 0, 6, "Clipboard access was attempted (blocked)."),
    E.PRINT_ATTEMPT: _rule("MEDIUM", 6, 0, 6, "Printing was attempted (blocked)."),
    E.DEVTOOLS_ATTEMPT: _rule("MEDIUM", 6, 0, 6, "Developer tools were attempted (blocked)."),
    E.KEYBOARD_RESTRICTION_ATTEMPT: _rule(
        "MEDIUM", 6, 0, 6, "A restricted shortcut was attempted (blocked)."
    ),
    E.SCREEN_CAPTURE_ATTEMPT: _rule("MEDIUM", 6, 0, 6, "A screenshot was attempted."),
    # --- LOW: posture and environment — common and usually innocent ---------------------------
    E.HEAD_ORIENTATION_CHANGED: _rule(
        "LOW", 3, 0.2, 12, "The head was turned away from the candidate's own neutral position."
    ),
    E.CAMERA_TOO_DARK: _rule("LOW", 2, 0.1, 8, "The camera image was too dark to observe clearly."),
    E.FACE_TOO_FAR: _rule("LOW", 1, 0.05, 5, "The face was far from the camera."),
    E.FACE_TOO_CLOSE: _rule("LOW", 1, 0.05, 5, "The face was very close to the camera."),
    E.MIC_DISCONNECTED: _rule("LOW", 3, 0.1, 10, "The microphone was disconnected during the exam."),
    E.DISPLAY_CONFIGURATION_CHANGED: _rule("LOW", 3, 0, 3, "The display configuration changed."),
    E.CONTEXT_MENU_ATTEMPT: _rule("LOW", 1, 0, 1, "The right-click menu was attempted (blocked)."),
}

#: The event that ends each paired (duration) signal. End markers never contribute on their own.
PAIR_ENDS: dict[ProctoringEventType, frozenset[ProctoringEventType]] = {
    E.FOCUS_LOST: frozenset({E.FOCUS_REGAINED}),
    E.FULLSCREEN_EXIT: frozenset({E.FULLSCREEN_RESTORED, E.FULLSCREEN_ENTER}),
    E.CAMERA_DISCONNECTED: frozenset({E.CAMERA_RECONNECTED}),
    E.MIC_DISCONNECTED: frozenset({E.MIC_RECONNECTED}),
}
END_MARKERS: frozenset[ProctoringEventType] = frozenset().union(*PAIR_ENDS.values())

_READINESS = "Pre-exam device readiness check; any prohibited app was closed before the exam could start."
#: Events that never contribute, and why. Listed in every assessment so the omission is explicit.
_OBJECTS = (
    "Object detection uses provisional, not yet calibrated thresholds — "
    "reviewed in the evidence timeline, not scored."
)
_CODING = "Coding activity — a fact about solving the problem, not a risk signal."

EXCLUDED: dict[ProctoringEventType, str] = {
    E.SESSION_STARTED: "Session lifecycle.",
    E.SESSION_RESUMED: "Session lifecycle.",
    E.SESSION_ENDED: "Session lifecycle.",
    E.ENFORCEMENT_STATUS: "Which protections were available — diagnostics, not candidate behaviour.",
    E.DEVICE_CHECK_STARTED: _READINESS,
    E.PROHIBITED_APP_DETECTED: _READINESS,
    E.APP_CLOSE_REQUESTED: _READINESS,
    E.APP_CLOSED: _READINESS,
    E.APP_CLOSE_FAILED: _READINESS,
    E.DEVICE_CHECK_PASSED: _READINESS,
    E.DEVICE_CHECK_FAILED: _READINESS,
    E.AI_STATUS: "AI monitoring health — reported as coverage, never as candidate behaviour.",
    E.GAZE_AWAY: "Gaze is disabled (not a validated signal).",
    # Coding activity (coding assessments, stage C4): what the candidate did while solving a problem.
    # Facts for the timeline, never risk signals.
    # Objects in view (2026-10-02): shown to reviewers as observations with their duration and
    # confidence, but not scored until the provisional thresholds are calibrated on real data.
    E.PHONE_DETECTED: _OBJECTS,
    E.BOOK_DETECTED: _OBJECTS,
    E.LAPTOP_DETECTED: _OBJECTS,
    E.HANDHELD_DEVICE_DETECTED: _OBJECTS,
    E.CODING_QUESTION_OPENED: _CODING,
    E.CODE_PASTED: _CODING,
    E.CODE_RUN_REQUESTED: _CODING,
    E.CODE_SUBMITTED: _CODING,
    E.CODE_LANGUAGE_CHANGED: _CODING,
}

# --- correlation ---------------------------------------------------------------------------------
#: Signals whose spans come within this many seconds of each other form one window.
CORRELATION_WINDOW_SECONDS = 30.0
#: …and the window counts as correlated only if it spans at least this many event categories.
CORRELATION_MIN_CATEGORIES = 2
#: A correlated window adds this fraction of its members' points…
CORRELATION_BONUS_FRACTION = 0.25
#: …capped at this many points.
CORRELATION_BONUS_CAP = 15.0

# --- decay and aggregation -----------------------------------------------------------------------
#: A contribution halves every this many seconds after its signal ended.
HALF_LIFE_SECONDS = 600.0
MAX_SCORE = 100
#: PRD FR-015 bands (inclusive upper bounds): 0–25 Normal, 26–50 Low, 51–75 Medium, 76–100 High.
BANDS: tuple[tuple[int, Level], ...] = ((25, "NORMAL"), (50, "LOW"), (75, "MEDIUM"), (100, "HIGH"))

#: The AI statuses in which the AI was measuring (anything else is a coverage gap).
AI_MEASURING = frozenset({"RUNNING", "DEGRADED"})

INTERPRETATION = (
    "This risk score summarises observable events for human review. It is not a determination that "
    "the candidate cheated, and it does not reject anyone."
)
LIMITATIONS = (
    "Most signals are reported by the candidate's app, which the server cannot fully trust: a missing "
    "signal is not proof that nothing happened. All times are the server's. Values are provisional "
    f"(policy {POLICY_VERSION})."
)


def level_for(score: int) -> Level:
    for upper, level in BANDS:
        if score <= upper:
            return level
    return BANDS[-1][1]
