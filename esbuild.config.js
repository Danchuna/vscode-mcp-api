import esbuild from 'esbuild'

const isWatch = process.argv.includes('--watch')
const isProd = process.argv.includes('--production')

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'], // Must be external - provided by VS Code runtime
  format: 'cjs',        // Must be cjs - VS Code extension host requires CommonJS
  platform: 'node',
  target: 'node20',
  sourcemap: !isProd,
  minify: isProd,
}

if (isWatch) {
  const ctx = await esbuild.context(buildOptions)
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await esbuild.build(buildOptions)
  console.log('Build complete.')
}
