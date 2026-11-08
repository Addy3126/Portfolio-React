import { motion } from '../store'

// Towers answer the pointer only while the Projects panel is showing (it fades in within
// about a third of a section of its stop), so a stray hover elsewhere does nothing.
export const inProjects = () => Math.abs(motion.progress - 2) < 0.3
