// Tracks the scanned textures in flight, so the loading screen can stay up until they have
// arrived (no surfaces popping from flat to detailed after the reveal). Capped, so a slow
// connection still gets the scene after a few seconds.
const pending = new Set()
export function track(promise) {
  pending.add(promise)
  promise.finally(() => pending.delete(promise))
}
export function texturesReady(maxWait = 6000) {
  return Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, maxWait))])
}
