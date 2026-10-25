# AssessX Mini Replica

This folder is a small, dependency-free replica of the main AssessX workflow.
It is intentionally a learning/demo implementation, not a production exam
client or a security boundary.

## Included

- Public landing page (`apps/web`)
- Desktop-style candidate/admin app (`apps/desktop`)
- In-memory API with sessions, role checks, assessments, attempts, answers,
  submission, and objective scoring (`backend/server.py`)
- Seed accounts and one sample assessment
- API smoke tests (`backend/test_server.py`)
- Additional dependency-free backend examples for catalogs, workflows,
  profiles, reporting, events, notifications, auditing, flags, metrics,
  filtering, and serialization

## Run

From this folder:

```text
python start.py
```

Open:

- http://127.0.0.1:8100/web/
- http://127.0.0.1:8100/desktop/

Development accounts:

| Role | Email | Password |
| --- | --- | --- |
| Candidate | candidate@example.com | candidate123 |
| Admin | admin@example.com | admin123 |

Run the smoke tests with:

```text
python -m unittest discover -s backend -p "test_*.py"
```

The extra modules in `backend/` are intentionally isolated demo building
blocks. They do not change the API server's in-memory state or add external
dependencies, so they can be imported independently while experimenting with
the replica.

The API stores state in memory and resets when the process stops. It has no
database, real authentication, native lockdown, camera processing, AI scoring,
or code execution sandbox.
