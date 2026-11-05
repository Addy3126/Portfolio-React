import { setConsoleFunction } from 'three'

// three's messages go through here. One is dropped: React Three Fiber (9.8, the current
// release) still creates a THREE.Clock for its frame loop, which three r186 flags as
// deprecated on every page load. Nothing on our side uses Clock, and there is no newer
// fiber to move to yet. Everything else passes through unchanged.
setConsoleFunction((type, message, ...params) => {
  if (typeof message === 'string' && message.startsWith('THREE.Clock: This module has been deprecated')) return
  console[type](message, ...params)
})
