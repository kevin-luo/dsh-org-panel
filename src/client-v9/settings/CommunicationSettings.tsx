// 公司设置 → 通讯。
//
// 两层通讯能力统一在这里：
// 1. DSH 生态传输层：优先复用 @xmanrui/dsh-im 的微信/QQ/飞书等成熟协议和扫码生命周期；
// 2. org-panel 内置 CommunicationManager：继续负责兼容已有配置，并承载公司级员工路由/权限摘要。
//
// 员工身份、记忆、技能、履历始终属于赛博公司；IM 插件只负责把消息可靠送进 Harness。
import { createElement as h, useState } from 'react'
import { IM_PLATFORMS, type AdapterConnectionState, type AdapterSummary, type ChannelBinding, type CommunicationSummary, type IMPlatform } from '../../integrations/im/types'
import type { DshImChannelActions, DshImWeixinActions } from '../dsh-im-bridge'
import { DshImChannelSettings } from './DshImChannelSettings'
import { ActionButton, DASH, Empty, KeyValues, SettingsCard, SettingsRow, StatusPill, Toggle, countText, formatDateTime, type PillTone } from './styles'

const UNKNOWN = '未知'

const PLATFORM_LABEL: Record<IMPlatform, { name: string; kind: string }> = {
  feishu: { name: '飞书', kind: '内置兼容 Adapter · 长连接 / Webhook' },
  qq: { name: 'QQ', kind: '内置兼容 Adapter（实验）' },
  wechat: { name: '微信', kind: '内置兼容 Adapter（实验）' },
}

const STATE_VIEW: Record<AdapterConnectionState, { tone: PillTone; label: string }> = {
  connected: { tone: 'ok', label: '已连接' },
  connecting: { tone: 'info', label: '连接中' },
  degraded: { tone: 'warn', label: '降级运行' },
  error: { tone: 'bad', label: '连接异常' },
  stopped: { tone: 'off', label: '已停止' },
  idle: { tone: 'off', label: '未启动' },
}

const PERMISSION_LABEL: Record<string, string> = {
  'read-only': 'Read Only', 'workspace-write': 'Workspace Write', 'danger-full-access': 'Full Access',
}

export type CommunicationSettingsData = Partial<CommunicationSummary> & {
  channels?: Array<{ id: string; name: string }>
  employees?: Array<{ id: string; name: string }>
  reason?: string
  loaded?: boolean
}

export type CommunicationSettingsActions = {
  /** 统一 dsh-im Provider。当前真实接线：微信 / QQ / 飞书。 */
  dshIm?: Partial<Record<'weixin' | 'qq' | 'feishu', DshImChannelActions>>
  /** 兼容旧调用方；新代码优先用 dshIm.weixin。 */
  dshImWeixin?: DshImWeixinActions
  /** 以下是 org-panel 内置 CommunicationManager 的兼容写入口。 */
  setEnabled?(adapterId: string, enabled: boolean): unknown | Promise<unknown>
  reconnect?(adapterId: string): unknown | Promise<unknown>
  addChannel?(platform: IMPlatform): unknown | Promise<unknown>
}

function capabilityText(capabilities: AdapterSummary['capabilities']): string {
  const items: Array<[string, boolean]> = [['文本', capabilities.text], ['图片', capabilities.image], ['文件', capabilities.file], ['语音', capabilities.audio], ['视频', capabilities.video]]
  return items.map(([label, on]) => `${on ? '✓' : '✕'} ${label}`).join(' · ')
}

