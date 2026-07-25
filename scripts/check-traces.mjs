// Quick sanity check: run each bundled trace through a JS port of the
// classifier logic's *thresholds* is overkill to duplicate here, so instead
// we exercise the actual compiled recognizer via esbuild-free ts-node-less
// trick: dynamic import after `tsc --outDir` isn't set up for this repo, so
// this script re-implements nothing — it just prints geometry stats
// (min/max curl, min pinch distance, max |vx|) per trace so thresholds can
// be sanity-checked by eye before running the full Playwright pass.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const traceDir = join(__dirname, '..', 'src', 'traces')

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}
function angleBetween(a, b) {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z
  const magA = Math.hypot(a.x, a.y, a.z) || 1e-6
  const magB = Math.hypot(b.x, b.y, b.z) || 1e-6
  const cos = Math.min(1, Math.max(-1, dot / (magA * magB)))
  return Math.acos(cos)
}
function curl(l, mcp, pip, tip) {
  const v1 = sub(l[pip], l[mcp])
  const v2 = sub(l[tip], l[pip])
  return angleBetween(v1, v2)
}
function meanCurl(l) {
  return (
    (curl(l, 5, 6, 8) + curl(l, 9, 10, 12) + curl(l, 13, 14, 16) + curl(l, 17, 18, 20)) / 4
  )
}
function handScale(l) {
  return Math.max(dist(l[0], l[9]), 1e-3)
}
function pinchDist(l) {
  return dist(l[4], l[8]) / handScale(l)
}

const names = ['open-palm-move', 'pinch-click', 'fist-scroll', 'swipe-right', 'swipe-left', 'two-hand-spread']

for (const name of names) {
  const frames = JSON.parse(readFileSync(join(traceDir, `${name}.json`), 'utf8'))
  let minCurl = Infinity
  let maxCurl = -Infinity
  let minPinch = Infinity
  let maxPinch = -Infinity
  let maxVx = 0
  let prevCentroid = null
  let prevT = null
  for (const f of frames) {
    if (f.hands.length === 0) continue
    const l = f.hands[0].landmarks
    const c = meanCurl(l)
    minCurl = Math.min(minCurl, c)
    maxCurl = Math.max(maxCurl, c)
    const pd = pinchDist(l)
    minPinch = Math.min(minPinch, pd)
    maxPinch = Math.max(maxPinch, pd)
    const centroidIdx = [0, 5, 9, 13, 17]
    const centroid = centroidIdx.reduce(
      (acc, i) => ({ x: acc.x + l[i].x / 5, y: acc.y + l[i].y / 5, z: acc.z + l[i].z / 5 }),
      { x: 0, y: 0, z: 0 },
    )
    if (prevCentroid && prevT !== null) {
      const dt = Math.max((f.t - prevT) / 1000, 1 / 240)
      const vx = (centroid.x - prevCentroid.x) / dt
      maxVx = Math.max(maxVx, Math.abs(vx))
    }
    prevCentroid = centroid
    prevT = f.t
  }
  console.log(
    `${name.padEnd(18)} curl[${minCurl.toFixed(2)},${maxCurl.toFixed(2)}] pinch[${minPinch.toFixed(2)},${maxPinch.toFixed(2)}] maxVx=${maxVx.toFixed(2)}`,
  )
}
