#!/usr/bin/env zx
// Builder version 2.0.0

import * as path from 'node:path'
import * as os from 'node:os'
import readline from 'node:readline'

$.verbose = false

const CONFIG = {
  extensionName: 'link_modifier', // Name of the current extension
  git: {
    enableUploading: true,
    repoName: 'primo-extensions',
    repoRemote: 'git@github.com:primo-browser/primo-extensions.git',
    localGitDir: path.join(os.homedir(), '.git-extensions'),
    editReadme: true, // If true, will edit README.md with the new version
  },
  chromeBinary: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  sourceFolder: 'dist', // "src" or "dist" or "build"
  buildScripts: ['npm run build'], // ["npm run build"]
  makeCrx: true,
  manifestPath: 'src/manifest.json',
}

async function prompt (question) {
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout,
  })

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

async function buildFromScript (script) {
  console.log('🔨 Running build script:', script)
  await fs.remove(CONFIG.sourceFolder)
  await $`${script.split(' ')}`
}

async function copyAndZipSourceFolder (buildDir, name) {
  await fs.copy(CONFIG.sourceFolder, `${buildDir}/${name}`)
  await $`find ${buildDir}/${name} -name .DS_Store -type f -delete`
  await $`cd ${buildDir} && zip -r ${name}.zip ${name}`
}

async function makeCrxPackage (buildDir, name) {
  console.log('🔨 Making CRX package...')
  if (!(await fs.pathExists(CONFIG.chromeBinary))) {
    throw new Error('Google Chrome binary not found.')
  }
  if (!(await fs.pathExists(`${CONFIG.extensionName}.pem`))) {
    throw new Error(`Missing .pem file: ${CONFIG.extensionName}.pem`)
  }

  await $`${CONFIG.chromeBinary} \
    --pack-extension=${buildDir}/${name} \
    --pack-extension-key=${CONFIG.extensionName}.pem`

  await $`cd ${buildDir} && zip ${name}.crx.zip ${name}.crx`
}

async function waitForEnter (prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin, output: process.stdout,
    })
    rl.question(prompt, () => {
      rl.close()
      resolve()
    })
  })
}

