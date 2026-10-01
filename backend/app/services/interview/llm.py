"""Phase 7B — the AI provider behind answer evaluation. Server-side only.

`EvaluationProvider` is the one seam: a provider receives the system instructions, the user message and
the strict output schema, and returns the tool input it produced — nothing else. It never touches the
database or interview state. There is one real adapter (Anthropic's Messages API, with a forced tool call
for structured output) and one labelled, deterministic test double (`stub`, development/test only).

The API key is held in `Settings.llm_api_key` (a `SecretStr`), read only when building the request
header, and never logged, returned or included in an error message. Calls use the standard library
(`urllib`, as `services/ice.py` does) with an explicit timeout: no new dependency.
"""

import json
import logging
import re
import socket
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from app.core.config import Settings
from app.models.interview_evaluation import EvaluationFailure
from app.services.interview.prompts import TOOL_NAME

log = logging.getLogger("assessx.interviews.llm")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
MAX_OUTPUT_TOKENS = 1024


class ProviderError(Exception):
    """A provider call that produced no usable tool output.

    `retryable` says whether trying again could help."""

    def __init__(self, failure: EvaluationFailure, retryable: bool, detail: str = "") -> None:
        super().__init__(f"{failure.value}: {detail}"[:200])
        self.failure = failure
        self.retryable = retryable


@dataclass(frozen=True)
class EvaluationRequest:
    system: str
    user: str
    schema: dict[str, Any]
    #: For the stub only: the rubric's dimension keys, the number of expected concepts and the answer.
    dimensions: tuple[str, ...]
    concept_count: int
    answer: str


@dataclass(frozen=True)
class ProviderResult:
    payload: Any
    input_tokens: int | None = None
    output_tokens: int | None = None


class EvaluationProvider(Protocol):
    name: str
    model: str

    def evaluate(self, request: EvaluationRequest) -> ProviderResult: ...


Transport = Callable[[str, dict[str, str], bytes, float], tuple[int, bytes]]


def _http_post(url: str, headers: dict[str, str], body: bytes, timeout: float) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, method="POST", headers=headers)  # noqa: S310 — fixed https URL
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, timeout: float, transport: Transport = _http_post) -> None:
        self._key = api_key
        self.model = model
        self._timeout = timeout
        self._transport = transport

    def evaluate(self, request: EvaluationRequest) -> ProviderResult:
        body = json.dumps(
            {
                "model": self.model,
                "max_tokens": MAX_OUTPUT_TOKENS,
                "temperature": 0,
                "system": request.system,
                "tools": [
                    {
                        "name": TOOL_NAME,
                        "description": "Record the structured evaluation of the candidate answer.",
                        "input_schema": request.schema,
                    }
                ],
                "tool_choice": {"type": "tool", "name": TOOL_NAME},
                "messages": [{"role": "user", "content": request.user}],
            }
        ).encode()
        headers = {
            "x-api-key": self._key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        try:
            status, raw = self._transport(ANTHROPIC_URL, headers, body, self._timeout)
        except TimeoutError as error:
            raise ProviderError(EvaluationFailure.TIMEOUT, retryable=True) from error
        except urllib.error.URLError as error:
            if isinstance(error.reason, (TimeoutError, socket.timeout)):
                raise ProviderError(EvaluationFailure.TIMEOUT, retryable=True) from error
            raise ProviderError(
                EvaluationFailure.PROVIDER_ERROR, retryable=True, detail="unreachable"
            ) from error
        except OSError as error:
            raise ProviderError(EvaluationFailure.PROVIDER_ERROR, retryable=True, detail="network") from error

        if status == 429:
            raise ProviderError(EvaluationFailure.RATE_LIMITED, retryable=True)
        if status in (500, 502, 503, 504, 529):
            raise ProviderError(EvaluationFailure.PROVIDER_ERROR, retryable=True, detail=f"http {status}")
        if status == 413:
            raise ProviderError(EvaluationFailure.INPUT_TOO_LONG, retryable=False)
        if status != 200:
            # 400/401/403/404: configuration or request problems — retrying cannot help. The body is not
            # echoed (it may quote the request); only the status is kept.
            raise ProviderError(EvaluationFailure.PROVIDER_ERROR, retryable=False, detail=f"http {status}")
        try:
            data = json.loads(raw)
        except ValueError as error:
            raise ProviderError(
                EvaluationFailure.INVALID_OUTPUT, retryable=False, detail="not json"
            ) from error
        blocks = data.get("content") if isinstance(data, dict) else None
        tool = next(
            (
                b
                for b in blocks or []
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == TOOL_NAME
            ),
            None,
        )
        if tool is None:
            raise ProviderError(EvaluationFailure.INVALID_OUTPUT, retryable=False, detail="no tool output")
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        return ProviderResult(
            payload=tool.get("input"),
            input_tokens=usage.get("input_tokens") if isinstance(usage.get("input_tokens"), int) else None,
            output_tokens=usage.get("output_tokens") if isinstance(usage.get("output_tokens"), int) else None,
        )


_STUB_LEVEL = re.compile(r"\[\[stub:(strong|weak|invalid)\]\]", re.IGNORECASE)


class StubProvider:
    """A deterministic **test double** — not AI. Allowed only in development/test (`Settings` refuses it
    in production) and labelled `model="stub"` on every evaluation it produces.

    It returns mid-range scores, or strong / weak ones when the answer contains `[[stub:strong]]` /
    `[[stub:weak]]` (so automated tests can drive the adaptive policy), or invalid output for
    `[[stub:invalid]]` (so they can exercise the failure path).
    """

    name = "stub"
    model = "stub"

    def evaluate(self, request: EvaluationRequest) -> ProviderResult:
        match = _STUB_LEVEL.search(request.answer)
        level = match.group(1).lower() if match else "mid"
        if level == "invalid":
            return ProviderResult(payload={"dimension_scores": "not an object"})
        score = {"strong": 9, "weak": 2, "mid": 6}[level]
        concepts = list(range(request.concept_count))
        return ProviderResult(
            payload={
                "dimension_scores": dict.fromkeys(request.dimensions, score),
                "present_concept_indexes": concepts if level == "strong" else [],
                "missing_concept_indexes": [] if level == "strong" else concepts,
                "incorrect_points": [],
                "strengths": [] if level == "weak" else ["Stub: the answer addresses the question."],
                "evidence_quotes": [],
                "feedback": f"Stub evaluation ({level}). Not an AI assessment.",
                "confidence": 0.9,
            },
            input_tokens=0,
            output_tokens=0,
        )


def provider_from_settings(settings: Settings) -> EvaluationProvider | None:
    """The configured provider, or None (evaluations are then recorded as unavailable)."""
    if settings.llm_provider == "anthropic" and settings.llm_api_key is not None:
        return AnthropicProvider(
            settings.llm_api_key.get_secret_value(), settings.llm_model, settings.llm_timeout_seconds
        )
    if settings.llm_provider == "stub" and not settings.is_production:
        return StubProvider()
    return None
