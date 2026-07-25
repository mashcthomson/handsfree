import { LM, type HandObservation, type Point3D } from '../types'

/**
 * Pure landmark geometry: no filtering, no state, no gesture logic. Turns
 * 21 raw landmarks into the handful of numbers gesture classification
 * actually needs: per-finger curl, pinch distance, palm centroid/scale,
 * two-hand spread. Everything here is a function of a single frame.
 */

function dist(a: Point3D, b: Point3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function sub(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function angleBetween(a: Point3D, b: Point3D): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z
  const magA = Math.hypot(a.x, a.y, a.z) || 1e-6
  const magB = Math.hypot(b.x, b.y, b.z) || 1e-6
  const cos = Math.min(1, Math.max(-1, dot / (magA * magB)))
  return Math.acos(cos) // radians, 0 = straight, PI = fully folded back
}

/** Palm centroid: mean of wrist + the four MCP knuckle joints. Stable
 * across finger motion. */
export function palmCentroid(landmarks: Point3D[]): Point3D {
  const idx = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP]
  const sum = idx.reduce(
    (acc, i) => ({ x: acc.x + landmarks[i].x, y: acc.y + landmarks[i].y, z: acc.z + landmarks[i].z }),
    { x: 0, y: 0, z: 0 },
  )
  return { x: sum.x / idx.length, y: sum.y / idx.length, z: sum.z / idx.length }
}

/** Hand-size proxy used to normalize every other distance so results don't
 * change just because the hand moved closer to/further from the camera:
 * distance from wrist to middle-finger MCP knuckle. */
export function handScale(landmarks: Point3D[]): number {
  return Math.max(dist(landmarks[LM.WRIST], landmarks[LM.MIDDLE_MCP]), 1e-3)
}

/**
 * Curl angle (radians) at the PIP joint for one of the four fingers
 * (index/middle/ring/pinky): angle between the MCP->PIP vector and the
 * PIP->TIP vector. Near 0 = finger straight/extended. Near PI = finger
 * folded flat back onto itself (fist). This is orientation-invariant
 * (doesn't care which way the hand is rotated relative to the camera),
 * unlike a naive "is the tip above the knuckle in image-y" test, which
 * breaks the moment the hand isn't held perfectly upright — a real
 * failure mode with a webcam on a desk or workbench.
 */
export function fingerCurl(
  landmarks: Point3D[],
  mcp: number,
  pip: number,
  tip: number,
): number {
  const v1 = sub(landmarks[pip], landmarks[mcp])
  const v2 = sub(landmarks[tip], landmarks[pip])
  return angleBetween(v1, v2)
}

export interface FingerCurls {
  index: number
  middle: number
  ring: number
  pinky: number
  /** thumb uses a different joint chain (CMC->MCP vs MCP->IP) since it curls across the palm, not toward it */
  thumb: number
}

export function allFingerCurls(landmarks: Point3D[]): FingerCurls {
  return {
    index: fingerCurl(landmarks, LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_TIP),
    middle: fingerCurl(landmarks, LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_TIP),
    ring: fingerCurl(landmarks, LM.RING_MCP, LM.RING_PIP, LM.RING_TIP),
    pinky: fingerCurl(landmarks, LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_TIP),
    thumb: fingerCurl(landmarks, LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP),
  }
}

/** Mean curl of the four non-thumb fingers — the primary open-palm/fist
 * discriminator. Low = open, high = fist. */
export function meanFingerCurl(curls: FingerCurls): number {
  return (curls.index + curls.middle + curls.ring + curls.pinky) / 4
}

/** Thumb-tip to index-tip distance, normalized by hand scale so it's
 * roughly comparable across distance-from-camera and hand size. */
export function pinchDistance(landmarks: Point3D[]): number {
  const scale = handScale(landmarks)
  return dist(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) / scale
}

/** Distance between two hands' palm centroids, normalized to a roughly
 * [0,1]-ish range for a hands-shoulder-width-apart baseline. */
export function twoHandSpread(a: HandObservation, b: HandObservation): number {
  return dist(palmCentroid(a.landmarks), palmCentroid(b.landmarks)) / 0.8
}
