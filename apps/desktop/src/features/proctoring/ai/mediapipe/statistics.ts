import type { FrameStatistics } from './protocol'

/**
 * Global luminance statistics of an RGBA pixel buffer (Phase 5B frame quality).
 *
 * Uses Rec. 709 luma weights on the sRGB values — an approximation of luminance, which is all a
 * factual "how bright / how flat is this frame" measure needs. It reports numbers only; it does not
 * decide that a frame is "too dark" (no threshold is documented, so none is invented).
 *
 * Pure and allocation-free so it can run on a downscaled copy of every sampled frame.
 */
export function frameStatistics(rgba: ArrayLike<number>): FrameStatistics | null {
  const pixels = Math.floor(rgba.length / 4)
  if (pixels === 0) return null
  let sum = 0
  let sumSquares = 0
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4
    const luma = (0.2126 * (rgba[offset] ?? 0) + 0.7152 * (rgba[offset + 1] ?? 0) + 0.0722 * (rgba[offset + 2] ?? 0)) / 255
    sum += luma
    sumSquares += luma * luma
  }
  const mean = sum / pixels
  const variance = Math.max(0, sumSquares / pixels - mean * mean)
  return { meanLuminance: mean, luminanceStdDev: Math.sqrt(variance) }
}
