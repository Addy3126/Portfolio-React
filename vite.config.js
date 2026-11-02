import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Library chunks that change rarely, cached across deploys and split by who needs them: the
// first page loads only React and the overlay; the 3D libraries (three's core with React
// Three Fiber) load with the scene; the WebGL scene adds postprocessing, the WebGPU scene
// adds three's WebGPU renderer and node system.
// Earlier groups take priority; three's core ends up with React Three Fiber.
const CHUNKS = [
  ['react', /node_modules\/(react|react-dom|scheduler)\//],
  ['r3f', /node_modules\/(@react-three\/fiber|zustand|its-fine|suspend-react|react-use-measure|use-sync-external-store)\//],
  ['three-core', /node_modules\/three\/build\/three\.core\.js/],
  ['three-webgl', /node_modules\/three\/build\/three\.module\.js/],
  ['three-webgpu', /node_modules\/three\/build\/three\.(webgpu|tsl)\.js/],
  ['postfx', /node_modules\/(postprocessing|@react-three\/postprocessing|n8ao)\//],
]

// Relative base so the build works on GitHub Pages under /Portfolio-React/.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: CHUNKS.map(([name, test], i) => ({ name, test, priority: CHUNKS.length - i })),
        },
      },
    },
  },
})
