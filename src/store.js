// Mutable state read every frame by the scene and the overlay (kept out of React to avoid re-renders).
export const SECTIONS = ['landing', 'about', 'projects', 'contact']

export const motion = {
  progress: 0, // 0..SECTIONS.length-1, smoothed scroll position in "sections"
  pointerX: 0, // -1..1
  pointerY: 0, // -1..1
  pointerMovedAt: -1e9, // performance.now() of the last pointer move
  pointerInside: false,
  playing: false, // at the piano (play mode)
}

// What the loading screen is waiting for (set by the scene's startup, shown under the title).
export const loading = { stage: 'Loading the field', listeners: new Set() }
export function setLoadingStage(stage) {
  if (loading.stage === stage) return
  loading.stage = stage
  loading.listeners.forEach((fn) => fn(stage))
}
