// 公司设置 → 通讯 → 微信扫码（复用 @xmanrui/dsh-im）。
//
// 这里只负责消费 dsh-im 已公开、已脱敏的 /weixin RPC；不复制 iLink 协议，不读取 bot token。
// dsh-im 未安装时显示明确安装入口；安装后二维码、扫码状态、配对码、重连与移除都是真实 RPC。
import { createElement as h, useEffect, useRef, useState } from 'react'
import {
  DSH_IM_INSTALL_COMMAND,
  createDshImWeixinActions,
  type DshImProvisioning,
  type DshImStatus,
  type DshImWeixinActions,
} from '../dsh-im-bridge'
import { currentOrgPanelRpc } from '../rpc'
import { ActionButton, Empty, SettingsCard, SettingsRow, StatusPill } from './styles'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '未知错误')
}

function isUnavailable(message: string): boolean {
  return /没有应答 \/weixin|对应插件未安装|channel|频道|webServer/i.test(message)
}

function statusLabel(status: DshImProvisioning['status']): string {
  const labels: Record<DshImProvisioning['status'], string> = {
    starting: '正在生成二维码',
    pending: '等待微信扫码',
    scanned: '已扫码，请在手机确认',
    needs_verification: '需要输入配对码',
    connecting: '正在建立消息连接',
    connected: '已连接',
    expired: '二维码已过期',
    failed: '绑定失败',
    cancelled: '已取消',
  }
  return labels[status]
}

function toneOf(status: DshImProvisioning['status']): 'ok' | 'warn' | 'bad' | 'info' | 'off' {
  if (status === 'connected') return 'ok'
  if (status === 'failed' || status === 'expired') return 'bad'
  if (status === 'cancelled') return 'off'
  if (status === 'pending' || status === 'needs_verification' || status === 'scanned') return 'warn'
  return 'info'
}

