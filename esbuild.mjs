import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
}

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('Watching DeepSeek Harness extension…')
} else {
  await build(options)
}
