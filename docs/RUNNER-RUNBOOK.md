# Code runner runbook

How to operate the AssessX code runner: before, during and after an exam, and when something goes
wrong. To set a runner up the first time, see [`runner/README.md`](../runner/README.md).

Everything here is free: Docker, the official language images, Python, and optionally gVisor. Nothing
is paid, and nothing needs a new account.

## What the runner is, in one paragraph

Candidates' code never runs on the API (Render). Run and Submit put a job in the `code_executions`
table. A separate machine, the runner, asks the API for jobs over HTTPS with `RUNNER_TOKEN`. It runs
each test in its own fresh Docker container (no network, read-only, unprivileged, limited) and sends
the raw output back. The API compares that output with the expected answers, which only the API holds,
and scores it. The runner has no database access and no open ports. It refuses any job that does not
match its own language profiles (see *Security model*).

## Before an exam

| Check | How | Expected |
|---|---|---|
| The runner is up | its log, or `systemctl status assessx-runner` | `Runner runner-1 started …` and no repeated `API unreachable` |
| It can reach the API and the token matches | the log | no `Claim refused (HTTP 401)` |
| The images are present | `docker image ls` | `python:3.12-slim`, `gcc:14`, `eclipse-temurin:21-jdk` (or your pinned digests) |
| End to end | in AssessX: open a coding problem with a reference solution → **Validate test cases** | it finishes within seconds and passes |
| Disk space | `df -h /var/lib/docker /tmp` | several GB free |
| Capacity | see *Capacity* | enough runners for the exam's size |

Turn on coding only when a runner is running. On Render, `CODING_EXECUTION_ENABLED=true` requires
`RUNNER_TOKEN`: a production API refuses to start with the first and not the second.

## During an exam

* **Normal log lines:** `Job <id> done in 4.2s (HTTP 204)`, one per Run or Submit.
* **Queue depth.** This is a read-only query, safe to run in the Supabase SQL editor. It changes
  nothing.
  ```sql
  select kind, status, count(*) from code_executions
  where created_at > now() - interval '1 hour'
  group by kind, status order by kind, status;
  ```
  A steadily growing `QUEUED` count means the runners are not keeping up. Add a runner (see
  *Capacity*).
* **What candidates see:** "Queued", then "Running", then the verdict. If an exam ends while a
  submission is queued, their result says "Your code is being evaluated" until it is judged.

## Incidents

| Symptom | Likely cause | What to do | Effect on candidates |
|---|---|---|---|
| Jobs stay *Queued* | the runner is down or can't reach the API | restart it, then check `RUNNER_API_URL` and the network | Runs wait. Nothing is lost: queued jobs run when the runner is back. |
| Log shows `Claim refused (HTTP 401)` | the token differs between Render and the runner | copy the token again, exactly, to both | as above |
| Log shows `Claim refused (HTTP 404)` | `RUNNER_TOKEN` is not set on Render | set it and redeploy | as above |
| Log shows `refused by runner policy: …` | the API asked for an image or command the runner does not allow. This usually means the API and runner versions differ. | update the runner folder to the same version as the API | That job becomes a *system error*, never the candidate's mistake. They can submit again. |
| A job runs, then becomes *System error* | Docker failed, or the runner crashed mid-job (it is retried up to 3 times, 180 s apart) | `docker info`, disk space, the runner's log | System errors never count against the candidate |
| Exam ended, results say "being evaluated" for a long time | submissions are still queued | bring a runner back. After 10 minutes, still-pending submissions are failed as system errors and the result is produced without them. | Scores come only from judged submissions |
| Runner host misbehaving or suspected compromised | — | **stop the runner** (`systemctl stop assessx-runner`) and remove its containers: `docker rm -f $(docker ps -aq --filter label=assessx-runner=1)`. Then change the token (see below) and rebuild the host. | Runs wait until a clean runner is back |

**Stopping all code execution.** Stopping every runner is the switch: nothing is executed anywhere
else. Setting `CODING_EXECUTION_ENABLED=false` on Render only stops *new* coding assessments from being
published. Exams already running keep queueing jobs.