function AdapterDetail(props: { adapter: AdapterSummary; data?: CommunicationSettingsData }) {
  const { adapter, data } = props
  const nameOf = (id: string) => data?.employees?.find((item) => item.id === id)?.name || id
  const channelOf = (id: string) => data?.channels?.find((item) => item.id === id)?.name || id
  const bindings = (data?.channelBindings || []).filter((item: ChannelBinding) => item.adapterId === adapter.id)
  const owner = adapter.routing.defaultTarget === 'secretary' ? '秘书（默认路由）' : adapter.routing.defaultTarget === 'auto' ? '按内容自动分派' : nameOf(adapter.routing.defaultTarget)
  return h('div', null,
    h(KeyValues, {
      items: [
        { label: '默认负责人', value: owner },
        { label: '消息路由', value: `${adapter.routing.recognizeMentions ? '识别 @ 员工' : '不识别 @'} · ${adapter.routing.allowEmployeeCollaboration ? '允许员工互相转交' : '禁止员工互转'} · 最多 ${countText(adapter.routing.maxHops)} 跳` },
        { label: '投递失败', value: adapter.routing.notifyUndeliverable ? '回一条事实说明' : '静默丢弃' },
        { label: '权限模式', value: PERMISSION_LABEL[adapter.access.defaultPermissionMode] || adapter.access.defaultPermissionMode },
        { label: '允许用户', value: `名单 ${countText(adapter.access.actorCount, ' 人')} · 名单外用户${adapter.access.allowUnknownUsers ? '可以' : '不可'}发起` },
        { label: '允许群', value: `名单 ${countText(adapter.access.conversationCount, ' 个')} · 名单外群${adapter.access.allowUnknownConversations ? '可以' : '不可'}发起` },
        { label: '附件能力', value: capabilityText(adapter.capabilities) },
        { label: '收发统计', value: `收 ${countText(adapter.receivedCount)} · 发 ${countText(adapter.sentCount)}` },
        { label: '最近收到', value: formatDateTime(adapter.lastEventAt) },
        { label: '最近发出', value: formatDateTime(adapter.lastSentAt) },
      ],
    }),
    h('div', { className: 'cy9-set-note' }, '凭证（只显示引用与掩码，完整值永远不下发到前端）'),
    adapter.credentials.length
      ? adapter.credentials.map((credential) => h(SettingsRow, {
        key: credential.field,
        title: credential.field,
        desc: credential.ref,
        side: h(StatusPill, { tone: credential.configured ? 'ok' : 'bad', label: credential.configured ? (credential.masked || '已配置') : '引用存在但未取到值' }),
      }))
      : h(Empty, { text: '未配置凭证。' }),
    h('div', { className: 'cy9-set-note' }, '群映射（外部会话 → 公司频道）'),
    bindings.length
      ? bindings.map((binding) => h(SettingsRow, {
        key: `${binding.adapterId}-${binding.externalConversationId}`,
        title: `${binding.externalConversationId} → # ${channelOf(binding.companyChannelId)}`,
        desc: binding.defaultEmployees?.length ? `默认负责人 ${binding.defaultEmployees.map(nameOf).join('、')}` : '未指定默认负责人',
      }))
      : h(Empty, { text: '暂无群映射。' }),
  )
}

export function summaryLoaded(data?: CommunicationSettingsData): boolean {
  return !!data && Array.isArray(data.adapters)
}

export function describeHopLimit(data?: CommunicationSettingsData): { value: string; fallback: boolean; known: boolean } {
  const hops = data?.maxEmployeeHops
  if (!summaryLoaded(data) || typeof hops !== 'number' || !Number.isFinite(hops)) {
    return { value: `${UNKNOWN}（面板未拿到通讯摘要）`, fallback: false, known: false }
  }
  if (!(data?.adapters || []).length) return { value: `${UNKNOWN}（尚未接入内置渠道，${hops} 次只是缺省回落值）`, fallback: true, known: true }
  return { value: `${hops} 次（各启用渠道 routing.maxHops 的最大值）`, fallback: false, known: true }
}

