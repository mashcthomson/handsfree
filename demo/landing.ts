import { HandsFreeEngine } from '../src/engine/HandsFreeEngine'

const statusEl = document.getElementById('status')!

const engine = new HandsFreeEngine({
  source: 'auto',
  replayTrace: 'open-palm-move',
  hud: true,
  onSourceChange: (label, mode) => {
    statusEl.textContent = label
    statusEl.className = `status-pill ${mode === 'camera' ? 'live' : 'replay'}`
  },
})

engine.start().catch((err) => {
  statusEl.textContent = `error: ${(err as Error).message}`
})

window.addEventListener('beforeunload', () => engine.stop())
