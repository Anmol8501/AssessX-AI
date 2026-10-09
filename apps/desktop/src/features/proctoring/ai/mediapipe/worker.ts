/// <reference lib="webworker" />
/**
 * Phase 5B MediaPipe inference worker.
 *
 * All computer-vision work happens here, off the exam's UI thread. The page transfers each sampled
 * frame (an `ImageBitmap`, moved, not copied); the worker runs the face detector, the face
 * landmarker (only when there is a face to measure) and the object detector on it, closes the bitmap,
 * and posts back a small factual result (see `protocol.ts` for what is — and deliberately is not —
 * returned). Models are loaded once per worker and reused for every frame. Nothing is stored,
 * written or sent anywhere else.
 */
import { FaceDetector, FaceLandmarker, ObjectDetector, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { RunningObjectModel } from '../objectDetection/models'
import { regionsFor } from '../objectDetection/tiling'
import type { YoloxBackend } from '../objectDetection/yoloxBackend'
import { frameStatistics } from './statistics'
import {
  EYE_BLENDSHAPES,
  type Accelerator,
  type DetectedFace,
  type DetectedObject,
  type EyeBlendshape,
  type LandmarkedFace,
  type MediaPipePayload,
  type NormalizedBox,
  type ObjectBackendReport,
  type PosePoint,
  type TaskName,
  type TaskStatus,
  type WorkerLoadConfig,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol'

interface Scope {
  postMessage(message: WorkerResponse): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}
const scope = self as unknown as Scope

/** Width of the downscaled copy used for luminance statistics; height follows the aspect ratio. */
const STATISTICS_WIDTH = 64

let faceDetector: FaceDetector | null = null
let faceLandmarker: FaceLandmarker | null = null
/** Framing: whether the head and upper body (to the chest) are in view — shoulders only. */
let poseLandmarker: PoseLandmarker | null = null
let objectDetector: ObjectDetector | null = null
/** The YOLOX object model (default); exactly one of this or `objectDetector` is used. */
let yolox: YoloxBackend | null = null
let objectModel: RunningObjectModel = 'efficientdet_lite0'
/** Processed frames so far, for the object detector's region rotation (see objectDetection/tiling.ts). */
let objectFrameIndex = 0
let lastTimestamp = 0
let statisticsCanvas: OffscreenCanvas | null = null

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

type GlobalWithFactory = typeof globalThis & { ModuleFactory?: unknown }
let moduleFactory: unknown = null

/**
 * Supplies MediaPipe's WebAssembly module factory before each task is created.
 *
 * In a module worker MediaPipe loads its runtime with `import()`. The ES-module loader publishes
 * `globalThis.ModuleFactory` only when it is first evaluated, and MediaPipe clears that global after
 * creating each task — so without this, every task after the first fails with "ModuleFactory not
 * set". The factory is the loader's default export; it is re-supplied here for every task (and for
 * the CPU retry), and each task still gets its own WebAssembly instance.
 */
async function supplyModuleFactory(loaderPath: string): Promise<void> {
  if (!moduleFactory) {
    const loaded = (await import(/* @vite-ignore */ loaderPath)) as { default?: unknown }
    moduleFactory = loaded.default ?? (globalThis as GlobalWithFactory).ModuleFactory ?? null
    if (!moduleFactory) throw new Error('MediaPipe runtime loader did not provide a module factory')
  }
  ;(globalThis as GlobalWithFactory).ModuleFactory = moduleFactory
}

/** Creates one task on the preferred delegate, falling back to CPU. Returns the delegate used. */
async function createTask<T>(
  make: (delegate: Accelerator) => Promise<T>,
  preferGpu: boolean,
  loaderPath: string,
): Promise<{ task: T; accelerator: Accelerator }> {
  if (preferGpu) {
    try {
      await supplyModuleFactory(loaderPath)
      return { task: await make('GPU'), accelerator: 'GPU' }
    } catch {
      // No usable GPU/WebGL in this environment: CPU is the documented fallback, reported as such.
    }
  }
  await supplyModuleFactory(loaderPath)
  return { task: await make('CPU'), accelerator: 'CPU' }
}

async function load(config: WorkerLoadConfig): Promise<WorkerResponse> {
  const fileset: Parameters<typeof FaceDetector.createFromOptions>[0] = { wasmLoaderPath: config.wasmLoaderPath, wasmBinaryPath: config.wasmBinaryPath }
  const tasks: Record<TaskName, 'READY' | 'UNAVAILABLE'> = {
    faceDetector: 'UNAVAILABLE',
    faceLandmarker: 'UNAVAILABLE',
    objectDetector: 'UNAVAILABLE',
    poseLandmarker: 'UNAVAILABLE',
  }
  const accelerators: Accelerator[] = []
  const errors: string[] = []

  try {
    const created = await createTask(
      (delegate) =>
        FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: config.models.faceDetector, delegate },
          runningMode: 'VIDEO',
        }),
      config.preferGpu,
      config.wasmLoaderPath,
    )
    faceDetector = created.task
    accelerators.push(created.accelerator)
    tasks.faceDetector = 'READY'
  } catch (error) {
    errors.push(`faceDetector: ${errorText(error)}`)
  }

  try {
    const created = await createTask(
      (delegate) =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: config.models.faceLandmarker, delegate },
          runningMode: 'VIDEO',
          numFaces: config.landmarkerMaxFaces,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        }),
      config.preferGpu,
      config.wasmLoaderPath,
    )
    faceLandmarker = created.task
    accelerators.push(created.accelerator)
    tasks.faceLandmarker = 'READY'
  } catch (error) {
    errors.push(`faceLandmarker: ${errorText(error)}`)
  }

  try {
    const created = await createTask(
      (delegate) =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: config.models.poseLandmarker, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          outputSegmentationMasks: false,
        }),
      config.preferGpu,
      config.wasmLoaderPath,
    )
    poseLandmarker = created.task
    accelerators.push(created.accelerator)
    tasks.poseLandmarker = 'READY'
  } catch (error) {
    errors.push(`poseLandmarker: ${errorText(error)}`)
  }

  // Object detection: YOLOX (ONNX Runtime; default — YOLOX-S on WebGPU, else YOLOX-Tiny) or, for
  // comparison builds, EfficientDet-Lite0 (MediaPipe). A failed YOLOX load is reported as unavailable
  // — never silently replaced by EfficientDet, whose scores mean something different.
  objectFrameIndex = 0
  let objectBackend: ObjectBackendReport | null = null
  if (config.objectModel === 'yolox' || config.objectModel === 'yolox_s' || config.objectModel === 'yolox_tiny') {
    try {
      const { YoloxBackend } = await import('../objectDetection/yoloxBackend')
      yolox = await YoloxBackend.create(config.objectModel, config.yolox)
      objectBackend = yolox.report
      objectModel = yolox.report.model
      tasks.objectDetector = 'READY'
    } catch (error) {
      errors.push(`objectDetector (${config.objectModel}): ${errorText(error)}`)
    }
  } else if (config.objectModel === 'efficientdet_lite0') {
    objectModel = 'efficientdet_lite0'
    const objectStarted = performance.now()
    try {
      const created = await createTask(
        (delegate) =>
          ObjectDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: config.models.objectDetector, delegate },
            runningMode: 'VIDEO',
            categoryAllowlist: config.objectCategories,
            // The model's metadata sets no score cut-off, so it would return every anchor as a
            // candidate. Only the most confident few are requested (enough for the best of each
            // reported class); thresholds are applied by the event layer, per model.
            maxResults: 12,
          }),
        config.preferGpu,
        config.wasmLoaderPath,
      )
      objectDetector = created.task
      accelerators.push(created.accelerator)
      tasks.objectDetector = 'READY'
      objectBackend = {
        model: 'efficientdet_lite0',
        accelerator: created.accelerator,
        loadMs: performance.now() - objectStarted,
        warmupMs: null,
        firstInferenceMs: null,
        fallback: null,
      }
    } catch (error) {
      errors.push(`objectDetector: ${errorText(error)}`)
    }
  } else {
    errors.push(`objectDetector: unknown object model "${String(config.objectModel)}"`)
  }

  if (!Object.values(tasks).includes('READY')) {
    return { type: 'load-failed', error: errors.join('; ') || 'No MediaPipe task could be loaded.' }
  }
  // "GPU" only when every loaded task really runs on the GPU; any CPU fallback is reported as CPU.
  const accelerator: Accelerator = accelerators.every((value) => value === 'GPU') ? 'GPU' : 'CPU'
  return { type: 'loaded', tasks, accelerator, objectBackend, errors }
}

