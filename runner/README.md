# AssessX code runner

The runner runs candidates' code for AssessX coding assessments. It is a **separate program on a separate
machine**, never the API's Render service, because candidate code is untrusted. It uses only free
software: Python's standard library, Docker and the official free language images, plus gVisor if you
add it.

```
Desktop app ──HTTPS──▶ AssessX API (Render) ──▶ job queue (PostgreSQL)
                                   ▲  claim / result (HTTPS, X-Runner-Token)
                     this runner ──┘   no database access, no open ports
                        └─ one fresh Docker sandbox per test
```

## How it works

1. The runner asks the API for a job (`POST /api/v1/internal/runner/claim`) about once a second when
   idle.
2. A job contains:
   * the language's image and commands;
   * the source;
   * the limits;
   * the test **inputs**.

   It never contains expected outputs, so the runner cannot judge, and a compromised runner cannot learn
   the answers.

   The runner checks every job against its **own** language profiles before touching Docker
   (`assessx_runner/policy.py`):
   * the same image, file name and commands;
   * limits and sizes within bounds;
   * safe ids.

   Anything else is refused and reported as a runner failure. So even a compromised or impersonated
   API cannot make it run another image or command.
3. Compiled languages compile in a throwaway container.
4. **Every test runs in its own fresh container**, which is removed straight after. Nothing a test
   leaves behind (files, background processes) reaches the next test.
5. The runner reports raw results: exit status, output, time, peak memory. **The API judges**: it
   compares outputs with the expected answers it alone holds.

### Sandbox restrictions (every container)

| Restriction | Setting |
|---|---|
| No network | `--network none` |
| Read-only system; code mounted read-only while tests run | `--read-only`, `-v …:/work:ro` |
| Small scratch space in memory | `--tmpfs /tmp:size=64m,nosuid,nodev` |
| Unprivileged user | `--user 65534:65534` (nobody) |
| No capabilities, no privilege escalation | `--cap-drop ALL`, `--security-opt no-new-privileges` |
| Memory limit (no swap) | `--memory`, `--memory-swap` = the problem's limit |
| CPU | `--cpus 1` |
| Process limit (contains fork bombs) | `--pids-limit 64` |
| Open-file and file-size limits | `--ulimit nofile=64`, `--ulimit fsize=16 MB` |
| Time limit, enforced inside the container | `timeout -s KILL` |
| Output limit | 64 KB per stream, read through capped buffers |
| Clean environment | Only `PYTHONDONTWRITEBYTECODE` is set. The runner's own environment (its token) is never passed in. |
| Optional gVisor | `RUNNER_DOCKER_RUNTIME=runsc`: a user-space kernel between the code and the host |

**Tested** against real Docker in `runner/tests/test_sandbox.py` and, in all four languages,
`runner/tests/test_attacks.py`. The job policy is tested without Docker in `runner/tests/test_policy.py`.
Together they cover:
* the normal cases in Python, C, C++ and Java;
* infinite loops, memory bombs, endless output and fork bombs;
* network access, writes to the code folder and the system, files surviving between tests;
* leakage of the runner's environment, and the program's user id.

### What this does *not* guarantee

No sandbox is unbreakable. Container escapes exist (gVisor makes them much harder; nothing makes them
impossible). The real safety boundary is **what the runner host can reach**:
* run it on a machine with nothing else on it;
* give it no database URL and no Render or Supabase credentials — it never needs them;
* allow it outbound HTTPS to the API only.

Anyone in the `docker` group effectively has root on the host, so treat the host as dedicated to running
untrusted code.

## Free hosting options

| Option | Cost | Notes |
|---|---|---|
| **Oracle Cloud "Always Free" VM** (Ampere A1 or AMD micro) | free | Runs 24/7. A card is needed for sign-up verification. Free capacity is not always available in every region. |
| **Any spare PC or laptop with Docker** (Linux, or Windows with Docker Desktop) | free | Must be switched on and online during exams. |
| Your own laptop, while testing | free | What this repository's tests use. |

Neither the API nor the desktop app needs to change between these options; only `RUNNER_API_URL` and
`RUNNER_TOKEN` matter.

## Setup

1. **Pick a long random token**, at least 32 characters, e.g.
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Keep it secret.
2. **On Render** (the API), add these environment variables and redeploy:
   * `RUNNER_TOKEN` = the token;
   * `CODING_EXECUTION_ENABLED` = `true`. This lets admins publish assessments with coding questions. Set
     it only when a runner is actually running.
3. **On the runner host:**
   1. Install Docker.
   2. Install Python 3.11 or newer.
   3. Pull the images:
      ```
      docker pull python:3.12-slim
      docker pull gcc:14
      docker pull eclipse-temurin:21-jdk
      ```
   4. Copy this `runner/` folder over.
4. **Optional, Linux only:** install gVisor (`runsc`) and set `RUNNER_DOCKER_RUNTIME=runsc`.
5. **Optional:** pin the images to exact digests with `RUNNER_IMAGE_PINS` (see
   [`docs/RUNNER-RUNBOOK.md`](../docs/RUNNER-RUNBOOK.md)).
6. **Start it.** `RUNNER_API_URL` must be `https://`; plain `http` is accepted only for `localhost`:
   ```
   export RUNNER_API_URL=https://assessx-backend-0nw6.onrender.com
   export RUNNER_TOKEN=<the token>
   export RUNNER_ID=runner-1
   cd runner && python -m assessx_runner
   ```
   On Windows (PowerShell), use `$env:RUNNER_API_URL = "…"` and so on, then `python -m assessx_runner`.
7. **Keep it running.** On Linux, a systemd service:
   ```ini
   [Unit]
   Description=AssessX code runner
   After=docker.service network-online.target
   Requires=docker.service

   [Service]
   WorkingDirectory=/opt/assessx/runner
   Environment=RUNNER_API_URL=https://assessx-backend-0nw6.onrender.com
   EnvironmentFile=/etc/assessx-runner.env   # contains RUNNER_TOKEN=… (chmod 600)
   ExecStart=/usr/bin/python3 -m assessx_runner
   Restart=always
   User=assessx-runner

   [Install]
   WantedBy=multi-user.target
   ```
   The `assessx-runner` user must be in the `docker` group.

Day-to-day operation (exam checklists, incidents, changing the token, updating images, capacity) is in
[`docs/RUNNER-RUNBOOK.md`](../docs/RUNNER-RUNBOOK.md).

## Checking it works

* **The runner's log** shows `Runner runner-1 started` and then `Job … done in …s` for each job.
* **In AssessX:** open a coding problem with a reference solution and press **Validate test cases**. It
  should finish within seconds.
* **If jobs stay "Queued":**
  * is the runner running?
  * is `RUNNER_API_URL` right?
  * does `RUNNER_TOKEN` match exactly? A wrong token logs `Claim refused (HTTP 401)`.
* **A job the runner can't finish** is retried by another claim after its lease (180 s). After 3 claims
  it becomes a *system error*, which is never counted as the candidate's mistake.

## Limits worth knowing

* **Throughput:** each test starts its own container (about 0.5–1 s of overhead), so a 10-test
  submission takes roughly 5–10 s. One runner handles one job at a time. Run more runners, each with its
  own `RUNNER_ID`, for big exams.
* **Runtime figures** are wall-clock times measured from the runner, so they include a little container
  overhead.
* **Memory figures** are the container's peak.
* **Time limits** are multiplied for slower runtimes (Python and Java get 2×). Java gets 128 MB extra for
  the JVM.

## Tests

```
cd runner
python -m pytest tests -q      # needs Docker and the three images; tests skip when they are missing
```
