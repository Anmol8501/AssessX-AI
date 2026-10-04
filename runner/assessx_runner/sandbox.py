"""Runs one job in Docker sandboxes and returns a raw report. It never judges correctness.

Per job:

1. The source is written to a fresh temporary folder on the runner host. That folder is the only thing
   ever mounted into a container.
2. **Compile** (compiled languages) in a throwaway container:
   * no network, read-only root filesystem, a small `/tmp` in memory;
   * non-root user, every capability dropped, no privilege escalation;
   * a process limit, and memory and CPU limits;
   * a time limit enforced from outside; compiler output is capped.
3. **Run** each test in its own fresh container (it only *sleeps*; the test is a `docker exec`), with:
   * the problem's memory limit applied to the container;
   * the code folder mounted **read-only**;
   * the candidate's input on stdin, and output read through capped buffers;
   * the time limit enforced inside the container by `timeout -s KILL`.

   The container is removed after the test, so nothing — a file, a background process — reaches the
   next test. (Otherwise a submission could stash a hidden test's input and print it in a sample test's
   visible output.)
4. Everything is removed afterwards (containers carry a label, so a crashed runner's leftovers are swept
   at the next start).

The runner's own environment, including its token, is never passed into a container. A job is first
checked against the runner's own language profiles and bounds (`policy.check_job`): anything else is
refused before Docker is touched.
"""

import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from assessx_runner.policy import check_job

LABEL = "assessx-runner=1"
UNPRIVILEGED = "65534:65534"  # nobody:nogroup
PIDS_LIMIT = "64"
TMPFS = "/tmp:rw,nosuid,nodev,size=64m"
#: Extra wall-clock margin before the host gives up on a container (the in-container timeout fires first).
HOST_MARGIN_S = 5.0
KEEP_COMPILE = 65_536


@dataclass
class SandboxConfig:
    docker: str = "docker"
    #: e.g. "runsc" for gVisor, when installed on the host. Empty: Docker's default runtime.
    runtime: str = ""
    cpus: str = "1"
    extra_args: list[str] = field(default_factory=list)
    #: Image tag → pinned `repo@sha256:…` (`RUNNER_IMAGE_PINS`). Unpinned tags run as named.
    pins: dict[str, str] = field(default_factory=dict)


def _base_args(
    config: SandboxConfig, name: str, memory_mb: int, workdir: str, mount_mode: str, mode_flag: str
) -> list[str]:
    """`docker run` with every sandbox restriction; `mode_flag` is `--rm` (compile) or `-d` (test host)."""
    args = [
        config.docker, "run", mode_flag, "--name", name, "--label", LABEL,
        "--network", "none",
        "--read-only",
        "--tmpfs", TMPFS,
        "--memory", f"{memory_mb}m", "--memory-swap", f"{memory_mb}m",
        "--cpus", config.cpus,
        "--pids-limit", PIDS_LIMIT,
        "--user", UNPRIVILEGED,
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--ulimit", "nofile=64:64",
        "--ulimit", "fsize=16777216:16777216",
        "--env", "PYTHONDONTWRITEBYTECODE=1",
        "--hostname", "sandbox",
        "-v", f"{workdir}:/work:{mount_mode}",
        "-w", "/work",
    ]
    if config.runtime:
        args += ["--runtime", config.runtime]
    return args + config.extra_args


def _remove(config: SandboxConfig, name: str) -> None:
    subprocess.run([config.docker, "rm", "-f", name], capture_output=True, timeout=30, check=False)


def sweep(config: SandboxConfig) -> None:
    """Removes containers a previous (crashed) runner left behind."""
    found = subprocess.run(
        [config.docker, "ps", "-aq", "--filter", f"label={LABEL}"], capture_output=True, text=True, timeout=30, check=False
    )
    for cid in found.stdout.split():
        subprocess.run([config.docker, "rm", "-f", cid], capture_output=True, timeout=30, check=False)


@dataclass
class Captured:
    exit_code: int | None
    stdout: bytes
    stderr: bytes
    elapsed_ms: int
    host_timeout: bool
    output_overflow: bool


def _capture(argv: list[str], stdin: bytes, wall_s: float, limit: int) -> Captured:
    """Runs argv, feeding stdin and reading at most `limit` bytes of each stream (never more into memory)."""
    started = time.monotonic()
    proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    buffers = {"out": bytearray(), "err": bytearray()}
    overflow = threading.Event()

    def pump(stream: Any, key: str) -> None:
        while True:
            chunk = stream.read(8192)
            if not chunk:
                return
            room = limit + 1 - len(buffers[key])
            if room > 0:
                buffers[key].extend(chunk[:room])
            if len(buffers[key]) > limit:
                overflow.set()

    threads = [
        threading.Thread(target=pump, args=(proc.stdout, "out"), daemon=True),
        threading.Thread(target=pump, args=(proc.stderr, "err"), daemon=True),
    ]
    for t in threads:
        t.start()
    try:
        if stdin:
            proc.stdin.write(stdin)
        proc.stdin.close()
    except (BrokenPipeError, OSError):
        pass
    host_timeout = False
    deadline = started + wall_s
    while proc.poll() is None:
        if overflow.is_set() or time.monotonic() > deadline:
            host_timeout = not overflow.is_set()
            proc.kill()
            break
        time.sleep(0.01)
    proc.wait()
    for t in threads:
        t.join(timeout=2)
    elapsed = int((time.monotonic() - started) * 1000)
    return Captured(proc.returncode, bytes(buffers["out"][:limit]), bytes(buffers["err"][:limit]), elapsed, host_timeout, overflow.is_set())