function normalize(box: { originX: number; originY: number; width: number; height: number }, width: number, height: number): NormalizedBox {
  return { x: box.originX / width, y: box.originY / height, width: box.width / width, height: box.height / height }
}

function landmarkBox(points: { x: number; y: number }[]): NormalizedBox {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) }
}

function statistics(bitmap: ImageBitmap) {
  const width = STATISTICS_WIDTH
  const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width))
  if (!statisticsCanvas) statisticsCanvas = new OffscreenCanvas(width, height)
  statisticsCanvas.width = width
  statisticsCanvas.height = height
  const context = statisticsCanvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(bitmap, 0, 0, width, height)
  const result = frameStatistics(context.getImageData(0, 0, width, height).data)
  context.clearRect(0, 0, width, height) // the downscaled copy is not kept
  return result
}

async function infer(bitmap: ImageBitmap, timestampMs: number): Promise<MediaPipePayload> {
  // MediaPipe VIDEO mode needs strictly increasing timestamps per task.
  const timestamp = Math.max(lastTimestamp + 1, Math.round(timestampMs))
  lastTimestamp = timestamp
  const { width, height } = bitmap
  const tasks: Record<TaskName, TaskStatus> = {
    faceDetector: faceDetector ? 'OK' : 'UNAVAILABLE',
    faceLandmarker: faceLandmarker ? 'OK' : 'UNAVAILABLE',
    objectDetector: objectDetector || yolox ? 'OK' : 'UNAVAILABLE',
    poseLandmarker: poseLandmarker ? 'OK' : 'UNAVAILABLE',
  }
  const timingsMs = { statistics: 0, faceDetector: 0, faceLandmarker: 0, objectDetector: 0, poseLandmarker: 0, total: 0 }
  const started = performance.now()

  let mark = performance.now()
  const frameStats = statistics(bitmap)
  timingsMs.statistics = performance.now() - mark

  let faces: DetectedFace[] | null = null
  if (faceDetector) {
    mark = performance.now()
    try {
      const result = faceDetector.detectForVideo(bitmap, timestamp)
      faces = result.detections
        .filter((detection) => detection.boundingBox)
        .map((detection) => ({
          box: normalize(detection.boundingBox!, width, height),
          score: detection.categories[0]?.score ?? null,
        }))
    } catch {
      tasks.faceDetector = 'FAILED'
    }
    timingsMs.faceDetector = performance.now() - mark
  }

  let landmarkedFaces: LandmarkedFace[] | null = null
  if (faceLandmarker) {
    if (tasks.faceDetector === 'OK' && faces !== null && faces.length === 0) {
      tasks.faceLandmarker = 'SKIPPED' // no face to measure; the face detector already said so
    } else {
      mark = performance.now()
      try {
        const result = faceLandmarker.detectForVideo(bitmap, timestamp)
        landmarkedFaces = result.faceLandmarks.map((points, index) => {
          const categories = result.faceBlendshapes[index]?.categories ?? null
          let eyes: Partial<Record<EyeBlendshape, number>> | null = null
          if (categories) {
            eyes = {}
            for (const category of categories) {
              if ((EYE_BLENDSHAPES as readonly string[]).includes(category.categoryName)) {
                eyes[category.categoryName as EyeBlendshape] = category.score
              }
            }
          }
          const matrix = result.facialTransformationMatrixes[index]
          return {
            box: landmarkBox(points), // only the extent leaves the worker — never the landmarks
            transform: matrix && matrix.data.length === 16 ? Array.from(matrix.data) : null,
            eyes,
          }
        })
      } catch {
        tasks.faceLandmarker = 'FAILED'
      }
      timingsMs.faceLandmarker = performance.now() - mark
    }
  }

  // Framing: the shoulders of the first person, when there is a face to frame.
  let shoulders: [PosePoint, PosePoint] | null = null
  if (poseLandmarker) {
    if (tasks.faceDetector === 'OK' && faces !== null && faces.length === 0) {
      tasks.poseLandmarker = 'SKIPPED' // nobody to frame; "no face" is already reported
    } else {
      mark = performance.now()
      try {
        const result = poseLandmarker.detectForVideo(bitmap, timestamp)
        const pose = result.landmarks[0]
        const point = (index: number): PosePoint => {
          const p = pose?.[index]
          return { x: p?.x ?? -1, y: p?.y ?? -1, visibility: p?.visibility ?? 0 }
        }
        // MediaPipe pose indices 11 and 12: left and right shoulder. No pose = both invisible.
        shoulders = [point(11), point(12)]
      } catch {
        tasks.poseLandmarker = 'FAILED'
      }
      timingsMs.poseLandmarker = performance.now() - mark
    }
  }

  let objects: DetectedObject[] | null = null
  const regions = regionsFor(objectFrameIndex++, yolox ? yolox.provider : 'mediapipe')
  if ((objectDetector || yolox) && regions.length === 0) {
    tasks.objectDetector = 'SKIPPED' // not this frame (CPU path runs every other frame): unknown, not "nothing"
  } else if (objectDetector) {
    mark = performance.now()
    try {
      const result = objectDetector.detectForVideo(bitmap, timestamp)
      objects = result.detections
        .filter((detection) => detection.boundingBox && detection.categories[0])
        .map((detection) => ({
          category: detection.categories[0]!.categoryName,
          score: detection.categories[0]!.score ?? null,
          box: normalize(detection.boundingBox!, width, height),
          region: 'full' as const,
        }))
    } catch {
      tasks.objectDetector = 'FAILED'
    }
    timingsMs.objectDetector = performance.now() - mark
  } else if (yolox) {
    mark = performance.now()
    try {
      objects = await yolox.detect(bitmap, regions)
    } catch {
      tasks.objectDetector = 'FAILED'
    }
    timingsMs.objectDetector = performance.now() - mark
  }

  timingsMs.total = performance.now() - started
  return { kind: 'mediapipe', tasks, objectModel, faces, landmarkedFaces, objects, shoulders, statistics: frameStats, timingsMs }
}

function dispose() {
  faceDetector?.close()
  faceLandmarker?.close()
  poseLandmarker?.close()
  objectDetector?.close()
  void yolox?.release()
  yolox = null
  faceDetector = null
  faceLandmarker = null
  poseLandmarker = null
  objectDetector = null
  statisticsCanvas = null
}

scope.onmessage = (event) => {
  const request = event.data
  if (request.type === 'load') {
    void load(request.config).then(
      (response) => scope.postMessage(response),
      (error: unknown) => scope.postMessage({ type: 'load-failed', error: errorText(error) }),
    )
  } else if (request.type === 'infer') {
    // Asynchronous because YOLOX inference is; the page sends one frame at a time, so frames never
    // overlap here. The bitmap is closed only once every task has finished with it.
    void infer(request.bitmap, request.timestampMs)
      .then(
        (payload) => scope.postMessage({ type: 'result', id: request.id, payload }),
        (error: unknown) => scope.postMessage({ type: 'infer-failed', id: request.id, error: errorText(error) }),
      )
      .finally(() => request.bitmap.close()) // the frame is discarded as soon as inference is done
  } else if (request.type === 'dispose') {
    dispose()
    scope.postMessage({ type: 'disposed' })
  }
}
