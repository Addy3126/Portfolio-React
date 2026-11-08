import { useMemo } from 'react'
import * as THREE from 'three'
import { lookNew } from '../quality'
import { fogGLSL, noiseGLSL, shadowGLSL, shoreGLSL, swashGLSL, rippleGLSL } from './glsl'
import { surfaceUniforms } from './surfaces'
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
uniform sampler2D tSandS, tSandN, tGravelS, tGravelN, tPebbleS, tPebbleN;
uniform vec3 cPebble;
uniform vec3 cNear, cFar, cFrost, cSand, cWet, cCarpet, cRockG, cFoam, cSkyRefl, cSandUnder;
uniform float uGrassFar;
uniform vec3 uPianoPos, uPianoGlow;
${rippleGLSL}
uniform float uGlowPulse;
varying vec3 vWorld;
${noiseGLSL}
${fogGLSL}
${shoreGLSL}
${swashGLSL}
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
  // Swash: wet sand up to the highest recent reach (darker, mirrors the glow).
  vec4 sw = swash(vWorld.xz, inland, t);
  vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
  vec3 wetCol = cWet + uFogGlow * pow(max(dot(R, uSunDir), 0.0), 30.0) * 0.6;
  sand = mix(sand, wetCol, sw.z * 0.85);
  // Sand surface: soft wind ripples, fine grain and a sprinkling of tiny dark grit.
  // Fine detail fades out with distance so it never turns into blotches or shimmer.
  float near = 1.0 - smoothstep(6.0, 30.0, dist);
  float ripple = sin(dot(vWorld.xz, vec2(0.8, 0.6)) * 7.0 + vnoise(vWorld.xz * 0.6) * 7.0) * 0.5 + 0.5;
  sand *= 1.0 + (ripple - 0.5) * 0.05 * (1.0 - smoothstep(10.0, 45.0, dist));
  sand *= 1.0 + (vnoise(vWorld.xz * 60.0) - 0.5) * 0.12 * near;
  // Scanned ground: fine beach sand, with gravel and river pebbles on the spit (in
  // patches, heavier toward its rocky end). Luminance modulates the palette colour, and
  // the scan's normals are lit by the low sun relative to flat ground (relief without a
  // change in overall tone). Detail fades with distance.
  float detail = 1.0 - smoothstep(22.0, 70.0, dist);
  vec2 xz = vWorld.xz;
  vec3 sS = texture2D(tSandS, xz / 1.6).rgb, gS = texture2D(tGravelS, xz / 1.1).rgb, pS = texture2D(tPebbleS, xz / 1.4).rgb;
  vec2 sN = texture2D(tSandN, xz / 1.6).xy, gN = texture2D(tGravelN, xz / 1.1).xy, pN = texture2D(tPebbleN, xz / 1.4).xy;
  float patchN = vnoise(xz * 0.22 + 5.0);
  float gravel = spit * smoothstep(0.35, 0.6, patchN);
  float pebbles = spit * smoothstep(0.62, 0.8, patchN) * smoothstep(-4.0, 1.5, -spitDist(xz));
  float lumS = mix(mix(sS.r, gS.r, gravel), pS.r, pebbles);
  vec2 tn = (mix(mix(sN, gN, gravel), pN, pebbles) * 2.0 - 1.0) * detail * mix(1.0, 0.45, sw.z);
  vec3 Nd = normalize(vec3(tn.x, 1.0, -tn.y));
  float relief = (max(dot(Nd, uSunDir), 0.0) * 0.8 + 0.35) / (max(uSunDir.y, 0.0) * 0.8 + 0.35);
  sand *= mix(1.0, lumS * 0.95 + 0.55, detail);
  sand *= mix(1.0, relief, detail);
  sand = mix(sand, sand * cPebble * 1.25, pebbles * 0.6);
  float roughS = mix(mix(sS.g, gS.g, gravel), pS.g, pebbles);
  sand += uFogGlow * pow(max(dot(reflect(V, Nd), uSunDir), 0.0), 60.0) * sw.z * (1.0 - roughS) * detail * 0.8;
  float grit = smoothstep(0.86, 0.95, vnoise(vWorld.xz * 38.0)) * near * (1.0 - detail * 0.6);
  sand = mix(sand, cRockG, grit * 0.45 * (0.4 + spit * 0.6));
  col = mix(col, sand, beach);

  // The swash itself: a thin sheet of water over the sand (sand shows through, darker and
  // bluish; sky and glow reflect at grazing angles; small ripples break it up), the foam
  // on top, and a faint shadow just beside the foam line where it stands proud of the sand.
  if (sw.x > 0.001 || sw.y > 0.001 || sw.w > 0.001) {
    vec2 rip = vec2(vnoise(vWorld.xz * 4.0 + t * 0.8), vnoise(vWorld.xz * 4.0 + 7.0 - t * 0.7)) - 0.5;
    vec3 nW = normalize(vec3(rip.x * 0.12, 1.0, rip.y * 0.12));
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(-V, nW), 0.0, 1.0), 5.0);
    vec3 Rw = reflect(V, nW);
    float sdw = max(dot(Rw, uSunDir), 0.0);
    vec3 skyR = mix(cSkyRefl, uFogGlow, pow(sdw, 8.0));
    vec3 film = mix(cSandUnder * 0.85, skyR, clamp(fres * 1.2 + 0.1, 0.0, 1.0));
    film += vec3(4.0) * pow(sdw, 900.0);
    col = mix(col, film, sw.x);
    col *= 1.0 - 0.22 * sw.w;
    col = mix(col, foamShadeAt(cFoam, V, vWorld.xz, sw.y), sw.y * 0.92);
  }
  // Darken as the seabed drops away (by distance from the waterline, not height, so the
  // gentle undulation of the land doesn't draw dark contour lines on the sand).
  col = mix(col, cWet * 0.5, 1.0 - smoothstep(-1.5, -0.1, inland));

  // Grass carpet where blades are no longer drawn (far LOD).
  float far = smoothstep(uGrassFar - 9.0, uGrassFar - 3.0, length(vWorld.xz - cameraPosition.xz));
  vec3 carpet = cCarpet * (0.8 + 0.35 * vnoise(vWorld.xz * 0.6)) * (0.85 + 0.3 * vnoise(vWorld.xz * 0.09 + 3.0));
  col = mix(col, carpet, far * (1.0 - beach) * step(0.0, inland));

  float back = pow(max(dot(V, uSunDir), 0.0), 5.0);
  col += cFrost * back * 0.25 * (1.0 - beach);

  // Piano shadow and contact darkening.
  float sh = pianoShadow(vWorld) * mix(1.0, beachShadow(vWorld), 0.9);
  col *= mix(0.45, 1.0, sh) * pianoContact(vWorld.xz);

  float pd = length(vWorld.xz - uPianoPos.xz);
  col += uPianoGlow * uGlowPulse * 0.5 / (1.0 + pd * pd * 1.2);
  col += uPianoGlow * pianoRipple(pd, uTime) * 0.55;
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
          ...surfaceUniforms('coast_sand_04', 'tSand'),
          ...surfaceUniforms('clean_pebbles', 'tGravel'),
          ...surfaceUniforms('ganges_river_pebbles', 'tPebble'),
          cPebble: { value: color('#8a84b8') },
          cNear: { value: color('#181d4e') },
          cFar: { value: color('#6b62a8') },
          cFrost: { value: color(palette.frost) },
          cSand: { value: color('#a49ad0') },
          cWet: { value: color('#3c3f8c') },
          cCarpet: { value: color('#8a82cf').multiplyScalar(lookNew ? 0.84 : 1) }, // (darker far grass in the new look)
          cRockG: { value: color('#3a3558') },
          cFoam: { value: color('#e4dcff') },
          cSkyRefl: { value: color('#5a4f9e') },
          cSandUnder: { value: color('#5d5aa6') },
        },
      }),
    [],
  )

  return <mesh geometry={geometry} material={material} />
}