#: Memory accounting files, cgroup v2 first, then v1 (e.g. Docker Desktop on WSL2 uses v1).
_OOM_FILES = ("/sys/fs/cgroup/memory.events", "/sys/fs/cgroup/memory/memory.oom_control")
_PEAK_FILES = ("/sys/fs/cgroup/memory.peak", "/sys/fs/cgroup/memory/memory.max_usage_in_bytes")


def _read_first(config: SandboxConfig, name: str, paths: tuple[str, ...]) -> str:
    probe = subprocess.run(
        [config.docker, "exec", name, "cat", *paths], capture_output=True, text=True, timeout=15, check=False
    )
    return probe.stdout


def _oom_kills(config: SandboxConfig, name: str) -> int:
    """How many processes the kernel has killed for memory in this container so far."""
    for line in _read_first(config, name, _OOM_FILES).splitlines():
        key, _, value = line.partition(" ")
        if key == "oom_kill":
            return int(value.strip() or 0)
    return 0


def _peak_kb(config: SandboxConfig, name: str) -> int | None:
    for line in _read_first(config, name, _PEAK_FILES).splitlines():
        if line.strip().isdigit():
            return int(line.strip()) // 1024
    return None


def _decode(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def run_job(job: dict[str, Any], config: SandboxConfig | None = None) -> dict[str, Any]:
    """Runs one claimed job. Returns the raw report the API judges."""
    config = config or SandboxConfig()
    profile = check_job(job)  # raises JobRejected: nothing outside the profiles ever reaches Docker
    image = config.pins.get(profile.image, profile.image)
    job_tag = uuid.uuid4().hex[:12]
    workdir = tempfile.mkdtemp(prefix="assessx-")
    names: list[str] = []
    try:
        os.chmod(workdir, 0o777)  # the unprivileged sandbox user writes compiled output here
        source_path = os.path.join(workdir, profile.source_file)
        with open(source_path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(job["source"])
        os.chmod(source_path, 0o644)

        limit = int(job.get("output_limit_bytes", 65_536))
        report: dict[str, Any] = {"compile": None, "tests": [], "memory_kb": None}

        if profile.compile:
            name = f"assessx-c-{job_tag}"
            names.append(name)
            argv = _base_args(config, name, int(job["compile_memory_mb"]), workdir, "rw", "--rm") + [image, *profile.compile]
            compiled = _capture(argv, b"", job["compile_time_limit_ms"] / 1000 + HOST_MARGIN_S, KEEP_COMPILE)
            _remove(config, name)
            ok = compiled.exit_code == 0 and not compiled.host_timeout
            output = _decode(compiled.stdout + compiled.stderr)
            if compiled.host_timeout:
                output = (output + "\nCompilation took too long.").strip()
            report["compile"] = {"ok": ok, "output": output[:KEEP_COMPILE]}
            if not ok:
                return report

        time_limit_s = max(0.1, job["time_limit_ms"] / 1000)
        memory_mb = int(job["memory_limit_mb"])
        peak: int | None = None

        # One fresh container per test, removed straight after: nothing a test leaves behind (files in
        # /tmp, a background process) can reach the next test — so a submission cannot carry a hidden
        # test's input into a sample test's visible output.
        for index, test in enumerate(job["tests"]):
            container = f"assessx-r-{job_tag}-{index}"
            names.append(container)
            argv = _base_args(config, container, memory_mb, workdir, "ro", "-d") + [image, "sleep", "3600"]
            subprocess.run(argv, capture_output=True, timeout=60, check=True)
            run = [config.docker, "exec", "-i", container, "timeout", "-s", "KILL", f"{time_limit_s:.3f}", *profile.run]
            result = _capture(run, test.get("input", "").encode("utf-8"), time_limit_s + HOST_MARGIN_S, limit)
            oom = _oom_kills(config, container) > 0 if not result.host_timeout else False
            if result.output_overflow:
                outcome = "OUTPUT_LIMIT"
            elif oom:
                outcome = "MEMORY_LIMIT"
            # `timeout` reports a time-out as 124, or 137 when the KILL itself is reported; -9 is the host's kill.
            elif result.host_timeout or result.exit_code == 124 or (
                result.exit_code in (137, -9) and result.elapsed_ms >= time_limit_s * 1000 * 0.9
            ):
                outcome = "TIME_LIMIT"
            elif result.exit_code == 0:
                outcome = "OK"
            else:
                outcome = "RUNTIME_ERROR"
            report["tests"].append(
                {
                    "id": test["id"],
                    "outcome": outcome,
                    "exit_code": result.exit_code,
                    "runtime_ms": min(result.elapsed_ms, int(time_limit_s * 1000)) if outcome == "TIME_LIMIT" else result.elapsed_ms,
                    "stdout": _decode(result.stdout),
                    "stderr": _decode(result.stderr),
                }
            )
            current = _peak_kb(config, container)
            if current is not None:
                peak = max(peak or 0, current)
            _remove(config, container)
        report["memory_kb"] = peak
        return report
    finally:
        for name in names:
            _remove(config, name)
        shutil.rmtree(workdir, ignore_errors=True)
