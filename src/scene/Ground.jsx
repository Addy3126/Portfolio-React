import { useMemo } from 'react'
import * as THREE from 'three'
import { fogGLSL } from './glsl'
import { color, palette, shared, shoreZ } from './world'

const vertex = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const fragment = /* glsl */ `
uniform vec3 cNear, cFar, cFrost;
uniform vec3 uPianoPos, uPianoGlow;
uniform float uGlowPulse;
varying vec3 vWorld;
${fogGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  vec3 col = mix(cNear, cFar, smoothstep(2.0, 18.0, dist));
  // Wet sand darkening as the ground dips into the sea.
  col = mix(col, cNear * 0.6, smoothstep(-0.02, -0.2, vWorld.y));
  float back = pow(max(dot(V, uSunDir), 0.0), 5.0);
  col += cFrost * back * 0.25;
  float pd = length(vWorld.xz - uPianoPos.xz);
  col += uPianoGlow * uGlowPulse * 0.5 / (1.0 + pd * pd * 1.2);
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

export default function Ground() {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(140, 26, 280, 104)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, -1)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const below = shoreZ(x) - z // > 0 past the shoreline
      const y = below > 0 ? -Math.min(0.45, below * 0.22) : Math.sin(x * 0.3) * Math.cos(z * 0.4) * 0.04
      pos.setY(i, y)
    }
    g.computeVertexNormals()
    return g
  }, [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          ...shared,
          cNear: { value: color('#181d4e') },
          cFar: { value: color('#6b62a8') },
          cFrost: { value: color(palette.frost) },
        },
      }),
    [],
  )

  return <mesh geometry={geometry} material={material} />
}
