"""AI Assistant LLM provider — Gemini API, urllib only, no extra dependencies.

Follows the same transport pattern as `services/interview/llm.py` (urllib, explicit timeout,
SecretStr key). The key is read once from Settings and never logged, returned or included in
error messages.

Gemini generateContent API (v1beta).
"""

import json
import logging
import socket
import urllib.error
import urllib.request
from typing import Any

log = logging.getLogger("assessx.ai_assistant.provider")

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_TIMEOUT = 30.0


class AssistantProviderError(Exception):
    """A provider call that produced no usable output.

    `retryable` says whether trying again could help.
    """

    def __init__(self, message: str, retryable: bool = False) -> None:
        super().__init__(message[:200])
        self.retryable = retryable


def _http_post(url: str, headers: dict[str, str], body: bytes, timeout: float) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, method="POST", headers=headers)  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


class GeminiProvider:
    """Gemini generateContent provider for the AI Assistant."""

    name = "gemini"

    def __init__(self, api_key: str, model: str, timeout: float = DEFAULT_TIMEOUT) -> None:
        self._key = api_key
        self.model = model
        self._timeout = timeout

    def chat(
        self,
        system_instruction: str,
        history: list[dict[str, Any]],
        user_message: str,
    ) -> str:
        """Send a conversational message and return the assistant's text reply.
        Tries the configured model and automatically falls back if 404 (model retired) or 503 (busy).
        """
        candidate_models = [self.model]
        for fallback in ("gemini-flash-lite-latest", "gemini-3.8-flash", "gemini-flash-latest"):
            if fallback not in candidate_models:
                candidate_models.append(fallback)

        contents: list[dict[str, Any]] = list(history)
        contents.append({"role": "user", "parts": [{"text": user_message}]})

        payload = {
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "contents": contents,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 8192,
            },
        }

        body = json.dumps(payload).encode()
        headers = {"Content-Type": "application/json"}

        last_error = "No response from AI provider"

        for model_name in candidate_models:
            url = f"{GEMINI_BASE_URL}/{model_name}:generateContent?key={self._key}"
            try:
                status, raw = _http_post(url, headers, body, self._timeout)
            except TimeoutError:
                last_error = "Request timed out"
                continue
            except urllib.error.URLError as error:
                if isinstance(error.reason, (TimeoutError, socket.timeout)):
                    last_error = "Request timed out"
                else:
                    last_error = "Provider unreachable"
                continue
            except OSError:
                last_error = "Network error"
                continue

            if status == 429:
                last_error = "Rate limited — please wait a moment"
                continue
            if status in (404, 500, 502, 503, 504):
                last_error = f"Model {model_name} unavailable (HTTP {status})"
                continue
            if status != 200:
                raise AssistantProviderError(f"Provider error (HTTP {status})", retryable=False)

            try:
                data = json.loads(raw)
            except ValueError as error:
                raise AssistantProviderError("Invalid JSON from provider", retryable=False) from error

            try:
                text: str = data["candidates"][0]["content"]["parts"][0]["text"]
                return text.strip()
            except (KeyError, IndexError, TypeError) as error:
                candidates = data.get("candidates", [])
                if candidates:
                    finish_reason = candidates[0].get("finishReason", "")
                    if finish_reason == "SAFETY":
                        raise AssistantProviderError(
                            "Response blocked by safety filter", retryable=False
                        ) from error
                last_error = "No text in provider response"

        raise AssistantProviderError(last_error, retryable=True)
