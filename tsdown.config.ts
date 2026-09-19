import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  unbundle: true,
  dts: false,
  sourcemap: true,
  clean: true,
})
