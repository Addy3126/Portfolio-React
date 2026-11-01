import { useMemo } from 'react'
import * as THREE from 'three'
import { fogGLSL, noiseGLSL, shadowGLSL, shoreGLSL } from './glsl'
import { cullHidden } from './visibility'
import { color, landDist, palette, shared } from './world'

const vertex = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const fragment = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform vec3 cNear, cFar, cFrost, cSand, cWet, cCarpet, cRockG;
uniform float uGrassFar;
uniform vec3 uPianoPos, uPianoGlow;
uniform float uGlowPulse;
varying vec3 vWorld;
${noiseGLSL}
${fogGLSL}
${shoreGLSL}
${shadowGLSL}
void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  float t = uTime * uMotion;

  // Soil under the grass.
  vec3 col = mix(cNear, cFar, smoothstep(2.0, 18.0, dist));

  // Beach: a strip of sand between the grass and the water.
  float inland = landDist(vWorld.xz); // metres from the waterline (negative = under water)
  // Sand reaches under the ragged edge of the grass (which starts 2-5 m inland).
  float beach = 1.0 - smoothstep(3.0, 5.2, inland);
  // The spit (land beyond the main field) is sand and rock, not grass.
  float spit = 1.0 - smoothstep(-3.0, 0.5, mainDist(vWorld.xz));
  beach = max(beach, spit);
  vec3 sand = cSand * (0.85 + 0.3 * vnoise(vWorld.xz * 3.0));
  // Wet sand where the wash recently reached; the reach moves with the swell.
  float reach = 0.16 + 0.1 * sin(t * 0.55 + vWorld.x * 0.21) + 0.05 * sin(t * 1.3 - vWorld.x * 0.6);
  float wet = 1.0 - smoothstep(reach - 0.04, reach + 0.14, inland);
  vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
  vec3 wetCol = cWet + uFogGlow * pow(max(dot(R, uSunDir), 0.0), 30.0) * 0.6; // wet sand mirrors the glow
  sand = mix(sand, wetCol, wet);
  // Sand surface: soft wind ripples, fine grain and a sprinkling of tiny dark grit.
  // Fine detail fades out with distance so it never turns into blotches or shimmer.
  float near = 1.0 - smoothstep(6.0, 30.0, dist);
  float ripple = sin(dot(vWorld.xz, vec2(0.8, 0.6)) * 7.0 + vnoise(vWorld.xz * 0.6) * 7.0) * 0.5 + 0.5;
  sand *= 1.0 + (ripple - 0.5) * 0.07 * (1.0 - smoothstep(10.0, 45.0, dist));
  sand *= 1.0 + (vnoise(vWorld.xz * 60.0) - 0.5) * 0.12 * near;
  float grit = smoothstep(0.86, 0.95, vnoise(vWorld.xz * 38.0)) * near;
  sand = mix(sand, cRockG, grit * 0.45 * (0.4 + spit * 0.6));
  col = mix(col, sand, beach);
  // Darken as the seabed drops away (by distance from the waterline, not height, so the
  // gentle undulation of the land doesn't draw dark contour lines on the sand).
  col = mix(col, cWet * 0.5, 1.0 - smoothstep(-1.5, -0.1, inland));

  // Grass carpet where blades are no longer drawn (far LOD).
  float far = smoothstep(uGrassFar - 4.0, uGrassFar, length(vWorld.xz - cameraPosition.xz));
  vec3 carpet = cCarpet * (0.8 + 0.35 * vnoise(vWorld.xz * 0.6)) * (0.85 + 0.3 * vnoise(vWorld.xz * 0.09 + 3.0));
  col = mix(col, carpet, far * (1.0 - beach) * step(0.0, inland));

  float back = pow(max(dot(V, uSunDir), 0.0), 5.0);
  col += cFrost * back * 0.25 * (1.0 - beach);

  // Piano shadow and contact darkening.
  float sh = pianoShadow(vWorld);
  col *= mix(0.45, 1.0, sh) * pianoContact(vWorld.xz);

  float pd = length(vWorld.xz - uPianoPos.xz);
  col += uPianoGlow * uGlowPulse * 0.5 / (1.0 + pd * pd * 1.2);
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

export default function Ground() {
  const geometry = useMemo(() => {
    // Covers the field, the spit (to z = -66) and the channel bank on the left.
    const g = new THREE.PlaneGeometry(140, 80, 280, 200)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, -28)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const below = -landDist(x, z) // > 0 past the waterline
      const y = below > 0 ? -Math.min(0.45, below * 0.22) : Math.sin(x * 0.3) * Math.cos(z * 0.4) * 0.04 * Math.min(1, -below)
      pos.setY(i, y)
    }
    g.computeVertexNormals()
    const out = cullHidden(g) // ground under the (opaque) sea is never seen
    g.dispose()
    return out
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
          cSand: { value: color('#a49ad0') },
          cWet: { value: color('#3c3f8c') },
          cCarpet: { value: color('#8a82cf') },
          cRockG: { value: color('#3a3558') },
        },
      }),
    [],
  )

  return <mesh geometry={geometry} material={material} />
}
