import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision'
import type { HandObservation, LandmarkFrame, LandmarkSource } from '../types'

// Both the WASM runtime and the .task model are served from our own
// public/ directory — vendored into the repo at build time — never from a
// CDN. See README "Third-party attribution" for what these files are.
const WASM_BASE_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`
const MODEL_PATH = `${import.meta.env.BASE_URL}mediapipe/models/hand_landmarker.task`

export class CameraSourceError extends Error {}

/**
 * Live webcam hand tracking via MediaPipe Tasks Vision, running entirely
 * client-side (WASM). The video stream and every frame of inference stay in
 * the browser tab — nothing is ever uploaded anywhere, no API key, no
 * network call. This class only emits LandmarkFrame objects, same shape as
 * ReplaySource, so nothing downstream needs to know a real camera is
 * involved.
 */
export class CameraSource implements LandmarkSource {
  readonly label = 'Live camera'
  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private landmarker: HandLandmarker | null = null
  private rafHandle: number | null = null
  private stopped = false

  async start(onFrame: (frame: LandmarkFrame) => void): Promise<void> {
    this.stopped = false

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      })
    } catch (err) {
      throw new CameraSourceError(
        `Camera unavailable or permission denied: ${(err as Error).message}`,
      )
    }
    this.stream = stream

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    this.video = video

    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH)
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })

    const loop = () => {
      if (this.stopped || !this.landmarker || !this.video) return
      const now = performance.now()
      let result: HandLandmarkerResult
      try {
        result = this.landmarker.detectForVideo(this.video, now)
      } catch {
        this.rafHandle = requestAnimationFrame(loop)
        return
      }
      const hands: HandObservation[] = result.landmarks.map((landmarks, i) => ({
        handedness: (result.handedness[i]?.[0]?.categoryName === 'Left'
          ? 'Left'
          : 'Right') as HandObservation['handedness'],
        landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      }))
      onFrame({ t: now, hands })
      this.rafHandle = requestAnimationFrame(loop)
    }
    this.rafHandle = requestAnimationFrame(loop)
  }

  stop(): void {
    this.stopped = true
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle)
      this.rafHandle = null
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }
    this.landmarker?.close()
    this.landmarker = null
  }
}
