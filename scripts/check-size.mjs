import { stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const client = join(root, 'lib', 'client.js')
const clientLimit = 3.5 * 1024 * 1024
const packLimit = 4.5 * 1024 * 1024

const clientSize = (await stat(client)).size
const packJson = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
const packInfo = JSON.parse(packJson)[0]
const packSize = Number(packInfo?.size || 0)

console.log(`client.js: ${(clientSize / 1024 / 1024).toFixed(2)} MiB / 3.50 MiB`)
console.log(`npm pack: ${(packSize / 1024 / 1024).toFixed(2)} MiB / 4.50 MiB`)

if (clientSize > clientLimit || packSize > packLimit) {
  console.error('Size budget exceeded.')
  process.exit(1)
}
