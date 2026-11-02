import { TOWERS } from './ruins/layout'
import { SUN_DIR } from './world'

// Sun lanes: with the sun this low, every tower standing in the sea blocks the sunlight on
// the water behind it (toward the cameras), cutting a dark lane through the glitter path,
// as towers and piers do at real sunsets. Static, so worked out here once: per tower its
// footprint centre (x, z), half width and lane length. The sun is lifted a little for the
// lane length (at its true 0.7 degrees every lane would run to the horizon).
const sx = SUN_DIR.x / Math.hypot(SUN_DIR.x, SUN_DIR.z)
const sz = SUN_DIR.z / Math.hypot(SUN_DIR.x, SUN_DIR.z)
export const LANE_DIR = [-sx, -sz] // shadows fall away from the sun
export const LANES = TOWERS.map((t) => [t.x, t.z, Math.max(t.w, t.d) * 0.5, (t.h - (t.sunk || 0)) / 0.06])

// How much of the sunlight on the water at (x, z) the towers block (0..1), as GLSL.
export const sunLanesGLSL = /* glsl */ `
const vec2 LANE_DIR = vec2(${LANE_DIR.map((v) => v.toFixed(5)).join(', ')});
const vec4 LANES[${LANES.length}] = vec4[${LANES.length}](
  ${LANES.map((l) => `vec4(${l.map((v) => v.toFixed(2)).join(', ')})`).join(',\n  ')}
);
float laneShadow(vec2 p){
  float s = 0.0;
  for (int i = 0; i < ${LANES.length}; i++) {
    vec2 rel = p - LANES[i].xy;
    float along = dot(rel, LANE_DIR);
    if (along <= 0.0) continue;
    float perp = abs(rel.x * LANE_DIR.y - rel.y * LANE_DIR.x);
    float hw = LANES[i].z + along * 0.006; // penumbra widens with distance
    float lane = 1.0 - smoothstep(hw - 0.4 - along * 0.004, hw + 0.4 + along * 0.004, perp);
    lane *= smoothstep(0.0, 3.0, along) * (1.0 - smoothstep(LANES[i].w * 0.6, LANES[i].w, along));
    s = max(s, lane);
  }
  return s;
}
`