## Changing the runner token

Do this by hand when you choose to, for example after a suspected leak or when someone with access
leaves. Nothing rotates it automatically.

1. Make a new token: `python -c "import secrets; print(secrets.token_urlsafe(48))"` (at least 32
   characters). It must not be the same as `SECRET_KEY`.
2. Set it on Render (`RUNNER_TOKEN`) and on each runner host (its env file), then restart both.
3. Between the two restarts the runner gets `401` and jobs wait in the queue. Nothing is lost.
   Prefer a quiet time, not during an exam.

The token belongs only on Render and on runner hosts. It must never be in the desktop app, the
repository, a screenshot or a chat.

## Updating images and pinning them

The runner can pin each image to an exact digest, so a tag that changes upstream changes nothing until
you decide:

```
docker pull python:3.12-slim && docker image inspect --format '{{index .RepoDigests 0}}' python:3.12-slim
# → python@sha256:…   (repeat for gcc:14 and eclipse-temurin:21-jdk)

RUNNER_IMAGE_PINS=python:3.12-slim=python@sha256:…,gcc:14=gcc@sha256:…,eclipse-temurin:21-jdk=eclipse-temurin@sha256:…
```

To update:
1. pull the new image;
2. read its digest;
3. run the runner's tests on the host (`python -m pytest tests -q`), which include the attack tests;
4. change the pin and restart.

Do this monthly, and outside exam hours.

## Capacity

* One runner runs one job at a time. Each test starts a fresh container (about 0.5–1 s), so a 10-test
  submission takes about 5–10 s, and a sample-only Run about 1–3 s.
* Rough sizing: a runner handles about 6–10 submissions a minute. For a 50-candidate exam, plan for
  2–3 runners.
* Candidates are limited to 10 Runs and 3 Submits per minute each. The whole queue is capped at 500
  waiting jobs; beyond that, Run and Submit say "busy, try again".
* **More runners:** start another copy, on the same host or another one, with its own `RUNNER_ID` and
  the same token. Jobs are handed out safely (`FOR UPDATE SKIP LOCKED`).

## Security model (what protects what)

| Layer | Protects against |
|---|---|
| Runner policy (`runner/assessx_runner/policy.py`) | A job must match a built-in language profile exactly: same image, file name and commands, with bounded limits and sizes. Otherwise it is refused before Docker is touched. A compromised or impersonated API still cannot make the runner run another image or command, or write outside its temporary folder. |
| HTTPS-only API URL | The runner refuses a plain-`http` URL except to localhost, so the token is never sent unencrypted. |
| Sandbox flags | No network; read-only root and code; private small `/tmp`; user `nobody`; no capabilities; no privilege escalation; process, memory, CPU, file and output limits; a time limit enforced inside the container. |
| One container per test | Nothing (files, processes) carries from one test to the next, so a hidden input cannot be leaked into a sample's visible output. |
| No expected outputs on the runner | A compromised runner cannot learn the answers. It can only lie about outputs, and the API compares those itself: a forged "pass" is impossible, and a missing result is a system error. |
| Bounded reports | The API rejects reports with unknown fields, any verdict, or oversized output. |
| gVisor (optional, `RUNNER_DOCKER_RUNTIME=runsc`) | A user-space kernel: makes container escapes much harder. |
| A dedicated host | The final boundary. Run nothing else on it, and give it no database or cloud credentials. |

**Tested** (`runner/tests/test_attacks.py`) against real Docker, in Python, C, C++ and Java each:
* network access;
* writes to the code folder and the system;
* the Docker socket;
* the runner's token, in the environment and in every process inside the sandbox;
* the user and its capabilities;
* files carried between tests;
* infinite loops, memory bombs, endless output, and fork or thread bombs.

C and C++ also get a compile-time bomb. The runner's policy is tested in `runner/tests/test_policy.py`.
The API side (forged reports, hidden-data sweeps, size limits, configuration) is tested in
`backend/tests/test_coding_hardening.py`.

**Not guaranteed:** no sandbox is unbreakable. Treat the runner host as one that runs hostile code, and
keep it isolated.
