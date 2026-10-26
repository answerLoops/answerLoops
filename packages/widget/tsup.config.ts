import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
  },
  {
    // The component is client-only; the directive lets a Next.js server
    // component import it without wrapping it in its own client file.
    entry: { react: 'src/react.tsx' },
    format: ['esm', 'cjs'],
    dts: true,
    external: ['react'],
    banner: { js: "'use client';" },
  },
])
