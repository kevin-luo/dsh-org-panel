// Runtime assets are generated as compressed WebP data URLs.
// DSH loads plugin clients with fetch + eval and does not expose package files as a stable
// static directory, so the client must not guess /plugins/... asset paths.
import { RUNTIME_ASSETS } from './generated-assets'

const FALLBACK_STAFF = 'developer'
const reported = new Set<string>()

function runtimeAsset(path: string): string {
  return RUNTIME_ASSETS[path] || ''
}

export function reportAssetFailure(path: string) {
  if (reported.has(path)) return
  reported.add(path)
  console.error(`[dsh-org-panel] 运行时资产加载失败：${path}，已切换到内置回退。`)
}

export function staffThumb(staffId: string): string {
  return runtimeAsset(`staff/${staffId}/thumb.webp`)
    || runtimeAsset(`staff/${FALLBACK_STAFF}/thumb.webp`)
}

export function staffSprite(staffId: string): string {
  return runtimeAsset(`staff/${staffId}/sprite.webp`)
    || runtimeAsset(`staff/${FALLBACK_STAFF}/sprite.webp`)
}

export function staffProfile(staffId: string): string {
  return runtimeAsset(`staff/${staffId}/profile.webp`)
    || runtimeAsset(`staff/${FALLBACK_STAFF}/profile.webp`)
}

export function officeBase(): string {
  return runtimeAsset('office/office-hq-base.webp')
}

export function brandLogo(): string {
  return runtimeAsset('ui/logo-hex.webp')
}
