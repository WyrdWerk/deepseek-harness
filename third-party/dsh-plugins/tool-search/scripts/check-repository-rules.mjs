import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const localSpecifier = /^(?:file|link|workspace):/

assert.equal(packageJson.private, true, 'private plugins must reject npm publication')
assert.equal(packageJson.publishConfig, undefined, 'private plugins must not declare publishConfig')
assert.equal(packageJson.packageManager, 'pnpm@11.7.0')
assert.equal(packageJson.engines?.node, '^22.19.0 || >=24.0.0')
for (const script of Object.keys(packageJson.scripts ?? {})) {
  assert.equal(
    script === 'prepack' || script === 'prepare' || script.includes('publish'),
    false,
    `private Git installs must not define ${script}`,
  )
}
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  assert.equal(/(?:npm|pnpm)\s+(?:publish|pack)\b/.test(String(command)), false, `${name} creates or publishes a package`)
  if (/\bpublint\b/.test(String(command))) {
    assert.match(String(command), /--pack=false\b/, `${name} must keep publint from creating a tarball`)
  }
}
for (const field of dependencyFields) {
  for (const [name, specifier] of Object.entries(packageJson[field] ?? {})) {
    assert.equal(localSpecifier.test(String(specifier)), false, `${field}.${name} must resolve from a registry`)
    assert.equal(['cordis', 'schemastery', '@cordisjs/plugin-include', '@cordisjs/plugin-loader'].includes(name), false, `${field}.${name} must use the official private SDK name`)
  }
}
for (const [name, specifier] of Object.entries(packageJson.peerDependencies ?? {})) {
  if (name.startsWith('@deepseek-ai/')) {
    assert.ok(packageJson.devDependencies?.[name], `${name} must also be an official SDK devDependency`)
    assert.equal(packageJson.devDependencies[name], specifier, `${name} must use the same peer and development version`)
  }
}

const npmrc = await readFile(join(root, '.npmrc'), 'utf8')
assert.equal(npmrc, '@deepseek-ai:registry=https://registry.npmjs.org/\n')
assert.equal(Object.keys(packageJson.exports ?? {}).some(key => key.startsWith('./src')), false)
assert.equal((packageJson.files ?? []).some(file => file === 'src' || file.startsWith('src/')), false)
const patchPath = packageJson.dsh?.bundle?.patch
assert.equal(typeof patchPath, 'string', 'dsh.bundle.patch is required')
await access(join(root, patchPath))
await access(join(root, packageJson.main))
await access(join(root, packageJson.types))

const declaredRuntime = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
])
const declaredDevelopment = new Set([...declaredRuntime, ...Object.keys(packageJson.devDependencies ?? {})])
const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)['"](@deepseek-ai\/[A-Za-z0-9_-]+)/g

async function filesBelow(directory) {
  const base = join(root, directory)
  let entries
  try {
    entries = await readdir(base, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = []
  for (const entry of entries) {
    const path = join(base, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(relative(root, path)))
    else files.push(path)
  }
  return files
}

for (const directory of ['src', 'tests', 'scripts', 'shared']) {
  for (const file of await filesBelow(directory)) {
    if (!['.ts', '.tsx', '.js', '.mjs', '.mts', '.cts'].includes(extname(file))) continue
    const source = await readFile(file, 'utf8')
    assert.equal(/(?:from\s+|import\s*(?:\(\s*)?)['"](?:cordis|schemastery|@cordisjs\/plugin-(?:include|loader))['"]/.test(source), false, `${relative(root, file)} imports a public SDK twin`)
    for (const match of source.matchAll(importPattern)) {
      const name = match[1]
      if (name === packageJson.name) continue
      const declared = directory === 'src' ? declaredRuntime : declaredDevelopment
      assert.ok(declared.has(name), `${relative(root, file)} imports undeclared ${name}`)
    }
  }
}

const isBrowserPlugin = Object.keys(packageJson.peerDependencies ?? {})
  .some(name => name.startsWith('@deepseek-ai/dsh-client-'))
if (isBrowserPlugin) {
  await access(join(root, 'shared', 'tsdown.client.ts'))
  const tsdownConfig = await readFile(join(root, 'tsdown.config.ts'), 'utf8')
  assert.match(tsdownConfig, /from ['"]\.\/shared\/tsdown\.client\.ts['"]/, 'browser plugins must use the shared client preset')
}

const forbiddenCheckout = /test-vibeinging|deepseek-harness\/packages|\.dsh\/source\/current/
for (const directory of ['src', 'tests', 'docs', 'compat', 'shared', '.github']) {
  for (const file of await filesBelow(directory)) {
    if (file.includes(`${join('docs', 'assets')}${process.platform === 'win32' ? '\\' : '/'}`)) continue
    const extension = extname(file)
    if (!['.ts', '.tsx', '.js', '.mjs', '.md', '.yml', '.yaml', '.json'].includes(extension)) continue
    const source = await readFile(file, 'utf8')
    assert.equal(forbiddenCheckout.test(source), false, `${relative(root, file)} references a DSH source checkout`)
    assert.equal(/[\p{Emoji_Presentation}\uFE0F\u200D\p{Regional_Indicator}\u2600-\u27BF]/u.test(source), false, `${relative(root, file)} contains emoji`)
  }
}

for (const file of ['README.md', 'README.zh.md']) {
  const source = await readFile(join(root, file), 'utf8')
  assert.equal(forbiddenCheckout.test(source), false, `${file} references a DSH source checkout`)
  assert.equal(/[\p{Emoji_Presentation}\uFE0F\u200D\p{Regional_Indicator}\u2600-\u27BF]/u.test(source), false, `${file} contains emoji`)
}

for (const file of ['package.json', 'tsconfig.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
  try {
    const source = await readFile(join(root, file), 'utf8')
    assert.equal(/(?:^|[\s"'=])(?:file|link|workspace):/m.test(source), false, `${file} contains a local dependency protocol`)
    if (file.startsWith('tsconfig')) {
      assert.equal(forbiddenCheckout.test(source), false, `${file} references a DSH source checkout`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

console.log(`repository rules: ${packageJson.name} passed`)
