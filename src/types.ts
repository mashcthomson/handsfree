// Core data contract for the whole pipeline.
//
// Both the live camera source (MediaPipe HandLandmarker) and the recorded
// replay source (bundled JSON traces) produce exactly this shape. Everything
// downstream — filtering, geometry, gesture classification, focus/a11y —
// consumes LandmarkFrame and has no idea (and no way to tell) whether the
// hand in front of it is a real webcam or a JSON file. That symmetry is what
// makes replay a true fallback rather than a demo hack: camera-denied,
// no-webcam, and "play back a recorded gesture for the demo video" are all
// the exact same code path.

export type Handedness = 'Left' | 'Right'

export interface Point3D {
  x: number // normalized [0,1], image space, left→right
  y: number // normalized [0,1], image space, top→bottom
  z: number // roughly depth, relative to wrist, negative = closer to camera
}

export interface HandObservation {
  handedness: Handedness
  /** 21 landmarks in MediaPipe HandLandmarker order (wrist=0 .. pinky tip=20) */
  landmarks: Point3D[]
}

export interface LandmarkFrame {
  /** milliseconds, monotonic within a session/trace */
  t: number
  hands: HandObservation[]
}

/** MediaPipe HandLandmarker landmark indices, named for readability. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const

/**
 * A LandmarkSource is anything that can emit a stream of LandmarkFrame
 * objects. The camera and the replay player both implement this — the rest
 * of the engine is written entirely against this interface.
 */
export interface LandmarkSource {
  /** Human-readable name shown in the UI ("Live camera", "Replay: pinch-click"). */
  readonly label: string
  /** Start emitting frames. Calls `onFrame` for every new LandmarkFrame. */
  start(onFrame: (frame: LandmarkFrame) => void): Promise<void>
  /** Stop emitting frames and release any resources (camera stream, RAF loop). */
  stop(): void
}
