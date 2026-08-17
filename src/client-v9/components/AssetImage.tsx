import { createElement as h, useState } from 'react'
import { reportAssetFailure } from '../asset-map'

export function AssetImage(props: {
  src: string
  alt: string
  className?: string
  fallback?: string
  loading?: 'eager' | 'lazy'
}) {
  const { src, alt, className, fallback, loading = 'lazy' } = props
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(src ? 'loading' : 'failed')
  if (!src || state === 'failed') {
    return h('span', {
      className: `${className || ''} cy9-asset-fallback`.trim(),
      role: 'img',
      'aria-label': alt,
    }, (fallback || alt || '?').slice(0, 2))
  }
  return h('img', {
    src,
    alt,
    className: `${className || ''}${state === 'loading' ? ' is-loading' : ' is-loaded'}`,
    loading,
    decoding: 'async',
    onLoad: () => setState('loaded'),
    onError: () => { reportAssetFailure(alt); setState('failed') },
  })
}
