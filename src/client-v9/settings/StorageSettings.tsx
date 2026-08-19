// 公司设置 → 存储（需求文档四十二）。
// 展示真实数据目录、记忆条数、履历条数、附件缓存，并支持导出 / 导入备份。
// 备份默认不含 Secret：勾选「包含 Secret」才会带上，且必须二次确认。
import { createElement as h, useState } from 'react'
import { ActionButton, DASH, Empty, KeyValues, SettingsCard, SettingsRow, countText, formatBytes, formatDateTime } from './styles'

/** error = host 读这个文件时真的报错了（权限等）。有 error 时绝不显示成「尚未创建」。 */
export type StorageFileRow = { label: string; path: string; bytes?: number; updatedAt?: number; exists?: boolean; error?: string }

export type StorageSettingsData = {
  /** 数据根目录，默认 ~/.dsh-org-panel/。 */
  dataDir?: string
  files?: StorageFileRow[]
  employees?: number
  memories?: number
  tasks?: number
  skills?: number
  evidence?: number
  reflections?: number
  attachments?: { dir?: string; count?: number; bytes?: number }
  /** 密钥库路径；只显示路径，绝不显示内容。 */
  secretsFile?: string
  lastBackupAt?: number
  loaded?: boolean
}

export type StorageSettingsActions = {
  openDir?(path?: string): unknown | Promise<unknown>
  exportBackup?(options: { includeSecrets: boolean }): unknown | Promise<unknown>
  importBackup?(input: { file?: File; path?: string }): unknown | Promise<unknown>
}

async function copyText(text: string): Promise<string> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('当前环境不支持剪贴板')
  await navigator.clipboard.writeText(text)
  return '已复制路径'
}

export function StorageSettings(props: { data?: StorageSettingsData; actions?: StorageSettingsActions; onRefresh?: () => void }) {
  const { data, actions, onRefresh } = props
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [path, setPath] = useState('')
  const dataDir = data?.dataDir || ''

  return h('div', { className: 'cy9-set-main' },
    h(SettingsCard, {
      title: '员工数据',
      meta: dataDir || '路径未知',
      actions: [
        h(ActionButton, {
          key: 'open', label: '打开目录',
          run: actions?.openDir ? (() => actions.openDir!(dataDir || undefined)) : undefined,
          hint: '当前运行时未提供打开目录能力（浏览器侧无法直接打开本机目录）',
        }),
        h(ActionButton, {
          key: 'copy', label: '复制路径',
          run: dataDir ? (() => copyText(dataDir)) : undefined,
          hint: '尚未读到数据目录路径',
        }),
      ],
      note: '所有员工身份、记忆、履历、技能证据、插件绑定与模型绑定都落在这个目录里；删掉它等于把公司清空。',
    },
      h(KeyValues, {
        items: [
          { label: '数据目录', value: dataDir || DASH, mono: true },
          { label: '员工', value: countText(data?.employees, ' 人') },
          { label: '长期记忆', value: countText(data?.memories, ' 条') },
          { label: '任务履历', value: countText(data?.tasks, ' 条') },
          { label: '技能', value: countText(data?.skills, ' 项') },
          { label: '技能证据', value: countText(data?.evidence, ' 条') },
          { label: '复盘', value: countText(data?.reflections, ' 条') },
          { label: '附件缓存', value: `${formatBytes(data?.attachments?.bytes)}${typeof data?.attachments?.count === 'number' ? ` · ${data.attachments.count} 个` : ''}` },
        ],
      }),
    ),
    h(SettingsCard, { title: '数据文件', meta: data?.files?.length ? `${data.files.length} 个` : '暂无' },
      data?.files?.length
        ? data.files.map((row) => h(SettingsRow, {
          key: row.path,
          title: row.label,
          desc: row.error
            ? `${row.path} · 读取失败：${row.error}`
            : `${row.path} · ${row.exists === false ? '尚未创建' : formatBytes(row.bytes)} · 更新 ${formatDateTime(row.updatedAt)}`,
          side: h(ActionButton, { label: '复制路径', run: () => copyText(row.path) }),
        }))
        : h(Empty, { text: '尚未读到数据文件信息。' }),
      data?.secretsFile
        ? h(SettingsRow, { title: '本地密钥库', desc: `${data.secretsFile} · 内容加密存储，前端永远不读取`, side: h(ActionButton, { label: '复制路径', run: () => copyText(data.secretsFile!) }) })
        : null,
    ),
    h(SettingsCard, {
      title: '备份',
      meta: data?.lastBackupAt ? `最近备份 ${formatDateTime(data.lastBackupAt)}` : '尚无备份记录',
      note: 'company-backup.zip 默认只包含员工数据与公司配置，不包含任何 Secret；勾选包含 Secret 后请自行保管好这个文件。',
    },
      h(SettingsRow, {
        title: '导出备份',
        desc: '导出 evolution.json / company.json / 审批记录等真实数据。',
        side: [
          h('label', { key: 'opt', className: 'cy9-set-field' },
            h('input', { type: 'checkbox', checked: includeSecrets, onChange: (event: any) => setIncludeSecrets(!!event?.target?.checked) }),
            '包含 Secret（不推荐）',
          ),
          h(ActionButton, {
            key: 'export', label: '导出备份', tone: 'primary', busyLabel: '导出中…',
            confirm: includeSecrets ? '备份将包含解析后的密钥，确认继续？' : undefined,
            run: actions?.exportBackup ? (() => actions.exportBackup!({ includeSecrets })) : undefined,
            hint: '当前运行时未提供备份导出能力', onDone: () => onRefresh?.(),
          }),
        ],
      }),
      h(SettingsRow, {
        title: '导入备份',
        desc: '导入会覆盖同名员工的持久化数据，请先导出一份当前数据。',
        side: [
          h('input', {
            key: 'file', type: 'file', className: 'cy9-set-input', accept: '.zip,.json',
            disabled: !actions?.importBackup,
            onChange: (event: any) => setFile(event?.target?.files?.[0] || null),
          }),
          h('input', {
            key: 'path', className: 'cy9-set-input', value: path, placeholder: '或填写本机备份文件路径',
            disabled: !actions?.importBackup,
            onChange: (event: any) => setPath(String(event?.target?.value ?? '')),
          }),
          h(ActionButton, {
            key: 'import', label: '导入备份', tone: 'danger', busyLabel: '导入中…',
            confirm: '导入会覆盖现有员工数据，确认继续？',
            run: actions?.importBackup && (file || path.trim())
              ? (() => actions.importBackup!({ file: file || undefined, path: path.trim() || undefined }))
              : undefined,
            hint: actions?.importBackup ? '请先选择备份文件或填写路径' : '当前运行时未提供备份导入能力',
            onDone: () => onRefresh?.(),
          }),
        ],
      }),
    ),
  )
}
