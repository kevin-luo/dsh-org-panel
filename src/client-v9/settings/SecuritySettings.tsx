// 公司设置 → 安全。
// 关注第三方插件安装审批、Shell 权限、外部通讯权限、模型 API Key 与动态工作组规模。
import { createElement as h } from 'react'
import type { SecretStorageStatus } from '../../models/types'
import { DASH, Empty, SelectField, SettingsCard, SettingsRow, StatusPill, countText, type PillTone } from './styles'

export const UNKNOWN = '未知'

export type SecretInventoryRow = {
  ref: string
  source?: string
  configured?: boolean
  masked?: string
  usedBy?: string
}

export type SecuritySettingsData = {
  pluginApproval?: {
    mode?: 'always' | 'preapproved' | 'none'
    preapproved?: string[]
    pendingCount?: number
    executor?: 'auto' | 'tool' | 'none'
  }
  shellPolicy?: string
  external?: { channels?: number; connected?: number; defaultPermission?: string; allowUnknownUsers?: boolean }
  secrets?: SecretInventoryRow[]
  secretStorage?: SecretStorageStatus | null
  /** CommunicationManager.summary() 下发的真实外部工作组人数上限。 */
  maxWorkgroupSize?: number
  loaded?: boolean
}

export type SecuritySettingsActions = {
  setPluginApprovalMode?(mode: string): unknown | Promise<unknown>
  setMaxWorkgroupSize?(value: number): unknown | Promise<unknown>
}

const APPROVAL_VIEW: Record<string, { tone: PillTone; label: string }> = {
  always: { tone: 'ok', label: '每次需要审批' }, preapproved: { tone: 'warn', label: '存在预批准清单' }, none: { tone: 'off', label: '只登记不安装' },
}

export type ApprovalView = { known: boolean; mode: string; tone: PillTone; label: string; desc: string }

export function describePluginApproval(approval?: SecuritySettingsData['pluginApproval']): ApprovalView {
  const unreadable = '面板没有收到运行时下发的 security.pluginApproval：无法判断是否存在预批准清单，也无法判断安装执行方式。真实策略以 cordis 配置里的 pluginInstall 为准。'
  if (!approval || typeof approval !== 'object' || !approval.mode) return { known: false, mode: '', tone: 'warn', label: `${UNKNOWN} · 面板未拿到审批策略`, desc: unreadable }
  const view = APPROVAL_VIEW[approval.mode]
  const preapproved = approval.preapproved
  const risky = Array.isArray(preapproved) && preapproved.length > 0
  const desc = [
    Array.isArray(preapproved) ? (preapproved.length ? `预批准包：${preapproved.join('、')}（这些包不会再问老板）` : '预批准清单为空') : `预批准清单 ${UNKNOWN}`,
    typeof approval.pendingCount === 'number' ? `待审批 ${approval.pendingCount} 条` : `待审批 ${UNKNOWN}`,
    approval.executor ? `安装执行方式 ${approval.executor}${approval.executor === 'auto' ? '（批准后自动执行安装命令）' : ''}` : `安装执行方式 ${UNKNOWN}`,
  ].join(' · ')
  if (!view) return { known: false, mode: approval.mode, tone: 'warn', label: `${UNKNOWN}策略 ${approval.mode}`, desc: `运行时下发了面板不认识的审批策略，按未知处理。${desc}` }
  return { known: true, mode: approval.mode, tone: risky ? 'warn' : view.tone, label: risky ? APPROVAL_VIEW.preapproved.label : view.label, desc }
}

export type StorageView = { tone: PillTone; label: string; desc: string; warning?: string }

export function describeSecretStorage(status?: SecretStorageStatus | null): StorageView {
  if (!status || typeof status !== 'object' || !status.mode) {
    return { tone: 'off', label: `${UNKNOWN} · 未拿到密钥库能力标志`, desc: '配置里只允许 env: / secret: 引用；解析后的值只留在 host 内存。本地密钥库保护等级当前读不到，因此这里不做保护等级声明。' }
  }
  const encrypted = status.mode === 'encrypted'
  const ownerOnly = status.ownerOnly !== false
  const desc = [
    `模式 ${status.mode}${encrypted ? '（口令派生密钥，口令不落盘）' : '（密钥材料来自本机公开信息，同机同用户可解密）'}`,
    `${status.cipher || 'AES'} · ${status.kdf || 'PBKDF2'} · ${countText(status.iterations)} 次`,
    `条目 ${countText(status.entries)}`,
    status.exists ? `文件权限 ${status.permissions || UNKNOWN}` : '密钥文件尚未创建',
    ownerOnly ? '' : '权限未收紧到 0600，同机其他用户可能读得到',
  ].filter(Boolean).join(' · ')
  return { tone: encrypted && ownerOnly && !status.warning ? 'ok' : 'warn', label: status.label || status.mode, desc, warning: status.warning }
}

export type WorkgroupView = { known: boolean; tone: PillTone; label: string; value: string }
export function describeWorkgroupSize(size?: number): WorkgroupView {
  if (typeof size !== 'number' || !Number.isFinite(size)) return { known: false, tone: 'off', label: UNKNOWN, value: '' }
  return { known: true, tone: 'info', label: `最多 ${size} 人`, value: String(size) }
}

