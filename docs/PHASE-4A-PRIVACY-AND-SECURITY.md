# AssessX Phase 4A Privacy & Security Architecture

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4A — Proctoring Session Foundation  

---

## 1. Principles

1. **Zero Covert Recording**: Camera and microphone are only accessed in response to visible, explicit candidate prompts.
2. **Instant Hardware Deactivation**: No media stream outlives the examination component. On unmount, page change, or exam submission, tracks are explicitly stopped (`track.stop()`), ensuring physical indicator lights turn off.
3. **No Audio or Video Storage in Phase 4A**: Phase 4A only records device availability and readiness state. No audio snippets, video frames, or audio waveform data are stored on the server.
4. **Local Hardware Verification**: Audio levels are computed locally in the browser memory using `AudioContext` and `AnalyserNode` and never transmitted across the network.
5. **Strict Candidate Isolation**: Every proctoring endpoint is protected by candidate session token and verified against the candidate's active attempt ownership.

