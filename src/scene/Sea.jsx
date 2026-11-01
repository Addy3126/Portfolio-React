import { useMemo } from 'react'
import * as THREE from 'three'
import { fogGLSL, noiseGLSL } from './glsl'
import { color, palette, shared } from './world'

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
uniform vec3 cNear, cFar, cGlow;
varying vec3 vWorld;
${noiseGLSL}
${fogGLSL}

void main(){
  vec3 toP = vWorld - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / dist;
  float t = uTime * uMotion;
  vec2 p = vWorld.xz;

  // Layered ripples; fine detail fades with distance to avoid shimmer.
  float fine = 1.0 - smoothstep(30.0, 220.0, dist);
  vec2 g1 = vec2(vnoise(p * 0.3 + vec2(t * 0.12, 0.0)), vnoise(p * 0.3 + vec2(5.0, t * 0.1))) - 0.5;
  vec2 g2 = vec2(vnoise(p * 1.4 - t * 0.25), vnoise(p * 1.4 + 9.0 + t * 0.2)) - 0.5;
  vec2 g3 = vec2(vnoise(p * 5.0 + t * 0.6), vnoise(p * 5.0 - 4.0 - t * 0.5)) - 0.5;
  vec2 slope = g1 * 0.22 + g2 * 0.14 * fine + g3 * 0.1 * fine;
  vec3 n = normalize(vec3(slope.x, 1.0, slope.y));

  vec3 R = reflect(V, n);
  float fres = pow(1.0 - max(dot(-V, n), 0.0), 4.0);
  vec3 base = mix(cNear, cFar, smoothstep(4.0, 260.0, dist));
  float sd = max(dot(R, uSunDir), 0.0);
  vec3 refl = mix(cFar * 0.9, cGlow, pow(sd, 10.0));
  vec3 col = mix(base, refl, 0.3 + 0.6 * fres);

  // Sun path: soft streak plus sharp glints.
  col += cGlow * pow(sd, 80.0) * 0.9;
  col += vec3(6.0, 5.5, 5.3) * pow(sd, 1400.0);

  // Light foam where the water meets the shore.
  gl_FragColor = vec4(applyFog(col, dist, V), 1.0);
}
`

export default function Sea() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          ...shared,
          cNear: { value: color(palette.seaNear) },
          cFar: { value: color(palette.seaFar) },
          cGlow: { value: color(palette.glow) },
        },
      }),
    [],
  )
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.04, -620]} material={material}>
      <planeGeometry args={[3200, 1400]} />
    </mesh>
  )
}
