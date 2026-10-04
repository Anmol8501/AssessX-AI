"""The runner loop: claim a job from the AssessX API, run it in the sandbox, report the raw results.

Configuration comes from the environment (never from a job):

* `RUNNER_API_URL` — e.g. https://assessx-backend-0nw6.onrender.com
* `RUNNER_TOKEN` — the shared secret also set as `RUNNER_TOKEN` on the API. Kept in this process only.
* `RUNNER_ID` — a name for this runner (letters, digits, `.`, `_`, `-`). Default: `runner-1`.
* `RUNNER_DOCKER_RUNTIME` — `runsc` to use gVisor when it is installed (recommended). Default: Docker's.
* `RUNNER_POLL_SECONDS` — how often to ask for work when idle. Default: 1.
* `RUNNER_IMAGE_PINS` — optional digest pins, `tag=repo@sha256:…` pairs, comma-separated.

`RUNNER_API_URL` must be https:// (plain http only to localhost). Every job is checked against the
runner's own language profiles and bounds before it runs (`policy.py`).

The runner needs no database access, no inbound ports, and only outbound HTTPS to the API.
"""

import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

from assessx_runner.policy import JobRejected, check_api_url, is_job_id, parse_pins
from assessx_runner.sandbox import SandboxConfig, run_job, sweep

log = logging.getLogger("assessx.runner")


class Api:
    def __init__(self, base_url: str, token: str, runner_id: str) -> None:
        self.base = base_url.rstrip("/") + "/api/v1/internal/runner"
        self.token = token
        self.runner_id = runner_id

    def _post(self, path: str, body: dict[str, Any], timeout: float = 30) -> tuple[int, Any]:
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "X-Runner-Token": self.token},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 — configured https URL
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            return error.code, None

    def claim(self) -> dict[str, Any] | None:
        status, body = self._post("/claim", {"runner_id": self.runner_id})
        if status == 200:
            return body
        if status != 204:
            log.warning("Claim refused (HTTP %s)", status)
        return None

    def result(self, job_id: str, report: dict[str, Any]) -> int:
        return self._post(f"/jobs/{job_id}/result", {"runner_id": self.runner_id, **report}, timeout=60)[0]

    def fail(self, job_id: str, reason: str) -> int:
        return self._post(f"/jobs/{job_id}/fail", {"runner_id": self.runner_id, "reason": reason[:500]})[0]


def serve() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    base = os.environ.get("RUNNER_API_URL")
    token = os.environ.get("RUNNER_TOKEN")
    if not base or not token:
        sys.exit("Set RUNNER_API_URL and RUNNER_TOKEN.")
    try:
        check_api_url(base)
        pins = parse_pins(os.environ.get("RUNNER_IMAGE_PINS", ""))
    except ValueError as error:
        sys.exit(str(error))
    api = Api(base, token, os.environ.get("RUNNER_ID", "runner-1"))
    config = SandboxConfig(runtime=os.environ.get("RUNNER_DOCKER_RUNTIME", ""), pins=pins)
    poll = float(os.environ.get("RUNNER_POLL_SECONDS", "1"))
    sweep(config)
    log.info(
        "Runner %s started (runtime: %s, pinned images: %d)",
        api.runner_id,
        config.runtime or "docker default",
        len(pins),
    )
    idle = poll
    while True:
        try:
            job = api.claim()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            log.warning("API unreachable: %s", error)
            time.sleep(min(idle * 2, 30))
            idle = min(idle * 2, 30)
            continue
        if job is None:
            time.sleep(idle)
            idle = min(idle * 1.5, 5)
            continue
        idle = poll
        started = time.monotonic()
        try:
            report = run_job(job, config)
            status = api.result(job["id"], report)
            log.info("Job %s done in %.1fs (HTTP %s)", job["id"], time.monotonic() - started, status)
        except JobRejected as error:
            job_id = job.get("id") if isinstance(job, dict) else None
            if is_job_id(job_id):
                log.warning("Job %s refused by the runner policy: %s", job_id, error)
                api.fail(job_id, f"refused by runner policy: {error}")
            else:
                log.warning("A job with an invalid id was refused by the runner policy: %s", error)
        except Exception as error:  # noqa: BLE001 — any failure here is the runner's, never the candidate's
            log.exception("Job %s could not run", job["id"])
            api.fail(job["id"], f"runner error: {type(error).__name__}")


if __name__ == "__main__":
    serve()
