// 公司设置 → 通讯（需求文档二十二 / 二十五 / 三十 / 四十一）。
// 所有外部 IM 配置统一在这一页：连接状态、群映射、默认负责人、消息路由、允许用户、权限模式、附件能力。
// 铁律一：凭证只显示 SecretRef 与掩码（需求文档三十一），未配置的平台如实显示「未连接」。
// 铁律二（需求文档四十八）：本页所有状态只来自 CommunicationManager.summary()。
//   host 压根没下发摘要时，「未连接 / 未配置 / 0」都是面板自己编的结论 —— 那种情况一律显示「未知」。
import { createElement as h, useState } from 'react'
import { IM_PLATFORMS, type AdapterConnectionState, type AdapterSummary, type ChannelBinding, type CommunicationSummary, type IMPlatform } from '../../integrations/im/types'
import { ActionButton, DASH, Empty, KeyValues, SettingsCard, SettingsRow, StatusPill, Toggle, countText, formatDateTime, type PillTone } from './styles'

/** 未知 ≠ 未配置。面板读不到摘要时用它，绝不替老板宣布「没连」。 */
const UNKNOWN = '未知'

const PLATFORM_LABEL: Record<IMPlatform, { name: string; kind: string }> = {
  feishu: { name: '飞书', kind: '企业机器人 · 长连接 / Webhook' },
  qq: { name: 'QQ', kind: 'QQ Bot / OneBot' },
  wechat: { name: '微信', kind: '企业微信 / Adapter' },
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

/** Partial：允许 host 分批接线，缺什么就在 UI 上如实显示「未配置 / —」。 */
export type CommunicationSettingsData = Partial<CommunicationSummary> & {
  /** 公司频道名，用于把 companyChannelId 显示成人话；缺省时直接显示 id。 */
  channels?: Array<{ id: string; name: string }>
  employees?: Array<{ id: string; name: string }>
  loaded?: boolean
}

export type CommunicationSettingsActions = {
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

/** 面板到底有没有拿到 manager.summary()。没拿到时 adapters 是空数组，但那不代表「没有渠道」。 */
export function summaryLoaded(data?: CommunicationSettingsData): boolean {
  return !!data && Array.isArray(data.adapters)
}

/**
 * 「员工之间自动转交上限」的真实生效值。
 * manager.summary().maxEmployeeHops 在一个渠道都没有时会回落到代码里的缺省常量 ——
 * 那个数字不是任何渠道真实生效的上限，必须自报家门，不能当成配置读出来的值展示。
 */
export function describeHopLimit(data?: CommunicationSettingsData): { value: string; fallback: boolean; known: boolean } {
  const hops = data?.maxEmployeeHops
  if (!summaryLoaded(data) || typeof hops !== 'number' || !Number.isFinite(hops)) {
    return { value: `${UNKNOWN}（面板未拿到通讯摘要）`, fallback: false, known: false }
  }
  if (!(data?.adapters || []).length) return { value: `${UNKNOWN}（尚未接入渠道，${hops} 次只是缺省回落值）`, fallback: true, known: true }
  return { value: `${hops} 次（各启用渠道 routing.maxHops 的最大值）`, fallback: false, known: true }
}

export function CommunicationSettings(props: { data?: CommunicationSettingsData; actions?: CommunicationSettingsActions; onRefresh?: () => void }) {
  const { data, actions, onRefresh } = props
  const adapters = data?.adapters || []
  const loaded = summaryLoaded(data)
  const hops = describeHopLimit(data)
  const [openId, setOpenId] = useState<string | null>(null)

  return h('div', { className: 'cy9-set-main' },
    !loaded ? h('div', { className: 'cy9-set-banner' }, '面板没有拿到通讯配置摘要（host 未下发 CommunicationManager.summary()）。下面每一行的「未知」只表示面板读不到，不代表老板没有配置飞书 / QQ / 微信。') : null,
    h(SettingsCard, {
      title: '通讯渠道',
      meta: loaded ? (adapters.length ? `${adapters.filter((item) => item.state === 'connected').length}/${adapters.length} 已连接` : '未配置') : '未读取',
      note: '所有外部通讯统一配置在这里；平台只是入口，员工身份、记忆与履历在所有平台共用同一份（需求文档二十九）。',
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
                  hint: '当前运行时未提供渠道创建能力：请在 cordis 配置的 communication.adapters 里添加，凭证写 env:/secret: 引用',
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
          { label: '已接入渠道', value: adapters.length ? adapters.map((item) => `${PLATFORM_LABEL[item.platform]?.name || item.platform}${item.enabled ? '' : '（停用）'}`).join('、') : (loaded ? DASH : UNKNOWN) },
        ],
      }),
    ),
    loaded && !adapters.length ? h('div', { className: 'cy9-set-banner info' }, '尚未接入任何外部渠道。Web 工作台本身就是一个平台入口，接入飞书 / QQ / 微信后仍然是同一批员工在干活。') : null,
  )
}
