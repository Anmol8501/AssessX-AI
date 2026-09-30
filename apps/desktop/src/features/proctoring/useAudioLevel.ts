import { useEffect, useState } from 'react'

/**
 * A 0–1 input level for a microphone stream, so the candidate can see that it picks them up.
 *
 * Computed locally from an `AnalyserNode` a few times a second. Nothing is recorded, buffered
 * beyond the analyser's own window, or sent anywhere, and the audio graph is closed as soon as the
 * stream goes away or the component unmounts.
 */
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!stream || typeof AudioContext === 'undefined') return
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser) // not connected to the speakers: the candidate does not hear themselves
    const samples = new Uint8Array(analyser.fftSize)

    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) {
        const centred = (sample - 128) / 128
        sum += centred * centred
      }
      // RMS, scaled up so ordinary speech moves the bar visibly.
      setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4))
    }, 120)

    return () => {
      window.clearInterval(timer)
      source.disconnect()
      void context.close()
      setLevel(0)
    }
  }, [stream])

  return stream ? level : 0
}
