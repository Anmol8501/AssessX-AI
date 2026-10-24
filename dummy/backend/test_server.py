import json
from http.client import HTTPConnection
from threading import Thread
import unittest

from server import Handler, ThreadingHTTPServer


class ApiSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method, path, payload=None, token=None):
        connection = HTTPConnection("127.0.0.1", self.port)
        body = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json"} if body else {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        connection.request(method, path, body, headers)
        response = connection.getresponse()
        return response.status, json.loads(response.read())

    def test_login_attempt_and_submission(self):
        status, login = self.request("POST", "/api/login", {"email": "candidate@example.com", "password": "candidate123"})
        self.assertEqual(status, 200)
        token = login["token"]
        status, started = self.request("POST", "/api/attempts", {"assessment_id": "python-basics"}, token)
        self.assertEqual(status, 201)
        attempt_id = started["attempt"]["id"]
        status, result = self.request("POST", f"/api/attempts/{attempt_id}/submit", {"answers": {"q1": "def", "q2": "int"}}, token)
        self.assertEqual(status, 200)
        self.assertEqual(result["attempt"]["score"], 2)

    def test_wrong_password_is_rejected(self):
        status, _ = self.request("POST", "/api/login", {"email": "candidate@example.com", "password": "wrong"})
        self.assertEqual(status, 401)
