// Where the ruins stand. `project` links a tower to an entry in content.projects.
// style: concrete | brick | stone. tilt: lean in radians (z, x). broken: jagged top.
// sunk: metres below the waterline.
export const TOWERS = [
  // Project towers, spread across the horizon right of the sun.
  { x: 68, z: -218, w: 8, d: 7, h: 22, project: 0, style: 'concrete' },
  { x: 98, z: -244, w: 7, d: 7, h: 18, project: 1, style: 'brick' },
  { x: 128, z: -212, w: 9, d: 8, h: 26, project: 2, style: 'stone' },
  { x: 162, z: -238, w: 6, d: 6, h: 17, project: 3, style: 'concrete' },

  // Left of the sun: the broken spire and a loose, uneven skyline.
  { x: -12.6, z: -191, w: 6, d: 6, h: 35, broken: true, style: 'concrete' },
  { x: -30, z: -150, w: 5, d: 5, h: 11, broken: true, tilt: [0.05, 0], style: 'brick' },
  { x: -48, z: -232, w: 8, d: 7, h: 22, tilt: [0.07, 0.02], style: 'stone' },
  { x: -74, z: -265, w: 6, d: 6, h: 31, broken: true, style: 'concrete' },
  { x: -98, z: -214, w: 11, d: 8, h: 13, broken: true, sunk: 3, style: 'brick' },
  { x: -132, z: -252, w: 7, d: 7, h: 25, tilt: [-0.09, 0], style: 'concrete' },
  { x: -168, z: -205, w: 13, d: 10, h: 9, broken: true, style: 'stone' },
  { x: -24, z: -430, w: 12, d: 10, h: 46, broken: true, style: 'concrete' }, // far, mostly in haze

  // Right side, between the project towers and the headland.
  { x: -60, z: -168, w: 4, d: 4, h: 8, broken: true, tilt: [0.12, 0.05], style: 'brick' },
  { x: 196, z: -206, w: 6, d: 6, h: 14, broken: true, style: 'stone' },
  { x: 145, z: -320, w: 9, d: 9, h: 30, broken: true, style: 'concrete' },
]

// Older stone and brick buildings standing on the headland (base height comes from the rock).
export const HEADLAND_BUILDINGS = [
  { x: 205, z: -246, w: 7, d: 7, h: 14, broken: true, style: 'stone' },
  { x: 222, z: -256, w: 9, d: 8, h: 20, style: 'brick' },
  { x: 240, z: -248, w: 5, d: 5, h: 11, broken: true, style: 'stone' },
]

// Ruins along the terraces of the rock plateau on the left (base height from the rock).
export const PLATEAU_BUILDINGS = [
  { x: -58.0, z: -263.9, w: 5, d: 5, h: 8, broken: true, style: 'stone' },
  { x: -96.1, z: -255.1, w: 6, d: 6, h: 12, style: 'brick' },
  { x: -128.5, z: -243.2, w: 4, d: 4, h: 7, broken: true, style: 'concrete' },
  { x: -164.0, z: -225.3, w: 7, d: 6, h: 14, broken: true, style: 'concrete' },
  { x: -195.9, z: -193.9, w: 5, d: 5, h: 10, style: 'stone' },
  { x: -228.5, z: -169.5, w: 6, d: 6, h: 13, broken: true, style: 'brick' },
  { x: -263.7, z: -125.4, w: 8, d: 7, h: 16, broken: true, style: 'concrete' },
]

// Fallen slabs lying in the water: [x, z, width, height, depth, rotY, rotZ]
export const SLABS = [
  [-36, -205, 14, 2.4, 5, 0.4, 0.12],
  [84, -205, 10, 1.8, 4, -0.3, -0.08],
  [-118, -236, 16, 3, 6, 0.9, 0.05],
]
