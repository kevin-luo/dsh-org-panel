// 公司设置 → 通讯 → DSH IM 统一渠道卡。
//
// 微信 / QQ / 飞书共用这一套 UI 状态机：探测 → 扫码/手动凭证 → 连接 → 重连/移除。
// 协议、二维码签发、Secret 落盘均由 @xmanrui/dsh-im 负责；本组件只消费公开脱敏 RPC。
import { createElement as h, useEffect, useRef, useState } from 'react'
import {
  DSH_IM_INSTALL_COMMAND,
  createDshImChannelActions,
  dshImSpec,
  type DshImChannelActions,
  type DshImPlatform,
  type DshImProvisioning,
  type DshImStatus,
} from '../dsh-im-bridge'
import { currentOrgPanelRpc } from '../rpc'
import { ActionButton, Empty, SettingsCard, SettingsRow, StatusPill } from './styles'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '未知错误')
}

function isUnavailable(message: string): boolean {
  return /没有应答 \/(?:weixin|qq|feishu)|对应插件未安装|channel|频道|webServer|HTTP 404/i.test(message)
}

function statusLabel(status: DshImProvisioning['status']): string {
  const labels: Record<DshImProvisioning['status'], string> = {
    starting: '正在生成二维码',
    pending: '等待扫码',
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

function platformHint(platform: DshImPlatform): string {
  if (platform === 'weixin') return '使用手机微信扫码。部分账号扫码后会要求输入手机上显示的数字配对码。'
  if (platform === 'qq') return '使用手机 QQ 扫码创建/绑定 QQBot；也可以填写已有机器人 AppID + AppSecret。'
  if (platform === 'feishu') return '使用飞书扫码创建机器人；也可以填写已有应用 App ID + App Secret。'
  return '按平台官方流程完成接入。'
}

export function DshImChannelSettings(props: {
  platform: DshImPlatform
  actions?: DshImChannelActions
  onConnected?(): void
}) {
  const spec = dshImSpec(props.platform)
  const fallbackActions = createDshImChannelActions(currentOrgPanelRpc(), props.platform)
  const effectiveActions = props.actions || fallbackActions
  const actionsRef = useRef<DshImChannelActions>(effectiveActions)
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
  const [manualOpen, setManualOpen] = useState(false)
  const [firstCredential, setFirstCredential] = useState('')
  const [secondCredential, setSecondCredential] = useState('')
  const [now, setNow] = useState(Date.now())

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  const schedulePoll = (current: DshImProvisioning) => {
    clearTimer()
    const poll = actionsRef.current.poll
    if (!poll || ['connected', 'expired', 'failed', 'cancelled', 'needs_verification'].includes(current.status)) return
    timer.current = setTimeout(async () => {
      if (stopped.current) return
      try {
        const next = await poll(current.attemptId)
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

  const load = async () => {
    const actions = actionsRef.current
    setLoading(true)
    try {
      const value = await actions.status()
      if (stopped.current) return
      setSnapshot(value)
      setMissing(false)
      setError(null)
      const active = value.provisioning || null
      setProvision(active)
      if (active) schedulePoll(active)
    } catch (err) {
      if (stopped.current) return
      const message = errorText(err)
      setMissing(isUnavailable(message))
      setError(message)
    } finally {
      if (!stopped.current) setLoading(false)
    }
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
    // actionsRef 始终保持最新对象，只在组件生命周期启动一次探测。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const begin = async () => {
    const action = actionsRef.current.begin
    if (!action || busy) return
    setBusy(true)
    setError(null)
    setVerifyCode('')
    setManualOpen(false)
    clearTimer()
    try {
      const value = await action()
      setProvision(value)
      schedulePoll(value)
    } catch (err) {
      setError(errorText(err))
    } finally { setBusy(false) }
  }

  const cancel = async () => {
    const action = actionsRef.current.cancel
    if (!provision || !action || busy) return
    setBusy(true)
    clearTimer()
    try {
      await action(provision.attemptId)
      setProvision(null)
      setVerifyCode('')
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally { setBusy(false) }
  }

  const verify = async () => {
    const action = actionsRef.current.verify
    if (!provision || !action || busy) return
    if (!/^\d{4,8}$/.test(verifyCode)) {
      setError('请输入手机上显示的 4～8 位数字配对码。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const value = await action(provision.attemptId, verifyCode)
      setProvision(value)
      schedulePoll(value)
    } catch (err) {
      setError(errorText(err))
    } finally { setBusy(false) }
  }

  const bindCredentials = async () => {
    const action = actionsRef.current.bindCredentials
    if (!action || busy) return
    setBusy(true)
    setError(null)
    try {
      const value = await action(firstCredential, secondCredential)
      setSnapshot(value)
      setFirstCredential('')
      setSecondCredential('')
      setManualOpen(false)
      props.onConnected?.()
    } catch (err) {
      setError(errorText(err))
    } finally { setBusy(false) }
  }

  const accounts = snapshot?.accounts || []
  const installed = !!snapshot
  const credentialLabels = spec.credentialLabels || ['账号', 'Secret']

  return h(SettingsCard, {
    title: `${spec.label} · DSH IM`,
    meta: loading ? '探测中' : installed ? `${snapshot!.connected}/${snapshot!.configured} 在线` : missing ? '未安装 dsh-im' : '不可用',
    actions: installed && !provision ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      spec.qr && actionsRef.current.begin ? h('button', {
        type: 'button', className: 'cy9-set-btn primary', disabled: busy, onClick: () => void begin(),
      }, busy ? '处理中…' : '扫码接入') : null,
      spec.credentials && actionsRef.current.bindCredentials ? h('button', {
        type: 'button', className: 'cy9-set-btn', disabled: busy, onClick: () => setManualOpen((value) => !value),
      }, manualOpen ? '收起手动接入' : '手动接入') : null,
    ) : null,
    note: `${spec.description}。协议和 Secret 生命周期由 @xmanrui/dsh-im 负责；赛博公司只管理员工、路由、记忆与履历。`,
  },
    missing ? h('div', { style: { padding: 12 } },
      h('div', { className: 'cy9-set-banner info' }, `检测不到 @xmanrui/dsh-im。安装后这里会自动出现 ${spec.label} 的真实接入入口。`),
      h('div', { style: { marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('code', { className: 'cy9-set-mono', style: { padding: '7px 10px', border: '1px solid var(--set-line)', borderRadius: 7 } }, DSH_IM_INSTALL_COMMAND),
        h('span', { style: { color: 'var(--set-muted)', fontSize: 10 } }, '安装后刷新 DSH Web。'),
      ),
    ) : null,

    !missing && error ? h('div', { className: 'cy9-set-banner bad', style: { margin: 12 } }, error) : null,

    installed && manualOpen && actionsRef.current.bindCredentials ? h('div', {
      style: { margin: 12, padding: 12, border: '1px solid var(--set-line)', borderRadius: 9, background: 'rgba(255,255,255,.015)' },
    },
      h('b', { style: { display: 'block', marginBottom: 8, fontSize: 11 } }, `${spec.label}已有机器人凭证`),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) minmax(180px,1fr) auto', gap: 8 } },
        h('input', {
          className: 'cy9-set-input', value: firstCredential, autoComplete: 'off', placeholder: credentialLabels[0],
          onChange: (event: any) => setFirstCredential(String(event?.target?.value || '')),
        }),
        h('input', {
          className: 'cy9-set-input', type: 'password', value: secondCredential, autoComplete: 'new-password', placeholder: credentialLabels[1],
          onChange: (event: any) => setSecondCredential(String(event?.target?.value || '')),
        }),
        h('button', {
          type: 'button', className: 'cy9-set-btn primary', disabled: busy || !firstCredential.trim() || !secondCredential.trim(),
          onClick: () => void bindCredentials(),
        }, busy ? '连接中…' : '保存并连接'),
      ),
      h('div', { className: 'cy9-set-note' }, 'Secret 只通过本次 RPC 提交给本机 Harness Host；连接成功后立即从表单 state 清空，状态接口不会回传完整 Secret。'),
    ) : null,

    installed && provision ? h('div', {
      style: { padding: 12, display: 'grid', gridTemplateColumns: 'minmax(220px,320px) minmax(240px,1fr)', gap: 18, alignItems: 'start' },
    },
      h('div', { style: { textAlign: 'center' } },
        provision.qrCodeDataUrl
          ? h('img', { src: provision.qrCodeDataUrl, alt: `${spec.label}扫码接入二维码`, style: { width: 260, maxWidth: '100%', borderRadius: 10, background: '#fff', padding: 8 } })
          : h('div', { className: 'cy9-set-empty', style: { minHeight: 220, display: 'grid', placeItems: 'center' } }, '二维码正在生成…'),
        h('div', { style: { marginTop: 8, color: 'var(--set-muted)', fontSize: 10 } }, `有效期 ${remaining(provision.expiresAt)} · ${new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}`),
      ),
      h('div', null,
        h(StatusPill, { tone: toneOf(provision.status), label: `${spec.label} · ${statusLabel(provision.status)}` }),
        h('h3', { style: { margin: '10px 0 6px', fontSize: 15 } }, provision.status === 'needs_verification' ? '输入手机显示的配对码' : `使用手机${spec.label}完成扫码`),
        h('p', { style: { color: 'var(--set-muted)', fontSize: 11, lineHeight: 1.6 } }, platformHint(props.platform)),
        provision.status === 'needs_verification' && actionsRef.current.verify ? h('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
          h('input', {
            className: 'cy9-set-input', value: verifyCode, inputMode: 'numeric', maxLength: 8, placeholder: '4～8 位数字',
            onChange: (event: any) => setVerifyCode(String(event?.target?.value || '').replace(/\D/g, '').slice(0, 8)),
          }),
          h('button', { type: 'button', className: 'cy9-set-btn primary', disabled: busy || !/^\d{4,8}$/.test(verifyCode), onClick: () => void verify() }, busy ? '验证中…' : '继续连接'),
        ) : null,
        h('div', { style: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' } },
          ['expired', 'failed', 'cancelled'].includes(provision.status) && actionsRef.current.begin
            ? h('button', { type: 'button', className: 'cy9-set-btn primary', disabled: busy, onClick: () => void begin() }, '重新生成二维码')
            : null,
          provision.verificationUrl ? h('a', {
            className: 'cy9-set-btn', href: provision.verificationUrl, target: '_blank', rel: 'noopener noreferrer',
            style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' },
          }, '备用链接') : null,
          actionsRef.current.cancel ? h('button', { type: 'button', className: 'cy9-set-btn', disabled: busy, onClick: () => void cancel() }, '取消') : null,
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
          confirm: `确认移除${spec.label}机器人“${account.name}”吗？dsh-im 会删除该账号保存的连接凭证与会话映射。`,
        }),
      ],
    })) : null,

    installed && !provision && !accounts.length && !loading ? h('div', { style: { padding: 12 } },
      h(Empty, { text: `dsh-im 已安装，但还没有绑定${spec.label}机器人。` }),
      h('div', { style: { display: 'flex', justifyContent: 'center', gap: 8, marginTop: 8 } },
        spec.qr && actionsRef.current.begin ? h('button', { type: 'button', className: 'cy9-set-btn primary', disabled: busy, onClick: () => void begin() }, `生成${spec.label}二维码`) : null,
        spec.credentials && actionsRef.current.bindCredentials ? h('button', { type: 'button', className: 'cy9-set-btn', disabled: busy, onClick: () => setManualOpen(true) }, '使用已有凭证') : null,
      ),
    ) : null,
  )
}
