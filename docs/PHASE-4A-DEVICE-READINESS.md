# AssessX Phase 4A Device Readiness Specification
## Camera & Microphone Enumeration, Verification and Policy Engine

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4A  
**Module:** Module C — Device Readiness Check  

---

## 1. Readiness State Space

AssessX defines unambiguous readiness states that distinguish between hardware unavailability, permission blockage, driver faults, and active streaming:

| Status Code | Description | Candidate Guidance |
| :--- | :--- | :--- |
| `NOT_CHECKED` | Devices have not yet been evaluated. | Initiate readiness verification. |
| `CHECKING` | Webview is currently probing hardware streams. | "Checking camera and microphone…" |
| `READY` | Camera and microphone streams verified active. | Device check passed. Proceed to exam. |
| `CAMERA_UNAVAILABLE` | No camera hardware detected on machine. | Connect a webcam or enable camera in device manager. |
| `CAMERA_PERMISSION_DENIED` | Windows or webview access blocked. | Allow AssessX access in Windows Settings → Privacy & Security → Camera. |
| `CAMERA_INITIALIZATION_FAILED` | Camera in use by another application. | Close Zoom, Teams, or other apps using the camera. |
| `MICROPHONE_UNAVAILABLE` | No microphone hardware detected. | Connect a microphone or audio headset. |
| `MICROPHONE_PERMISSION_DENIED` | Microphone permission denied. | Allow AssessX access in Windows Settings → Privacy & Security → Microphone. |
| `MICROPHONE_INITIALIZATION_FAILED` | Audio device driver failed or busy. | Close applications using the microphone. |
| `DEVICE_DISCONNECTED` | Device was unplugged during testing/exam. | Reconnect the device to resume. |
| `PARTIALLY_READY` | Camera is ready, microphone optional. | Microphone not connected, but exam permits camera-only. |
| `FAILED` | Critical device failure occurred. | Contact exam administrator. |

---

## 2. Policy-Driven Evaluation Rules

AssessX evaluates readiness against the specific examination's proctoring rules:
```ts
export interface DevicePolicy {
  requireCamera: boolean
  requireMicrophone: boolean
}
```

* **Standard Proctoring (Default):** Requires both Camera and Microphone to be `READY`.
* **Camera-Only Proctoring:** Requires Camera to be `READY`; Microphone missing or unavailable results in `PARTIALLY_READY`, which allows exam entry.
* **Failure Precedence:** Permission denial (`DENIED`) takes precedence over initialization errors (`ERROR`), giving candidates clear instructions on operating system settings.

