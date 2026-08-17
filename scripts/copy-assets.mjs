import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src', 'assets')
const dest = join(root, 'lib', 'assets')

if (!existsSync(src)) {
  console.warn('[copy-assets] src/assets not found, skipping')
  process.exit(0)
}

mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log('[copy-assets] copied src/assets -> lib/assets')
