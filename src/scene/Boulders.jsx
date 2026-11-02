import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { track } from '../textureReady'
import { BEACH_LAYER } from './BeachShadow'
import { shoreZ, spitPoint } from './world'

// A photo-scanned boulder (CC0, Poly Haven boulder_01; the smoother rock_boulder scans
// showed banding once simplified, so one craggy model is reused, rotated and scaled),
// simplified to a few thousand triangles (tools/simplify-boulders.mjs) and
// placed where the cameras come close: along the beach in front of the field and out on
// the spit. Standard materials with their own scanned maps, tinted to the twilight
// palette, so both renderers draw them the same way. They cast into the beach shadows.
const MODELS = ['boulder_01']
// [model, x, z, size (m, radius), rotation, sink]
const [s1x, s1z] = spitPoint(0.62)
const [s2x, s2z] = spitPoint(0.86)
const PLACES = [
  [0, -9.5, shoreZ(-9.5) - 0.6, 0.85, 0.4, 0.25],
  [0, 9.2, shoreZ(9.2) - 0.9, 0.7, 2.1, 0.2],
  [0, -15.5, shoreZ(-15.5) - 1.6, 1.2, 4.0, 0.3],
  [0, s1x + 5.5, s1z + 1.0, 0.9, 1.1, 0.25],
  [0, s2x - 4.5, s2z - 0.5, 0.75, 5.2, 0.2],
  [0, s2x + 3.2, s2z - 2.4, 1.05, 3.3, 0.3],
]

const loader = new THREE.TextureLoader()
function tex(file, srgb) {
  let done
  track(new Promise((r) => (done = r)))
  const t = loader.load(`./models/${file}`, done, undefined, done)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 8
  return t
}

async function loadModel(name) {
  const buf = await (await fetch(`./models/${name}.bin`)).arrayBuffer()
  const [nv, ni] = new Uint32Array(buf, 0, 2)
  let o = 8
  const take = (Type, n) => {
    const a = new Type(buf, o, n)
    o += n * Type.BYTES_PER_ELEMENT
    return a
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(take(Float32Array, nv * 3), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(take(Float32Array, nv * 3), 3))
  g.setAttribute('uv', new THREE.BufferAttribute(take(Float32Array, nv * 2), 2))
  g.setIndex(new THREE.BufferAttribute(take(Uint16Array, ni), 1))
  g.computeBoundingSphere()
  const orm = tex(`${name}_orm.webp`)
  const material = new THREE.MeshStandardMaterial({
    color: '#9c94c6',
    map: tex(`${name}_c.webp`, true),
    normalMap: tex(`${name}_n.webp`),
    normalScale: new THREE.Vector2(2.2, 2.2),
    roughnessMap: orm, // its G channel; the scans read glossy under the bright sky, so
    // reflections are kept low below
    aoMap: orm,
    aoMapIntensity: 0.9,
    roughness: 1,
    envMapIntensity: 0.22,
  })
  return { geometry: g, material }
}

// Loading starts at module load, so it overlaps with the rest of the scene coming up.
let modelsPromise = null
const models = () => (modelsPromise ??= Promise.all(MODELS.map(loadModel)))

export default function Boulders() {
  const [meshes, setMeshes] = useState(null)
  useEffect(() => {
    let live = true
    const p = models().then((ms) => {
      if (!live) return
      const m4 = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const list = ms.map(({ geometry, material }, mi) => {
        const places = PLACES.filter((p) => p[0] === mi)
        const mesh = new THREE.InstancedMesh(geometry, material, places.length)
        places.forEach(([, x, z, size, ry, sink], i) => {
          q.setFromEuler(new THREE.Euler((Math.sin(ry * 3) * 0.08), ry, Math.cos(ry * 2) * 0.08))
          const sy = size * (0.62 + (ry % 1) * 0.25)
          m4.compose(new THREE.Vector3(x, -sink * sy, z), q, new THREE.Vector3(size, sy, size * (0.8 + (ry % 1) * 0.3)))
          mesh.setMatrixAt(i, m4)
        })
        mesh.computeBoundingSphere()
        mesh.layers.enable(BEACH_LAYER)
        return mesh
      })
      setMeshes(list)
    })
    track(p)
    return () => {
      live = false
    }
  }, [])
  if (!meshes) return null
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  )
}
