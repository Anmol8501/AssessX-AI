"""Self-contained HTML5 mobile secondary-camera page served by the API origin.

Allows candidates to scan the QR code from a smartphone over HTTPS
(`https://assessx-backend-.../mobile-camera`) so `getUserMedia()` runs in a Browser Secure
Context and connects same-origin to WebRTC signaling, ICE/TURN config, and pairing/heartbeat
endpoints.
"""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

_MOBILE_CAMERA_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>AssessX Secondary Camera</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 14px 16px;
      border-bottom: 1px solid #1e293b;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .brand { font-weight: 700; font-size: 15px; letter-spacing: -0.01em; }
    .pill {
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 999px;
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
    }
    .pill.ok {
      background: rgba(16, 185, 129, 0.16);
      color: #34d399;
      border-color: rgba(16, 185, 129, 0.4);
    }
    .pill.err {
      background: rgba(244, 63, 94, 0.16);
      color: #fb7185;
      border-color: rgba(244, 63, 94, 0.4);
    }
    main {
      flex: 1;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 640px;
      width: 100%;
      margin: 0 auto;
    }
    .meta {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 13px;
    }
    .meta strong { display: block; font-size: 14px; color: #ffffff; }
    .meta span { color: #94a3b8; font-size: 12px; }
    .video-wrap {
      position: relative;
      aspect-ratio: 16/9;
      background: #020617;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid #334155;
    }
    video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .badge {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(2, 6, 23, 0.75);
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-family: ui-monospace, monospace;
      color: #34d399;
    }
    .controls { display: flex; gap: 10px; flex-wrap: wrap; }
    button {
      flex: 1;
      min-width: 140px;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #1e293b;
      color: #f8fafc;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    button.primary { background: #2563eb; border-color: #3b82f6; }
    .msg {
      font-size: 12.5px;
      line-height: 1.5;
      color: #cbd5e1;
      background: #1e293b;
      border-radius: 10px;
      padding: 12px;
      border: 1px solid #334155;
    }
    .msg.err {
      border-color: rgba(244, 63, 94, 0.4);
      background: rgba(244, 63, 94, 0.12);
      color: #fecdd3;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">AssessX &middot; Room Camera</div>
    <div id="status-pill" class="pill">Connecting&hellip;</div>
  </header>
  <main>
    <div class="meta">
      <strong id="exam-title">Secondary Camera Pairing</strong>
      <span id="candidate-name">Authenticating pairing token&hellip;</span>
    </div>
    <div class="video-wrap">
      <video id="preview" autoplay playsinline muted></video>
      <div id="stream-badge" class="badge">STANDBY</div>
    </div>
    <div class="controls">
      <button id="flip-btn" type="button" class="primary">Switch Front / Back Camera</button>
    </div>
    <div id="status-msg" class="msg">
      Keep this browser tab open and place your phone to the side so your desk,
      screen edge, and upper body stay visible during the exam.
    </div>
  </main>
  <script>
    (function () {
      const qs = new URLSearchParams(window.location.search);
      let sessionId = qs.get("session_id") || "";
      let token = qs.get("token") || "";
      if ((!sessionId || !token) && window.location.hash.includes("?")) {
        const hashPart = window.location.hash;
        const hq = new URLSearchParams(hashPart.slice(hashPart.indexOf("?")));
        sessionId = sessionId || hq.get("session_id") || "";
        token = token || hq.get("token") || "";
      }

      const pill = document.getElementById("status-pill");
      const titleEl = document.getElementById("exam-title");
      const candEl = document.getElementById("candidate-name");
      const badgeEl = document.getElementById("stream-badge");
      const msgEl = document.getElementById("status-msg");
      const videoEl = document.getElementById("preview");
      const flipBtn = document.getElementById("flip-btn");

      let facingMode = "environment";
      let mobileToken = null;
      let stream = null;
      let ws = null;
      let pc = null;
      let hbTimer = null;
      let batteryLevel = null;

      if (navigator.getBattery) {
        navigator.getBattery().then((b) => {
          batteryLevel = Math.round(b.level * 100);
          b.addEventListener("levelchange", () => {
            batteryLevel = Math.round(b.level * 100);
          });
        }).catch(() => {});
      }

      function setPill(text, cls) {
        pill.textContent = text;
        pill.className = "pill" + (cls ? " " + cls : "");
      }

      function setError(text) {
        setPill("Error", "err");
        msgEl.textContent = text;
        msgEl.className = "msg err";
      }

      async function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Camera access requires HTTPS or localhost in this browser.");
        }
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
          audio: false,
        });
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});
        badgeEl.textContent = "CAMERA LIVE";
      }

      async function connectSignaling() {
        if (ws) { try { ws.close(); } catch (_) {} }
        if (pc) { try { pc.close(); } catch (_) {} }

        const sid = encodeURIComponent(sessionId);
        const mTok = encodeURIComponent(mobileToken);
        const iceUrl = `/api/v1/proctoring/secondary-camera/${sid}/ice-servers`;
        const iceRes = await fetch(iceUrl).catch(() => null);
        const iceData = iceRes && iceRes.ok ? await iceRes.json() : null;
        const iceServers =
          (iceData && iceData.ice_servers) || [{ urls: "stun:stun.l.google.com:19302" }];

        const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsPath = `/api/v1/proctoring/secondary-camera/ws/${sid}`;
        const wsUrl = `${wsProto}//${window.location.host}${wsPath}?role=mobile&token=${mTok}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
          pc = new RTCPeerConnection({ iceServers });
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));
          pc.onicecandidate = (e) => {
            if (e.candidate && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
            }
          };
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({ type: "offer", sdp: offer }));
          setPill("Streaming Live", "ok");
        };

        ws.onmessage = async (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === "answer" && pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            } else if (msg.type === "candidate" && pc) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } else if (msg.type === "peer_connected" && pc && pc.localDescription) {
              ws.send(JSON.stringify({ type: "offer", sdp: pc.localDescription }));
            }
          } catch (_) {}
        };

        ws.onclose = () => {
          setPill("Reconnecting...", "");
        };
      }

      flipBtn.addEventListener("click", async () => {
        facingMode = facingMode === "environment" ? "user" : "environment";
        try {
          await startCamera();
          if (mobileToken) await connectSignaling();
        } catch (err) {
          setError(err.message || "Unable to switch camera.");
        }
      });

      async function boot() {
        if (!sessionId || !token) {
          setError("Invalid QR code link: missing session ID or pairing token.");
          return;
        }
        try {
          setPill("Pairing...", "");
          const dims = `${window.screen.width}x${window.screen.height}`;
          const pairRes = await fetch("/api/v1/proctoring/secondary-camera/pair", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionId,
              token,
              device_info: `${navigator.userAgent} (${dims})`,
            }),
          });
          if (!pairRes.ok) {
            const errBody = await pairRes.json().catch(() => ({}));
            const msg =
              (errBody.error && errBody.error.message) ||
              errBody.detail ||
              `Pairing failed (${pairRes.status})`;
            throw new Error(msg);
          }
          const paired = await pairRes.json();
          mobileToken = paired.mobile_token;
          titleEl.textContent = paired.assessment_title || "Proctored Assessment";
          candEl.textContent = `Candidate: ${paired.candidate_name || "Paired"}`;

          await startCamera();
          await connectSignaling();

          if (hbTimer) clearInterval(hbTimer);
          hbTimer = setInterval(() => {
            fetch("/api/v1/proctoring/secondary-camera/heartbeat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                session_id: sessionId,
                mobile_token: mobileToken,
                battery_level: batteryLevel,
                status: "STREAMING",
              }),
            }).catch(() => {});
          }, 10000);
        } catch (err) {
          setError(err && err.message ? err.message : "Failed to pair secondary camera.");
        }
      }

      boot();
    })();
  </script>
</body>
</html>
"""


@router.get("/mobile-camera", include_in_schema=False)
def serve_mobile_camera_page() -> HTMLResponse:
    """Serve the HTTPS mobile secondary-camera pairing and WebRTC streaming page."""
    return HTMLResponse(
        content=_MOBILE_CAMERA_HTML,
        headers={
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Cache-Control": "no-store",
            "Content-Security-Policy": (
                "default-src 'self' 'unsafe-inline'; "
                "connect-src 'self' wss: ws:; "
                "media-src * blob:; "
                "frame-ancestors 'none'"
            ),
        },
    )
