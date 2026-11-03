// Bundles the service worker (src/sw) into one classic script at dist/sw.js, after `vite build`.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/sw/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  outfile: 'dist/sw.js',
  logLevel: 'warning',
})
console.log('Built dist/sw.js')
