// 公司设置 → 安全（需求文档三十 / 三十一 / 三十六 / 四十三）。
// 五件事：第三方插件安装审批、Shell 权限、外部通讯权限、模型 API Key 存储、员工之间自动转交上限。
// 铁律一：密钥清单只显示引用名、来源与掩码，任何情况下都不展示完整值（需求文档三十一 / 五十七）。
// 铁律二（需求文档四十八）：拿不到真实配置就显示「未知」。
//   安全页尤其不许「默认显示成最安全的那一档」——老板真配了 preapproved / executor:auto 时，
//   一个绿色的「每次需要审批」比不显示危险得多。
import { createElement as h } from 'react'
import type { SecretStorageStatus } from '../../models/types'
import { DASH, Empty, SelectField, SettingsCard, SettingsRow, StatusPill, countText, type PillTone } from './styles'

/** 未知 ≠ 没有。面板读不到的东西一律用它，绝不用好看的默认值顶上。 */
export const UNKNOWN = '未知'

export type SecretInventoryRow = {
  ref: string
  source?: string
  configured?: boolean
  masked?: string
  /** 谁在用这个密钥，如「模型 vision-fast」「飞书 appSecret」。 */
  usedBy?: string
}

export type SecuritySettingsData = {
  /**
   * 只有 host 真的下发了审批策略才会有值。undefined = 面板没读到，
   * UI 必须显示「未知」，不许回落成 always（那是在替老板宣称最安全的配置）。
   */
  pluginApproval?: {
    /** always = 每次需要审批；preapproved = 配置里有预批准清单；none = 只登记不安装。 */
    mode?: 'always' | 'preapproved' | 'none'
    preapproved?: string[]
    pendingCount?: number
    /** 安装执行方式：auto / tool 走运行时工具（受 DSH 权限模式约束），none 表示只登记等老板手动装。 */
    executor?: 'auto' | 'tool' | 'none'
  }
  shellPolicy?: string
  external?: { channels?: number; connected?: number; defaultPermission?: string; allowUnknownUsers?: boolean }
  secrets?: SecretInventoryRow[]
  /** 本地密钥库的真实能力标志（SecretVault.status()）。缺席时这里既不打绿标也不说「已加密」。 */
  secretStorage?: SecretStorageStatus | null
  /** 员工之间自动转交上限：只接受 CommunicationManager.summary() 的真实生效值。 */
  maxEmployeeHops?: number
  /** true = 上面那个值只是「一个渠道都没有时」的缺省回落，并不是任何渠道真实生效的上限。 */
  hopsFallback?: boolean
  loaded?: boolean
}

export type SecuritySettingsActions = {
  setPluginApprovalMode?(mode: string): unknown | Promise<unknown>
  setMaxEmployeeHops?(value: number): unknown | Promise<unknown>
}

const APPROVAL_VIEW: Record<string, { tone: PillTone; label: string }> = {
  always: { tone: 'ok', label: '每次需要审批' },
  preapproved: { tone: 'warn', label: '存在预批准清单' },
  none: { tone: 'off', label: '只登记不安装' },
}

export type ApprovalView = { known: boolean; mode: string; tone: PillTone; label: string; desc: string }

/**
 * 插件审批策略的诚实描述。
 * 没拿到策略 = 未知（warn，不是绿标）；拿到了就照抄，并把预批准清单 / 执行方式一起摊开。
 */
export function describePluginApproval(approval?: SecuritySettingsData['pluginApproval']): ApprovalView {
  const unreadable = '面板没有收到运行时下发的 security.pluginApproval：无法判断是否存在预批准清单，也无法判断安装执行方式。真实策略以 cordis 配置里的 pluginInstall 为准。'
  if (!approval || typeof approval !== 'object' || !approval.mode) {
    return { known: false, mode: '', tone: 'warn', label: `${UNKNOWN} · 面板未拿到审批策略`, desc: unreadable }
  }
  const view = APPROVAL_VIEW[approval.mode]
  const preapproved = approval.preapproved
  // 声称 always 却带着预批准清单：以清单为准报警，不替配置圆场。
  const risky = Array.isArray(preapproved) && preapproved.length > 0
  const desc = [
    Array.isArray(preapproved)
      ? (preapproved.length ? `预批准包：${preapproved.join('、')}（这些包不会再问老板）` : '预批准清单为空')
      : `预批准清单 ${UNKNOWN}`,
    typeof approval.pendingCount === 'number' ? `待审批 ${approval.pendingCount} 条` : `待审批 ${UNKNOWN}`,
    approval.executor ? `安装执行方式 ${approval.executor}${approval.executor === 'auto' ? '（批准后自动执行安装命令）' : ''}` : `安装执行方式 ${UNKNOWN}`,
  ].join(' · ')
  if (!view) return { known: false, mode: approval.mode, tone: 'warn', label: `${UNKNOWN}策略 ${approval.mode}`, desc: `运行时下发了面板不认识的审批策略，按未知处理。${desc}` }
  return { known: true, mode: approval.mode, tone: risky ? 'warn' : view.tone, label: risky ? APPROVAL_VIEW.preapproved.label : view.label, desc }
}

