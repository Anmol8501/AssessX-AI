"""Small dependency-free API and static-file server for the replica."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
TOKENS: dict[str, str] = {}
USERS = {
    "candidate@example.com": {"password": "candidate123", "role": "candidate", "name": "Demo Candidate"},
    "admin@example.com": {"password": "admin123", "role": "admin", "name": "Demo Admin"},
}
ASSESSMENTS = [
    {
        "id": "python-basics",
        "title": "Python Basics",
        "duration_minutes": 15,
        "status": "READY",
        "questions": [
            {"id": "q1", "text": "Which keyword defines a function in Python?", "options": ["func", "def", "function", "lambda"], "answer": "def"},
            {"id": "q2", "text": "What type is returned by len([1, 2])?", "options": ["str", "bool", "int", "list"], "answer": "int"},
            {"id": "q3", "text": "Which value represents no value?", "options": ["None", "Empty", "Null", "Void"], "answer": "None"},
        ],
    }
]
ATTEMPTS: dict[str, dict] = {}


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def public_assessment(assessment: dict) -> dict:
    return {key: value for key, value in assessment.items() if key != "questions"} | {
        "questions": [{key: value for key, value in question.items() if key != "answer"} for question in assessment["questions"]]
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        return

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def user(self) -> dict | None:
        token = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        email = TOKENS.get(token)
        return USERS.get(email)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            json_response(self, 200, {"status": "ok", "database": "in-memory"})
            return
        if path == "/api/me":
            user = self.user()
            json_response(self, 200 if user else 401, {"user": user} if user else {"error": "unauthorized"})
            return
        if path == "/api/assessments":
            user = self.user()
            if not user:
                json_response(self, 401, {"error": "unauthorized"})
            elif user["role"] == "admin":
                json_response(self, 200, {"assessments": [public_assessment(item) for item in ASSESSMENTS]})
            else:
                json_response(self, 200, {"assessments": [public_assessment(item) for item in ASSESSMENTS]})
            return
        if path.startswith("/api/attempts/"):
            attempt = ATTEMPTS.get(path.rsplit("/", 1)[-1])
            if not attempt or not self.user():
                json_response(self, 404, {"error": "attempt not found"})
            else:
                json_response(self, 200, {"attempt": attempt})
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        data = self.read_json()
        if path == "/api/login":
            user = USERS.get(str(data.get("email", "")).lower())
            if not user or user["password"] != data.get("password"):
                json_response(self, 401, {"error": "invalid email or password"})
                return
            token = secrets.token_urlsafe(18)
            TOKENS[token] = str(data["email"]).lower()
            json_response(self, 200, {"token": token, "user": user})
            return
        if path == "/api/attempts":
            user = self.user()
            assessment = next((item for item in ASSESSMENTS if item["id"] == data.get("assessment_id")), None)
            if not user or user["role"] != "candidate":
                json_response(self, 403, {"error": "candidate access required"})
            elif not assessment:
                json_response(self, 404, {"error": "assessment not found"})
            else:
                attempt_id = secrets.token_hex(6)
                ATTEMPTS[attempt_id] = {
                    "id": attempt_id, "assessment_id": assessment["id"], "candidate": user["name"],
                    "status": "IN_PROGRESS", "answers": {}, "score": None,
                }
                json_response(self, 201, {"attempt": ATTEMPTS[attempt_id], "assessment": public_assessment(assessment)})
            return
        if path.startswith("/api/attempts/") and path.endswith("/submit"):
            user = self.user()
            attempt_id = path.split("/")[3]
            attempt = ATTEMPTS.get(attempt_id)
            if not user or user["role"] != "candidate" or not attempt:
                json_response(self, 403, {"error": "attempt access denied"})
                return
            assessment = next(item for item in ASSESSMENTS if item["id"] == attempt["assessment_id"])
            answers = data.get("answers", {})
            score = sum(answers.get(question["id"]) == question["answer"] for question in assessment["questions"])
            attempt.update({"answers": answers, "score": score, "total": len(assessment["questions"]), "status": "SUBMITTED"})
            json_response(self, 200, {"attempt": attempt})
            return
        json_response(self, 404, {"error": "route not found"})

    def serve_static(self, path: str) -> None:
        relative = "apps/web/index.html" if path in {"/", "/web", "/web/"} else "apps/desktop/index.html" if path in {"/desktop", "/desktop/"} else ""
        if path.startswith("/desktop/") and path.endswith(".js"):
            relative = "apps/desktop/app.js"
        elif path.startswith("/desktop/") and path.endswith(".css"):
            relative = "apps/desktop/styles.css"
        elif path.startswith("/web/") and path.endswith(".css"):
            relative = "apps/web/styles.css"
        if not relative:
            json_response(self, 404, {"error": "not found"})
            return
        file = ROOT / relative
        if not file.exists():
            json_response(self, 404, {"error": "asset not found"})
            return
        content_type = "text/javascript" if file.suffix == ".js" else "text/css" if file.suffix == ".css" else "text/html"
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8100), Handler)
    print("AssessX Mini running at http://127.0.0.1:8100/desktop/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