export function CommunicationSettings(props: { data?: CommunicationSettingsData; actions?: CommunicationSettingsActions; onRefresh?: () => void }) {
  const { data, actions, onRefresh } = props
  const adapters = data?.adapters || []
  const loaded = summaryLoaded(data)
  const hops = describeHopLimit(data)
  const [openId, setOpenId] = useState<string | null>(null)

  return h('div', { className: 'cy9-set-main' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
      h('div', { style: { marginRight: 'auto' } },
        h('b', { style: { display: 'block', fontSize: 13 } }, '公司通讯中枢'),
        h('span', { style: { color: 'var(--set-muted)', fontSize: 10 } }, '微信、QQ、飞书优先走成熟 DSH IM Provider；赛博公司负责员工路由、长期记忆、履历与权限。'),
      ),
      h(StatusPill, { tone: 'info', label: '生态 Provider' }),
    ),

    h('div', { className: 'cy9-set-banner info' }, '推荐接入层：下面三个入口都直接调用 @xmanrui/dsh-im 的公开 RPC。能扫码就扫码；已有机器人也可以手动填官方凭证。'),
    h(DshImChannelSettings, { platform: 'weixin', actions: actions?.dshIm?.weixin || actions?.dshImWeixin, onConnected: onRefresh }),
    h(DshImChannelSettings, { platform: 'qq', actions: actions?.dshIm?.qq, onConnected: onRefresh }),
    h(DshImChannelSettings, { platform: 'feishu', actions: actions?.dshIm?.feishu, onConnected: onRefresh }),

    !loaded ? h('div', { className: 'cy9-set-banner' },
      data?.reason
        ? `面板没有拿到通讯配置摘要 —— host 原话：${data.reason}。上方 dsh-im Provider 是独立插件频道，不受这个状态影响。`
        : '面板没有拿到通讯配置摘要。上方 dsh-im Provider 独立探测，可以照常扫码或绑定机器人。',
    ) : null,

    h(SettingsCard, {
      title: '内置通讯 Runtime（兼容层）',
      meta: loaded ? (adapters.length ? `${adapters.filter((item) => item.state === 'connected').length}/${adapters.length} 已连接` : '未配置') : '未读取',
      note: '保留已有 Feishu / QQ / WeChat Adapter 兼容能力。新用户优先走上方 DSH IM Provider，避免赛博公司重复维护平台协议。',
    },
      IM_PLATFORMS.map((platform) => {
        const adapter = adapters.find((item) => item.platform === platform)
        const label = PLATFORM_LABEL[platform] || { name: platform, kind: 'Adapter' }
        const view = adapter ? STATE_VIEW[adapter.state] : { tone: 'off' as PillTone, label: loaded ? '未连接' : UNKNOWN }
        return h('div', { key: platform },
          h(SettingsRow, {
            title: label.name,
            desc: [
              adapter ? `${adapter.name} · ${adapter.connectionMode || label.kind}` : label.kind,
              adapter?.detail || '',
              adapter?.lastEventAt ? `最近同步 ${formatDateTime(adapter.lastEventAt)}` : '',
            ].filter(Boolean).join(' · '),
            side: [
              h(StatusPill, { key: 'state', tone: view.tone, label: view.label, title: adapter?.detail }),
              adapter ? h(Toggle, {
                key: 'enabled', on: adapter.enabled, labels: ['已启用', '已停用'],
                onChange: actions?.setEnabled ? ((next: boolean) => actions.setEnabled!(adapter.id, next)) : undefined,
                hint: '当前运行时未提供渠道启停写入能力', onDone: () => onRefresh?.(),
              }) : null,
              adapter ? h(ActionButton, {
                key: 'reconnect', label: '重连', busyLabel: '重连中…',
                run: actions?.reconnect ? (() => actions.reconnect!(adapter.id)) : undefined,
                hint: '当前运行时未提供重连能力', onDone: () => onRefresh?.(),
              }) : null,
              adapter
                ? h('button', { key: 'manage', type: 'button', className: 'cy9-set-btn', onClick: () => setOpenId(openId === adapter.id ? null : adapter.id) }, openId === adapter.id ? '收起' : '管理')
                : h(ActionButton, {
                  key: 'configure', label: '配置',
                  run: actions?.addChannel ? (() => actions.addChannel!(platform)) : undefined,
                  hint: '内置渠道创建尚未接线；推荐使用上方 dsh-im Provider。',
                  onDone: () => onRefresh?.(),
                }),
            ],
          }),
          adapter && openId === adapter.id ? h(AdapterDetail, { adapter, data }) : null,
        )
      }),
    ),
    h(SettingsCard, { title: '公司级路由', meta: loaded ? (data?.configured ? undefined : '未配置') : '未读取' },
      h(KeyValues, {
        items: [
          { label: '员工之间自动转交上限', value: hops.value },
          { label: '群映射总数', value: loaded ? countText(data?.channelBindings?.length, ' 条') : UNKNOWN },
          { label: '内置已接入渠道', value: adapters.length ? adapters.map((item) => `${PLATFORM_LABEL[item.platform]?.name || item.platform}${item.enabled ? '' : '（停用）'}`).join('、') : (loaded ? DASH : UNKNOWN) },
        ],
      }),
    ),
  )
}