function remaining(expiresAt: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function DshImWeixinSettings(props: {
  actions?: DshImWeixinActions
  onConnected?(): void
}) {
  // dsh-im 与 /org-panel 是平级插件频道。即使 org-panel 的 Control Plane 暂时离线，
  // 只要 DSH connection.rpc 还在，就应该独立探测 /weixin，而不是被本插件状态连坐。
  const fallbackActions = createDshImWeixinActions(currentOrgPanelRpc())
  const effectiveActions = props.actions || fallbackActions
  const actionsRef = useRef<DshImWeixinActions>(effectiveActions)
  actionsRef.current = effectiveActions
  const timer = useRef<any>(null)
  const stopped = useRef(false)
  const [snapshot, setSnapshot] = useState<DshImStatus | null>(null)
  const [provision, setProvision] = useState<DshImProvisioning | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [now, setNow] = useState(Date.now())

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  const load = async () => {
    const actions = actionsRef.current
    setLoading(true)
    try {
      const value = await actions.status()
      if (stopped.current) return
      setSnapshot(value)
      setProvision(value.provisioning || null)
      setMissing(false)
      setError(null)
    } catch (err) {
      if (stopped.current) return
      const message = errorText(err)
      setMissing(isUnavailable(message))
      setError(message)
    } finally {
      if (!stopped.current) setLoading(false)
    }
  }

  const schedulePoll = (current: DshImProvisioning) => {
    clearTimer()
    if (['connected', 'expired', 'failed', 'cancelled', 'needs_verification'].includes(current.status)) return
    timer.current = setTimeout(async () => {
      const actions = actionsRef.current
      if (stopped.current) return
      try {
        const next = await actions.poll(current.attemptId)
        if (stopped.current) return
        setProvision(next)
        setError(next.error?.message || null)
        if (next.status === 'connected') {
          await load()
          props.onConnected?.()
          return
        }
        schedulePoll(next)
      } catch (err) {
        if (!stopped.current) setError(errorText(err))
      }
    }, current.pollIntervalMs)
  }

  useEffect(() => {
    stopped.current = false
    void load()
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      stopped.current = true
      clearTimer()
      clearInterval(clock)
    }
    // actionsRef 始终指向最新实现；只在组件生命周期起一次探测，避免父组件对象重建造成轮询重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const begin = async () => {
    const actions = actionsRef.current
    if (busy) return
    setBusy(true)
    setError(null)
    setVerifyCode('')
    clearTimer()
    try {
      const value = await actions.begin()
      setProvision(value)
      schedulePoll(value)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    const actions = actionsRef.current
    if (!provision || busy) return
    setBusy(true)
    clearTimer()
    try {
      await actions.cancel(provision.attemptId)
      setProvision(null)
      setVerifyCode('')
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally { setBusy(false) }
  }

  const verify = async () => {
    const actions = actionsRef.current
    if (!provision || busy) return
    if (!/^\d{4,8}$/.test(verifyCode)) {
      setError('请输入手机微信显示的 4～8 位数字配对码。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const value = await actions.verify(provision.attemptId, verifyCode)
      setProvision(value)
      schedulePoll(value)
    } catch (err) {
      setError(errorText(err))
    } finally { setBusy(false) }
  }

  const accounts = snapshot?.accounts || []
  const installed = !!snapshot

  return h(SettingsCard, {
    title: '微信 · DSH IM Bridge',
    meta: loading ? '探测中' : installed ? `${snapshot!.connected}/${snapshot!.configured} 在线` : missing ? '未安装 dsh-im' : '不可用',
    actions: installed && !provision ? h('button', {
      type: 'button', className: 'cy9-set-btn primary', disabled: busy, onClick: () => void begin(),
    }, busy ? '生成中…' : '扫码接入微信') : null,
    note: '微信协议、扫码和凭证生命周期交给 @xmanrui/dsh-im；赛博公司继续负责员工身份、记忆、技能和任务路由。二维码与状态来自真实 /weixin RPC。',
  },
    missing ? h('div', { style: { padding: 12 } },
      h('div', { className: 'cy9-set-banner info' }, '检测不到 @xmanrui/dsh-im。安装后这里会自动出现微信扫码入口；本项目不复制维护 iLink 协议实现。'),
      h('div', { style: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('code', { className: 'cy9-set-mono', style: { padding: '7px 10px', border: '1px solid var(--set-line)', borderRadius: 7 } }, DSH_IM_INSTALL_COMMAND),
        h('span', { style: { color: 'var(--set-muted)', fontSize: 10 } }, '安装后刷新 DSH Web。'),
      ),
    ) : null,
    !missing && error ? h('div', { className: 'cy9-set-banner bad', style: { margin: 12 } }, error) : null,
    installed && provision ? h('div', { style: { padding: 12, display: 'grid', gridTemplateColumns: 'minmax(220px,320px) minmax(240px,1fr)', gap: 18, alignItems: 'start' } },
      h('div', { style: { textAlign: 'center' } },
        provision.qrCodeDataUrl
          ? h('img', { src: provision.qrCodeDataUrl, alt: '微信扫码接入二维码', style: { width: 260, maxWidth: '100%', borderRadius: 10, background: '#fff', padding: 8 } })
          : h('div', { className: 'cy9-set-empty', style: { minHeight: 220, display: 'grid', placeItems: 'center' } }, '二维码正在生成…'),
        h('div', { style: { marginTop: 8, color: 'var(--set-muted)', fontSize: 10 } }, `有效期 ${remaining(provision.expiresAt)} · ${new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}`),
      ),
      h('div', null,
        h(StatusPill, { tone: toneOf(provision.status), label: statusLabel(provision.status) }),
        h('h3', { style: { margin: '10px 0 6px', fontSize: 15 } }, provision.status === 'needs_verification' ? '输入手机微信显示的配对码' : '使用手机微信扫码并确认'),
        h('p', { style: { color: 'var(--set-muted)', fontSize: 11, lineHeight: 1.6 } },
          '绑定凭证由 dsh-im 写入 Harness Host，赛博公司页面不会拿到 bot_token。扫码完成后，微信消息进入 Harness，再由公司秘书 / 员工路由规则处理。',
        ),
        provision.status === 'needs_verification' ? h('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
          h('input', {
            className: 'cy9-set-input', value: verifyCode, inputMode: 'numeric', maxLength: 8,
            placeholder: '4～8 位数字',
            onChange: (event: any) => setVerifyCode(String(event?.target?.value || '').replace(/\D/g, '').slice(0, 8)),
          }),
          h('button', { type: 'button', className: 'cy9-set-btn primary', disabled: busy || !/^\d{4,8}$/.test(verifyCode), onClick: () => void verify() }, busy ? '验证中…' : '继续连接'),
        ) : null,
        h('div', { style: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' } },
          ['expired', 'failed', 'cancelled'].includes(provision.status)
            ? h('button', { type: 'button', className: 'cy9-set-btn primary', disabled: busy, onClick: () => void begin() }, '重新生成二维码')
            : null,
          provision.verificationUrl ? h('a', { className: 'cy9-set-btn', href: provision.verificationUrl, target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' } }, '备用链接') : null,
          h('button', { type: 'button', className: 'cy9-set-btn', disabled: busy, onClick: () => void cancel() }, '取消'),
        ),
      ),
    ) : null,
    installed && !provision && accounts.length ? accounts.map((account) => h(SettingsRow, {
      key: account.botId,
      title: account.name,
      desc: [account.accountMasked, account.workspace, account.health].filter(Boolean).join(' · '),
      side: [
        h(StatusPill, { key: 'state', tone: account.connected ? 'ok' : account.state === 'error' ? 'bad' : 'warn', label: account.connected ? '在线' : account.state }),
        h(ActionButton, {
          key: 'reconnect', label: account.connected ? '检查连接' : '重连',
          run: () => actionsRef.current.reconnect(account.botId).then(() => load()),
        }),
        h(ActionButton, {
          key: 'remove', label: '移除', tone: 'danger',
          run: () => actionsRef.current.remove(account.botId).then(() => load()),
          confirm: `确认移除微信账号“${account.name}”吗？dsh-im 会删除该账号保存的连接凭证与会话映射。`,
        }),
      ],
    })) : null,
    installed && !provision && !accounts.length && !loading ? h('div', { style: { padding: 12 } },
      h(Empty, { text: 'dsh-im 已安装，但还没有绑定微信账号。' }),
      h('div', { style: { textAlign: 'center', marginTop: 8 } },
        h('button', { type: 'button', className: 'cy9-set-btn primary', disabled: busy, onClick: () => void begin() }, '生成微信二维码'),
      ),
    ) : null,
  )
}