async function editReadme (repoDir, version, GIT_COMMIT) {
  const readmePath = path.join(repoDir, CONFIG.extensionName, 'README.md')
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/') // YYYY/MM/DD
  const changelogJsonPath = path.join(repoDir, CONFIG.extensionName,
    'changelog.json')

  // Ensure changelog JSON exists with a minimal valid shape.
  // We do NOT auto-append updates; user pastes the printed object into `updates`.
  await fs.ensureFile(changelogJsonPath)
  const existing = (await fs.readFile(changelogJsonPath, 'utf8')).trim()
  if (!existing) {
    await fs.writeFile(changelogJsonPath, JSON.stringify({
      name: CONFIG.extensionName,
      updates: [],
    }, null, 2) + '\n')
  }

  const updateObject = {
    version,
    date: today,
    internalChangelog: GIT_COMMIT,
    clientChangelog: '',
  }

  console.log('\n📋 Paste this object into changelog.json -> updates[]:\n')
  console.log(JSON.stringify(updateObject, null, 2))
  console.log('\n✍️ Opening changelog.json in WebStorm...')

  try {
    await $`webstorm ${changelogJsonPath}`
  } catch (err) {
    console.warn('⚠️ Failed to open in WebStorm. Trying VSCode...')
    try {
      await $`code ${changelogJsonPath}`
    } catch {
      console.warn('⚠️ Failed to open in VSCode. Opening with default app...')
      await $`open ${changelogJsonPath}`
    }
  }

  await waitForEnter(
    '⏸️ Press Enter when you\'re done editing changelog.json...')

  // Generate README.md from changelog.json (fully overwrite).
  let changelog
  try {
    const raw = await fs.readFile(changelogJsonPath, 'utf8')
    changelog = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch (err) {
    throw new Error(
      `Invalid JSON in changelog.json: ${err?.message || String(err)}`)
  }

  const updatesRaw = changelog?.updates
  const updates = Array.isArray(updatesRaw)
    ? updatesRaw
    : (updatesRaw && typeof updatesRaw === 'object' ? [updatesRaw] : [])
  const norm = (u) => {
    const internal = (u && (u.internalChangelog ?? u['internal changelog'])) ??
      ''
    const client = (u && (u.clientChangelog ?? u['client changelog'])) ?? ''
    return {
      version: (u?.version ?? '').toString(),
      date: (u?.date ?? '').toString(),
      internal,
      client,
    }
  }

  const toLines = (value) => {
    if (Array.isArray(value)) {
      return value.map(v => (v ?? '').toString()).map(s => s.trim()).filter(
        Boolean)
    }
    return (value ?? '').toString().split('\n').map(s => s.trim()).filter(
      Boolean)
  }

  // Keep the exact order from changelog.json (expected: newest first).
  const orderedUpdates = updates.map(norm)

  const md = []
  md.push(`<!-- AUTO-GENERATED FILE: edit changelog.json instead. -->`)
  md.push(`# ${CONFIG.extensionName}`)
  md.push('')
  md.push('## Internal Changelog')
  md.push('')
  md.push('| Version | Date | Internal changes |')
  md.push('|---|---|---|')

  const escapeCell = (s) => (s ?? '').toString().replace(/\|/g, '\\|')
  const stripBulletPrefix = (line) => {
    const s = (line ?? '').toString().trim()
    return s.replace(/^[-*]\s+/, '').replace(/^[•]\s+/, '')
  }
  const parseGitHubRepo = (remote) => {
    const r = (remote ?? '').toString().trim()
    // Supports:
    // - git@github.com:owner/repo.git
    // - https://github.com/owner/repo.git
    // - https://github.com/owner/repo
    let m = r.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (m) return { owner: m[1], repo: m[2] }
    m = r.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (m) return { owner: m[1], repo: m[2] }
    return null
  }
  const github = parseGitHubRepo(CONFIG?.git?.repoRemote)
  const artifactExt = CONFIG.makeCrx ? 'crx.zip' : 'zip'
  const makeArtifactUrl = (ver) => {
    if (!github) return null
    const folder = `${CONFIG.extensionName}_v${ver}`
    const branch = 'main'
    return `https://github.com/${github.owner}/${github.repo}/tree/${branch}/${CONFIG.extensionName}/${folder}/${folder}.${artifactExt}`
  }

  for (const u of orderedUpdates) {
    if (!u.version) continue

    const internalLines = toLines(u.internal)
    const internalCell = internalLines.length === 0
      ? '_No entries._'
      : internalLines.map(stripBulletPrefix).map(escapeCell).join('<br>')

    const url = makeArtifactUrl(u.version)
    const versionCell = url
      ? `[v${escapeCell(u.version)}](${url})`
      : `v${escapeCell(u.version)}`

    md.push(
      `| ${versionCell} | ${escapeCell(u.date)} | ${internalCell} |`)
  }

  await fs.ensureFile(readmePath)
  await fs.writeFile(readmePath, md.join('\n').replace(/\n{3,}/g, '\n\n') + '\n')
}

async function uploadToGitHub (buildDir, name, version) {
  const repoDir = path.join(CONFIG.git.localGitDir, CONFIG.git.repoName)

  console.log(
    `📂 Preparing to upload to GitHub repository, if you don't want to upload, just press Ctrl+C now.`)
  // Prompt for commit message
  const GIT_COMMIT = await prompt('Enter commit message: ')

  // Clone repo if needed
  await fs.ensureDir(CONFIG.git.localGitDir)
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    console.log('📥 Cloning repository...')
    await $`git clone ${CONFIG.git.repoRemote} ${repoDir}`
  }

  // Git pull if not empty
  try {
    await $`git -C ${repoDir} rev-parse --verify HEAD`
    await $`git -C ${repoDir} pull`
  } catch {
    console.log('🕳️ Empty repo — skipping pull')
  }

  // Copy build
  const dest = path.join(repoDir, CONFIG.extensionName, name)
  await fs.remove(dest)
  await fs.ensureDir(dest)
  for (const ext of ['zip', 'crx.zip', 'crx']) {
    const src = `${buildDir}/${name}.${ext}`
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(dest, path.basename(src)))
      console.log(`📤 Copied ${path.basename(src)} -> ${dest}`)
    }
  }

  if (CONFIG.git.editReadme) {
    await editReadme(repoDir, version, GIT_COMMIT)
  }

  // Git commit and push
  await $`git -C ${repoDir} add .`
  await $`git -C ${repoDir} commit -m ${GIT_COMMIT}`
  await $`git -C ${repoDir} push`

  console.log(
    `🚀 Uploaded: https://github.com/primo-browser/${CONFIG.git.repoName}/tree/main/${CONFIG.extensionName}/${name}`)
}

async function main () {
  console.time('Total build time')

  console.log(`🔧 Starting build process...`)
  const raw = await fs.readFile(CONFIG.manifestPath, 'utf8')
  const sanitized = raw.replace(/^\uFEFF/, '') // remove leading BOM

  const manifest = JSON.parse(sanitized)
  const version = manifest.version
  console.log(`Extension version: ${version}`)

  const outputDirFolder = `v${version}`
  const outputFolder = `${CONFIG.extensionName}_v${version}`
  const buildDir = `compiled/${outputDirFolder}`
  console.log(`Output build directory: ${buildDir}`)
  await fs.ensureDir('compiled')
  await fs.remove(buildDir)

  console.log(`✈️ Running build scripts...`)
  if (CONFIG.buildScripts.length > 0) {
    for (const script of CONFIG.buildScripts) {
      await buildFromScript(script)
      await copyAndZipSourceFolder(buildDir, outputFolder)
    }
  } else {
    console.log('🔨 No build scripts provided, using default build...')
    await copyAndZipSourceFolder(buildDir, outputFolder)
  }

  console.log('✅ Builds completed')

  // Pack CRX
  if (CONFIG.makeCrx) await makeCrxPackage(buildDir, outputFolder)

  console.log(`📦 Packaging completed: ./${buildDir}`)
  if (CONFIG.git.enableUploading) await uploadToGitHub(buildDir, outputFolder,
    version)

  console.timeEnd('Total build time')
}

main().catch(err => {
  console.error('❌ Build failed:', err.message || err)
  process.exit(1)
})
