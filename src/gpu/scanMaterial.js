import * as THREE from 'three/webgpu'
import { Fn, attribute, cameraPosition, float, length, max, mix, normalWorld, normalize, positionWorld, smoothstep, texture, uv, vec3 } from 'three/tsl'
import { ROCK, setScanMaterialFactory } from '../scene/scans'
import { color } from '../scene/world'
import { vnoise } from './tsl'

// The scanned rocks' material on the WebGPU path, matching scene/scans.js on WebGL: the
// scan's maps, baked occlusion (vertex colour), moss on upward faces, a wet band at the
// waterline and a finer detail layer up close.
const c = (hex) => vec3(...color(hex).toArray())

function gpuMaterial(maps) {
  const m = new THREE.MeshStandardNodeMaterial({
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    aoMap: maps.orm,
    aoMapIntensity: 0.9,
    envMapIntensity: 0.22,
  })
  const W = positionWorld
  const wet = Fn(() => {
    const top = float(ROCK.wetTop).add(vnoise(W.xz.mul(0.8)).sub(0.5).mul(0.35))
    return float(1.0).sub(smoothstep(top.sub(0.25), top, W.y))
  })()
  m.colorNode = Fn(() => {
    const albedo = texture(maps.map, uv()).rgb.mul(c(ROCK.tint)).mul(attribute('color', 'vec3')).toVar()
    const dist = length(W.sub(cameraPosition))
    const detail = texture(maps.map, uv().mul(ROCK.detailScale)).g
    albedo.mulAssign(mix(float(1.0), detail.mul(0.8).add(0.6), float(1.0).sub(smoothstep(6.0, 30.0, dist))))
    const up = smoothstep(0.3, 0.75, normalize(normalWorld).y)
    const patchy = vnoise(W.xz.mul(0.35)).mul(0.65).add(vnoise(W.xz.mul(1.7)).mul(0.35))
    const moss = up.mul(smoothstep(0.3, 0.55, patchy))
    albedo.assign(mix(albedo, c(ROCK.moss).mul(vnoise(W.xz.mul(6.0)).mul(0.5).add(0.75)), moss.mul(0.8)))
    albedo.mulAssign(mix(1.0, ROCK.wet, wet))
    return albedo
  })()
  // Dry rock stays matt (glossy texels glinted like flakes against the bright sky).
  m.roughnessNode = mix(max(texture(maps.orm, uv()).g, 0.7), float(0.22), wet)
  m.metalnessNode = float(0.0)
  return m
}

setScanMaterialFactory(gpuMaterial)