export type StorageView = { tone: PillTone; label: string; desc: string; warning?: string }

/**
 * 密钥库能力标志的诚实显示（models/types.ts 的 SecretStorageStatus 就是唯一依据）。
 * 只有「口令加密 + 文件权限确实收紧」才配绿标；混淆存储一律 warn，并原样吐出 warning。
 */
export function describeSecretStorage(status?: SecretStorageStatus | null): StorageView {
  if (!status || typeof status !== 'object' || !status.mode) {
    return {
      tone: 'off',
      label: `${UNKNOWN} · 未拿到密钥库能力标志`,
      desc: '配置里只允许 env: / secret: 引用；解析后的值只留在 host 内存。本地密钥库到底是真加密还是仅本机混淆，面板此刻读不到（能力标志在 host 的 model_status 返回里），因此这里不做任何保护等级声明。',
    }
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
  return {
    // 绿标的唯一条件：真加密 + 权限确实收紧 + host 自己没有附带警告。
    tone: encrypted && ownerOnly && !status.warning ? 'ok' : 'warn',
    label: status.label || status.mode,
    desc,
    warning: status.warning,
  }
}

export type HopsView = { known: boolean; tone: PillTone; label: string; value: string }

/** 转交上限：只认 CommunicationManager.summary() 的真实生效值；缺省回落值必须自报家门。 */
export function describeHops(hops?: number, fallback?: boolean): HopsView {
  if (typeof hops !== 'number' || !Number.isFinite(hops)) {
    return { known: false, tone: 'off', label: UNKNOWN, value: '' }
  }
  if (fallback) return { known: true, tone: 'off', label: `${UNKNOWN}（缺省 ${hops} 次）`, value: String(hops) }
  return { known: true, tone: 'ok', label: `最多 ${hops} 次`, value: String(hops) }
}

export function SecuritySettings(props: { data?: SecuritySettingsData; actions?: SecuritySettingsActions; onRefresh?: () => void }) {
  const { data, actions, onRefresh } = props
  const approval = describePluginApproval(data?.pluginApproval)
  const storage = describeSecretStorage(data?.secretStorage)
  const hops = describeHops(data?.maxEmployeeHops, data?.hopsFallback)
  const secrets = data?.secrets || []
  const external = data?.external

  return h('div', { className: 'cy9-set-main' },
    h(SettingsCard, { title: '安全策略', note: '这些是硬约束，不是提示词：审批只能来自人类点击，插件安装只走运行时真实工具，因此天然受 DSH 权限模式约束。面板读不到的策略一律显示「未知」，不会替配置显示成最安全的那一档。' },
      h(SettingsRow, {
        title: '第三方插件安装',
        desc: approval.desc,
        side: [
          h(StatusPill, { key: 'state', tone: approval.tone, label: approval.label }),
          h(SelectField, {
            key: 'mode', value: approval.known ? approval.mode : '',
            options: (approval.known ? [] : [{ value: '', label: UNKNOWN }]).concat([
              { value: 'always', label: '每次需要审批' },
              { value: 'preapproved', label: '按预批准清单' },
              { value: 'none', label: '只登记不安装' },
            ]),
            onChange: actions?.setPluginApprovalMode ? ((value: string) => actions.setPluginApprovalMode!(value)) : undefined,
            hint: '当前运行时未提供审批策略写入能力（预批准清单写在 cordis 配置里，本身就是人类动作）',
            onDone: () => onRefresh?.(),
          }),
        ],
      }),
      h(SettingsRow, {
        title: 'Shell',
        desc: data?.shellPolicy || '本插件自身不起进程：安装与命令一律通过运行时已注册的工具执行，权限由 DSH 决定。（这是实现约束，不是从配置读来的状态。）',
        side: h(StatusPill, { tone: 'info', label: '不自起进程' }),
      }),
      h(SettingsRow, {
        title: '外部通讯',
        desc: external
          ? [
            `已接入渠道 ${countText(external.channels)} 个${typeof external.connected === 'number' ? `（已连接 ${external.connected}）` : ''}`,
            `默认档位 ${external.defaultPermission || UNKNOWN}`,
            typeof external.allowUnknownUsers === 'boolean' ? (external.allowUnknownUsers ? '允许名单外用户' : '拒绝名单外用户') : `名单外用户 ${UNKNOWN}`,
          ].join(' · ')
          : '面板没有拿到外部通讯配置，渠道数量、默认权限档位与名单策略都未知。真实档位见「公司设置 → 通讯」里各渠道的 access 配置。',
        side: h(StatusPill, { tone: external ? 'info' : 'off', label: external ? '根据渠道权限' : UNKNOWN }),
      }),
      h(SettingsRow, {
        title: '模型 API Key',
        desc: storage.desc,
        side: h(StatusPill, { tone: storage.tone, label: storage.label, title: storage.warning }),
      }),
      // 混淆模式下 host 会带回一段必须原样显示的说明：不改写、不省略、不打绿标。
      storage.warning
        ? h('div', { className: 'cy9-set-banner' }, storage.warning.split('\n').map((line, index) => h('div', { key: index }, line)))
        : null,
      h(SettingsRow, {
        title: '员工之间自动转交',
        desc: [
          '防止员工无限互聊：超过上限后必须回到老板或秘书（需求文档三十六）。',
          hops.known
            ? (data?.hopsFallback
              ? '当前一个外部渠道都没有，这个数只是代码里的缺省回落，不是任何渠道真实生效的上限。'
              : '取自各启用渠道 routing.maxHops 的最大值（CommunicationManager.summary()）。')
            : '面板没有拿到通讯摘要，无法得知真实生效上限。',
          '该上限由外部渠道 Router 执行；Web 工作台内的派活不经过 Router。',
        ].join(' '),
        side: [
          h(StatusPill, { key: 'state', tone: hops.tone, label: hops.label }),
          h(SelectField, {
            key: 'hops', value: hops.known && !data?.hopsFallback ? hops.value : '',
            options: (hops.known && !data?.hopsFallback ? [] : [{ value: '', label: UNKNOWN }]).concat([1, 2, 3, 4, 5, 6, 8].map((value) => ({ value: String(value), label: `最多 ${value} 次` }))),
            onChange: actions?.setMaxEmployeeHops ? ((value: string) => actions.setMaxEmployeeHops!(Number(value))) : undefined,
            hint: '当前运行时未提供转交上限写入能力',
            onDone: () => onRefresh?.(),
          }),
        ],
      }),
    ),
    h(SettingsCard, {
      title: '密钥清单',
      meta: data?.secrets ? (secrets.length ? `${secrets.length} 个引用 · 已生效 ${secrets.filter((item) => item.configured).length}` : '暂无') : '未读取',
      note: '这里只列出「有哪些引用、来自哪里、是否取到值」，完整密钥永远不会离开 host。',
    },
      secrets.length
        ? secrets.map((secret) => h(SettingsRow, {
          key: `${secret.ref}-${secret.usedBy || ''}`,
          title: h('span', { className: 'cy9-set-mono' }, secret.ref),
          desc: [secret.usedBy ? `使用方 ${secret.usedBy}` : '', secret.source ? `来源 ${secret.source}` : ''].filter(Boolean).join(' · ') || DASH,
          side: h(StatusPill, {
            tone: secret.configured ? 'ok' : 'bad',
            label: secret.configured ? (secret.masked || '已配置') : '未取到值',
            title: '只显示掩码',
          }),
        }))
        : h(Empty, { text: data?.secrets ? '暂无密钥引用。配置模型或通讯渠道后会出现在这里。' : '面板没有拿到密钥引用清单（需要 host 下发 CompanySnapshot），这里既不是「没有密钥」也不是「都没配」。' }),
    ),
  )
}
