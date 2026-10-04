"""What this runner agrees to run (coding assessments, stage C5). Defence in depth.

The API sends each job's image, file name and commands. The runner does not take them on trust: a job
must match one of the language profiles below *exactly*, and its limits and sizes must be within
bounds, or it is refused and reported as a runner failure (never scored against the candidate). So even
a compromised or impersonated API cannot make this runner start another image, run another command,
write outside its temporary folder, or lift the sandbox's limits.

The profiles mirror the API's registry (`backend/app/services/coding/languages.py`); a backend test
checks the two never drift apart.

Images can be pinned to an exact digest on the runner host with `RUNNER_IMAGE_PINS`, e.g.
`python:3.12-slim=python@sha256:…,gcc:14=gcc@sha256:…`: the job still names the tag, and the runner
runs the pinned image instead, so an updated tag upstream changes nothing until the operator re-pins.
"""

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True)
class Profile:
    image: str
    source_file: str
    compile: tuple[str, ...] | None
    run: tuple[str, ...]


PROFILES: dict[str, Profile] = {
    "python": Profile("python:3.12-slim", "main.py", None, ("python3", "-I", "main.py")),
    "c": Profile("gcc:14", "main.c", ("gcc", "-O2", "-std=c17", "-o", "main", "main.c", "-lm"), ("./main",)),
    "cpp": Profile("gcc:14", "main.cpp", ("g++", "-O2", "-std=c++20", "-o", "main", "main.cpp"), ("./main",)),
    "java": Profile(
        "eclipse-temurin:21-jdk",
        "Main.java",
        ("javac", "-encoding", "UTF-8", "Main.java"),
        ("java", "-XX:+UseSerialGC", "-XX:-UsePerfData", "-Xss64m", "Main"),
    ),
}

#: Upper bounds a job may ask for. The API's own limits are lower; these only stop an abusive job.
MAX_TIME_LIMIT_MS = 30_000
MAX_MEMORY_MB = 2048
MAX_COMPILE_TIME_LIMIT_MS = 60_000
MAX_OUTPUT_LIMIT_BYTES = 1_048_576
MAX_SOURCE_BYTES = 262_144
MAX_INPUT_BYTES = 262_144
MAX_TESTS = 100

_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")
_DIGEST = re.compile(r"^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def is_job_id(value: object) -> bool:
    """Safe to put in a URL path (a job id is a UUID)."""
    return isinstance(value, str) and bool(_ID.match(value))


class JobRejected(Exception):
    """The job is outside what this runner agrees to run."""


def _int_between(job: dict[str, Any], key: str, low: int, high: int) -> int:
    value = job.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise JobRejected(f"{key} out of bounds")
    return value


def check_job(job: dict[str, Any]) -> Profile:
    """Returns the job's language profile, or raises `JobRejected`. Never echoes the source or inputs."""
    if not isinstance(job, dict):
        raise JobRejected("not a job")
    if not is_job_id(job.get("id")):
        raise JobRejected("bad job id")
    profile = PROFILES.get(job.get("language"))  # type: ignore[arg-type]
    if profile is None:
        raise JobRejected("unknown language")
    compile_ = tuple(job["compile"]) if isinstance(job.get("compile"), list) else job.get("compile")
    run = tuple(job["run"]) if isinstance(job.get("run"), list) else None
    if (job.get("image"), job.get("source_file"), compile_, run) != (
        profile.image,
        profile.source_file,
        profile.compile,
        profile.run,
    ):
        raise JobRejected("image or commands do not match the language profile")

    source = job.get("source")
    if not isinstance(source, str) or len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise JobRejected("source missing or too large")
    _int_between(job, "time_limit_ms", 100, MAX_TIME_LIMIT_MS)
    _int_between(job, "memory_limit_mb", 16, MAX_MEMORY_MB)
    _int_between(job, "compile_time_limit_ms", 1_000, MAX_COMPILE_TIME_LIMIT_MS)
    _int_between(job, "compile_memory_mb", 64, MAX_MEMORY_MB)
    _int_between(job, "output_limit_bytes", 1_024, MAX_OUTPUT_LIMIT_BYTES)

    tests = job.get("tests")
    if not isinstance(tests, list) or not 1 <= len(tests) <= MAX_TESTS:
        raise JobRejected("bad test list")
    for test in tests:
        if (
            not isinstance(test, dict)
            or set(test) - {"id", "input"}
            or not isinstance(test.get("id"), str)
            or not _ID.match(test["id"])
            or not isinstance(test.get("input", ""), str)
            or len(test.get("input", "").encode("utf-8")) > MAX_INPUT_BYTES
        ):
            raise JobRejected("bad test")
    return profile


def parse_pins(text: str) -> dict[str, str]:
    """`tag=repo@sha256:…` pairs, comma-separated. Only tags a profile uses can be pinned."""
    known = {p.image for p in PROFILES.values()}
    pins: dict[str, str] = {}
    for item in filter(None, (part.strip() for part in text.split(","))):
        tag, _, pinned = item.partition("=")
        tag, pinned = tag.strip(), pinned.strip()
        if tag not in known:
            raise ValueError(f"RUNNER_IMAGE_PINS: {tag!r} is not an image this runner uses")
        if not _DIGEST.match(pinned):
            raise ValueError(f"RUNNER_IMAGE_PINS: the pin for {tag!r} must be repo@sha256:<64 hex digits>")
        pins[tag] = pinned
    return pins


def check_api_url(url: str) -> str:
    """HTTPS only (the token travels in a header), except to this machine for local development."""
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.hostname:
        return url
    if parsed.scheme == "http" and parsed.hostname in _LOCAL_HOSTS:
        return url
    raise ValueError("RUNNER_API_URL must be https:// (plain http is allowed only to localhost)")