export function SecuritySettings(props: { data?: SecuritySettingsData; actions?: SecuritySettingsActions; onRefresh?: () => void }) {
  const { data, actions, onRefresh } = props
  const approval = describePluginApproval(data?.pluginApproval)
  const storage = describeSecretStorage(data?.secretStorage)
  const workgroup = describeWorkgroupSize(data?.maxWorkgroupSize)
  const secrets = data?.secrets || []
  const external = data?.external

  return h('div', { className: 'cy9-set-main' },
    h(SettingsCard, { title: '安全策略', note: '审批与外部权限来自真实运行时配置。面板读不到的策略一律显示「未知」，不会替配置显示成最安全的一档。' },
      h(SettingsRow, {
        title: '第三方插件安装', desc: approval.desc,
        side: [
          h(StatusPill, { key: 'state', tone: approval.tone, label: approval.label }),
          h(SelectField, {
            key: 'mode', value: approval.known ? approval.mode : '',
            options: (approval.known ? [] : [{ value: '', label: UNKNOWN }]).concat([
              { value: 'always', label: '每次需要审批' }, { value: 'preapproved', label: '按预批准清单' }, { value: 'none', label: '只登记不安装' },
            ]),
            onChange: actions?.setPluginApprovalMode ? ((value: string) => actions.setPluginApprovalMode!(value)) : undefined,
            hint: '当前运行时未提供审批策略写入能力', onDone: () => onRefresh?.(),
          }),
        ],
      }),
      h(SettingsRow, {
        title: 'Shell',
        desc: data?.shellPolicy || '本插件自身不起进程：安装与命令通过运行时已注册工具执行，权限由 DSH 决定。',
        side: h(StatusPill, { tone: 'info', label: '不自起进程' }),
      }),
      h(SettingsRow, {
        title: '外部通讯',
        desc: external
          ? [`已接入渠道 ${countText(external.channels)} 个${typeof external.connected === 'number' ? `（已连接 ${external.connected}）` : ''}`, `默认档位 ${external.defaultPermission || UNKNOWN}`, typeof external.allowUnknownUsers === 'boolean' ? (external.allowUnknownUsers ? '允许名单外用户' : '拒绝名单外用户') : `名单外用户 ${UNKNOWN}`].join(' · ')
          : '面板没有拿到外部通讯配置，渠道数量、默认权限档位与名单策略都未知。',
        side: h(StatusPill, { tone: external ? 'info' : 'off', label: external ? '根据渠道权限' : UNKNOWN }),
      }),
      h(SettingsRow, {
        title: '动态工作组',
        desc: '外部消息不会先交给秘书。Work Orchestrator 按任务自动选人，明确 @ 优先，同事可动态邀请；人数上限用于限制单轮协作规模。',
        side: [
          h(StatusPill, { key: 'state', tone: workgroup.tone, label: workgroup.label }),
          h(SelectField, {
            key: 'size', value: workgroup.known ? workgroup.value : '',
            options: (workgroup.known ? [] : [{ value: '', label: UNKNOWN }]).concat([1, 2, 3, 4].map((value) => ({ value: String(value), label: `最多 ${value} 人` }))),
            onChange: actions?.setMaxWorkgroupSize ? ((value: string) => actions.setMaxWorkgroupSize!(Number(value))) : undefined,
            hint: '当前运行时未提供工作组上限写入能力；按各渠道 routing.maxWorkgroupSize 配置。', onDone: () => onRefresh?.(),
          }),
        ],
      }),
      h(SettingsRow, { title: '模型 API Key', desc: storage.desc, side: h(StatusPill, { tone: storage.tone, label: storage.label, title: storage.warning }) }),
      storage.warning ? h('div', { className: 'cy9-set-banner' }, storage.warning.split('\n').map((line, index) => h('div', { key: index }, line))) : null,
    ),
    h(SettingsCard, {
      title: '密钥清单',
      meta: data?.secrets ? (secrets.length ? `${secrets.length} 个引用 · 已生效 ${secrets.filter((item) => item.configured).length}` : '暂无') : '未读取',
      note: '这里只列出有哪些引用、来自哪里、是否取到值；完整密钥永远不会离开 host。',
    },
      secrets.length
        ? secrets.map((secret) => h(SettingsRow, {
          key: `${secret.ref}-${secret.usedBy || ''}`, title: h('span', { className: 'cy9-set-mono' }, secret.ref),
          desc: [secret.usedBy ? `使用方 ${secret.usedBy}` : '', secret.source ? `来源 ${secret.source}` : ''].filter(Boolean).join(' · ') || DASH,
          side: h(StatusPill, { tone: secret.configured ? 'ok' : 'bad', label: secret.configured ? (secret.masked || '已配置') : '未取到值', title: '只显示掩码' }),
        }))
        : h(Empty, { text: data?.secrets ? '暂无密钥引用。配置模型或通讯渠道后会出现在这里。' : '面板没有拿到密钥引用清单，这里既不表示没有密钥，也不表示都没配。' }),
    ),
  )
}
