// Primo-only build step: obfuscates the JS in an unpacked MV3 build.
//
// Walks the given root recursively, replacing every *.js file with an
// obfuscated copy. Skips third-party `lib/` (already minified, no point /
// risk of breaking codemirror, csstree, etc.).
//
// CSP-safe options only: no `eval`, no `Function()`, no `selfDefending`,
// no `debugProtection` — MV3 forbids those at runtime.
//
// Usage from build.mjs:
//   import { obfuscateBuild } from './tools/primo-obfuscate.mjs'
//   await obfuscateBuild('compiled/v1.2.3/primo_adblock_v1.2.3')

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import JavaScriptObfuscator from 'javascript-obfuscator'

const OBFUSCATOR_OPTIONS = {
  compact: true,
  simplify: true,
  target: 'browser',
  log: false,

  // Identifier renaming — safe; imports/exports keep their syntactic names.
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,

  // CSP-violating features — MUST stay off for MV3 service workers.
  selfDefending: false,
  debugProtection: false,
  debugProtectionInterval: 0,

  // String obfuscation — base64 only uses atob(), which is CSP-safe.
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayIndexShift: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.5,
  stringArrayWrappersCount: 1,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 2,
  stringArrayWrappersType: 'variable',

  // Risky transforms that frequently break real code — keep off.
  controlFlowFlattening: false,
  deadCodeInjection: false,
  transformObjectKeys: false,
  numbersToExpressions: false,
  splitStrings: false,

  unicodeEscapeSequence: false,
  disableConsoleOutput: false,
}

// Directories under the build root we never touch.
const SKIP_DIRS = new Set([
  'lib',          // third-party libs (codemirror, csstree, regexanalyzer, punycode)
  '_locales',
  'rulesets',
  'css',
  'img',
  'web_accessible_resources',
])

async function* walkJsFiles (root, rel = '') {
  const here = path.join(root, rel)
  const entries = await readdir(here, { withFileTypes: true })
  for (const entry of entries) {
    const childRel = path.join(rel, entry.name)
    if (entry.isDirectory()) {
      // Skip top-level dirs we don't want to touch.
      if (rel === '' && SKIP_DIRS.has(entry.name)) { continue }
      yield* walkJsFiles(root, childRel)
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      yield childRel
    }
  }
}

export async function obfuscateBuild (buildRoot) {
  let count = 0
  let totalIn = 0
  let totalOut = 0
  for await (const rel of walkJsFiles(buildRoot)) {
    const abs = path.join(buildRoot, rel)
    const src = await readFile(abs, 'utf8')
    totalIn += src.length
    const result = JavaScriptObfuscator.obfuscate(src, OBFUSCATOR_OPTIONS)
    const out = result.getObfuscatedCode()
    await writeFile(abs, out, 'utf8')
    totalOut += out.length
    count += 1
  }
  console.log(
    `🔒 Obfuscated ${count} JS file(s): ` +
    `${(totalIn / 1024).toFixed(1)} KiB → ${(totalOut / 1024).toFixed(1)} KiB`
  )
}
