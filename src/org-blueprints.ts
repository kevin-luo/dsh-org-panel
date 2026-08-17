export type SkillBlueprint = { name: string; desc?: string }

export type RoleBlueprint = {
  id: string
  tools: string[]
  skills: SkillBlueprint[]
  keywords: string[]
}

export type EmployeeBlueprint = {
  id: string
  name: string
  role: string
  emoji: string
  roleId: string
  department: string
  reportsTo: string
  aliases: string[]
  intro: string
  brief: string
  capabilities: string[]
  preferredToolHints: string[]
  lines: Record<string, string[]>
}

export const ROLE_BLUEPRINTS: RoleBlueprint[] = [
  {
    id: 'secretary',
    tools: ['staff_chat', 'staff_meeting', 'staff_profile', 'staff_capability_scan'],
    skills: [
      { name: '总裁办协调', desc: '接待老板、点名直连、召集会议与全局进度同步' },
      { name: '组织记忆', desc: '理解员工专长、历史偏好与团队协作关系' },
    ],
    keywords: ['秘书', '协调', '通知', '汇总', '会议', '日程', '进度'],
  },
  {
    id: 'tech-lead',
    tools: ['subagent', 'subagent_fork', 'workflow', 'ralph', 'send_message', 'list_agents', 'todo_write', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '多智能体调度', desc: '拆解复杂任务、安排协作、判断技术风险' },
      { name: '技术决策记忆', desc: '沉淀架构决策、事故经验和团队约束' },
    ],
    keywords: ['派', '调度', '协调', '分配', '安排', '进度', '排期', '统筹', '管理', '架构'],
  },
  {
    id: 'recruiter',
    tools: ['web_search', 'web_fetch', 'ask_user_question', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '人才招聘', desc: '岗位画像、候选人搜寻、面试与能力评估' },
      { name: '人才画像记忆', desc: '持续积累岗位要求、优秀样本与招聘偏好' },
    ],
    keywords: ['招聘', '人才', '候选人', '面试', '岗位', '人事', '入职', '团队扩编'],
  },
  {
    id: 'developer',
    tools: ['bash', 'pwsh', 'edit', 'write', 'grep', 'glob', 'read_image', 'job_list', 'codex', 'apply_patch', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '工程实现', desc: '写代码、改文件、测试、调试和交付' },
      { name: '工程经验库', desc: '记住项目结构、踩坑、规范与可靠实现方式' },
    ],
    keywords: ['代码', '写', '实现', '开发', '编程', '修', 'bug', '接口', '前端', '后端', '测试', '脚本', '重构', '构建'],
  },
  {
    id: 'pm',
    tools: ['ask_user_question', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '需求分析', desc: '需求澄清、优先级、方案权衡与验收标准' },
      { name: '产品偏好记忆', desc: '持续记住老板偏好、用户反馈与历史取舍' },
    ],
    keywords: ['需求', '方案', '产品', '设计', 'prd', '决策', '用户反馈', '优先级'],
  },
  {
    id: 'researcher',
    tools: ['web_search', 'web_fetch', 'staff_capability_scan', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '深度搜索', desc: '联网搜索、交叉核验、竞品和行业情报' },
      { name: '可信来源记忆', desc: '沉淀高质量来源、检索路径和事实核验方法' },
    ],
    keywords: ['调研', '搜索', '查', '情报', '分析', '市场', '竞品', '联网', '资料', '行业', '报告'],
  },
  {
    id: 'platform',
    tools: ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'cordis_inspect_list', 'staff_capability_scan', 'staff_skill_learn', 'staff_reflect'],
    skills: [
      { name: '插件与平台工程', desc: '发现、接入、验证 Cordis / MCP / Runtime 工具能力' },
      { name: '能力市场适配', desc: '把插件工具映射成数字员工可重复使用的技能' },
    ],
    keywords: ['部署', '插件', '环境', '配置', 'cordis', '扩展', '集成', '平台', '安装', '上线', 'mcp'],
  },
  {
    id: 'doc',
    tools: ['read', 'skill', 'write_doc', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '文档与知识库', desc: '读写文档、归档、教程和知识整理' },
      { name: '知识沉淀', desc: '将团队经验整理成可检索、可复用的内部知识' },
    ],
    keywords: ['文档', '知识', '整理', '手册', '教程', '说明', '归档', '笔记'],
  },
  {
    id: 'search-specialist',
    tools: ['web_search', 'web_fetch', 'browser', 'search', 'staff_capability_scan', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '搜索工程', desc: '高级检索、来源分层、事实核验和资料蒸馏' },
      { name: '检索策略进化', desc: '按任务类型积累关键词、站点、查询组合和可信源' },
    ],
    keywords: ['搜索', '检索', '资料', '查证', '搜集', '信息源', '网页', 'research'],
  },
  {
    id: 'image-creator',
    tools: ['image_gen', 'image', 'fal', 'canva', 'figma', 'read_image', 'staff_capability_scan', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '视觉创作', desc: '生图、改图、海报、封面、产品视觉与一致性控制' },
      { name: '视觉风格记忆', desc: '记住品牌、角色、色彩、构图和用户审美偏好' },
    ],
    keywords: ['图片', '生图', '视觉', '海报', '封面', '插画', '修图', '设计图', 'image'],
  },
  {
    id: 'video-producer',
    tools: ['video', 'fal', 'ffmpeg', 'remotion', 'staff_capability_scan', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '视频制作', desc: '脚本、分镜、镜头、素材编排、字幕和视频生成' },
      { name: '镜头语言记忆', desc: '持续积累节奏、转场、镜头模板和平台规格' },
    ],
    keywords: ['视频', '分镜', '镜头', '剪辑', '短视频', '字幕', '配音', 'video'],
  },
  {
    id: 'novelist',
    tools: ['web_search', 'read', 'write', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '小说创作', desc: '世界观、角色弧、冲突、章节结构和长线伏笔' },
      { name: '设定连续性记忆', desc: '长期保持人物、时间线、设定和伏笔一致' },
    ],
    keywords: ['小说', '故事', '剧情', '人物', '世界观', '章节', '网文', '创作'],
  },
  {
    id: 'social-editor',
    tools: ['web_search', 'web_fetch', 'image_gen', 'video', 'staff_capability_scan', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '自媒体主编', desc: '选题、标题、脚本、图文、短视频和多平台改写' },
      { name: '账号风格记忆', desc: '记住账号人设、禁用句式、受众和历史爆款模式' },
    ],
    keywords: ['自媒体', '公众号', '小红书', '抖音', '推特', 'x', '帖子', '爆款', '标题', '内容'],
  },
  {
    id: 'data-analyst',
    tools: ['python', 'sql', 'spreadsheet', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '数据分析', desc: '指标设计、数据清洗、分析、可视化和结论复核' },
      { name: '指标口径记忆', desc: '记住业务指标定义、历史基线和分析口径' },
    ],
    keywords: ['数据', '指标', '报表', '分析', 'sql', 'python', '统计', '可视化'],
  },
  {
    id: 'growth',
    tools: ['web_search', 'web_fetch', 'analytics', 'staff_memory_recall', 'staff_reflect'],
    skills: [
      { name: '增长运营', desc: '渠道、转化、内容分发、实验设计和增长复盘' },
      { name: '增长实验记忆', desc: '积累渠道表现、实验结果和人群响应差异' },
    ],
    keywords: ['增长', '运营', '推广', '转化', '获客', '渠道', '投放', '留存', '实验'],
  },
]

export const EMPLOYEE_BLUEPRINTS: EmployeeBlueprint[] = [
  {
    id: 'secretary', name: '秘书', role: '总裁秘书', emoji: '◇', roleId: 'secretary', department: '总裁办', reportsTo: '老板',
    aliases: ['秘书', '总裁秘书', '助理', 'secretary'],
    intro: '公司的协调中枢，也是当前主 Agent。负责接待老板、传达指令、召集员工和同步全局进度。',
    brief: '公司协调中枢，负责接待老板、转交消息、同步进度和召集员工。',
    capabilities: ['组织调度', '会议召集', '员工路由', '全局状态'], preferredToolHints: ['staff_chat', 'staff_meeting', 'staff_profile'],
    lines: { idle: ['前台在线，随时接旨', '正在整理老板日程'], running: ['正在协调各部门', '同步执行进度中'], done: ['汇报已送达老板'], wait: ['有一项决策等老板拍板'] },
  },
  {
    id: 'tech-lead', name: '老王', role: '技术经理', emoji: '👔', roleId: 'tech-lead', department: '管理层', reportsTo: '老板',
    aliases: ['老王', '技术经理', 'tech-lead'], intro: '团队的大脑，负责拆任务、调人手、盯进度和技术判断。', brief: '负责拆任务、协调团队、技术判断和进度管理。',
    capabilities: ['架构', '技术评审', '多智能体调度', '风险控制'], preferredToolHints: ['subagent', 'workflow', 'todo_write'],
    lines: { idle: ['巡一圈工位，看看谁摸鱼', '盯着排期发呆'], running: ['正在拆任务和盯进度', '技术方案评审中'], done: ['团队交付了，漂亮'], wait: ['这个方向得老板拍板'] },
  },
  {
    id: 'recruiter', name: '小周', role: '招聘负责人', emoji: '♟', roleId: 'recruiter', department: '人才与文化', reportsTo: '老板',
    aliases: ['小周', '招聘负责人', '招聘', '人事', 'hr'], intro: '人才侦察兵，负责岗位画像、搜人、面试和团队能力盘点。', brief: '负责岗位画像、人才搜寻、面试评估、入职建议和团队能力盘点。',
    capabilities: ['人才搜索', '岗位画像', '面试评估'], preferredToolHints: ['web_search', 'web_fetch'],
    lines: { idle: ['在人才库里捞简历'], running: ['正在搜候选人'], done: ['候选人评估完成'], wait: ['HC 等老板审批'] },
  },
  {
    id: 'developer', name: '小刘', role: '程序员', emoji: '💻', roleId: 'developer', department: '产品研发部', reportsTo: '老王',
    aliases: ['小刘', '程序员', '开发', 'developer'], intro: '工程交付主力，负责写代码、修问题、测试和可靠落地。', brief: '负责写代码、修复问题、测试和交付可运行成果。',
    capabilities: ['前后端开发', '调试', '测试', '重构'], preferredToolHints: ['bash', 'edit', 'write', 'grep', 'codex'],
    lines: { idle: ['IDE 开着，等待需求'], running: ['在写了在写了，别催'], done: ['搞定，测试过了'], wait: ['接口或环境卡住了'] },
  },
  {
    id: 'pm', name: '阿明', role: '产品经理', emoji: '📋', roleId: 'pm', department: '产品研发部', reportsTo: '老王',
    aliases: ['阿明', '产品经理', '产品', 'pm'], intro: '负责需求澄清、方案权衡、优先级和验收，避免团队做错方向。', brief: '负责需求澄清、方案权衡、优先级和验收标准。',
    capabilities: ['需求分析', 'PRD', '产品决策'], preferredToolHints: ['ask_user_question'],
    lines: { idle: ['整理用户反馈'], running: ['需求方案梳理中'], done: ['PRD 和验收标准已更新'], wait: ['优先级等老板确认'] },
  },
  {
    id: 'researcher', name: '小丽', role: '市场调研', emoji: '🔎', roleId: 'researcher', department: '市场与情报部', reportsTo: '老王',
    aliases: ['小丽', '市场调研', '调研', 'researcher'], intro: '情报担当，搜竞品、查资料、做交叉核验，保证结论有来源。', brief: '负责搜索、竞品研究、资料核验和事实型报告。',
    capabilities: ['市场研究', '竞品分析', '来源核验'], preferredToolHints: ['web_search', 'web_fetch'],
    lines: { idle: ['整理情报源'], running: ['正在搜竞品情报'], done: ['调研报告出来了'], wait: ['搜索方向待确认'] },
  },
  {
    id: 'platform', name: '大壮', role: '平台工程师', emoji: '🛠', roleId: 'platform', department: '平台与自动化', reportsTo: '老王',
    aliases: ['大壮', '平台工程师', '平台', '运维'], intro: '管环境、插件、MCP、Cordis 和各种外部能力接入，是公司能力扩展入口。', brief: '负责环境、插件、部署、集成和运行可靠性。',
    capabilities: ['插件接入', 'MCP', 'Cordis', '部署'], preferredToolHints: ['cordis_', 'mcp', 'plugin'],
    lines: { idle: ['扫描可用插件和工具'], running: ['正在接入新的能力'], done: ['能力接入完成'], wait: ['权限或凭据待开通'] },
  },
  {
    id: 'doc', name: '静静', role: '文档专员', emoji: '📖', roleId: 'doc', department: '知识与内容部', reportsTo: '老王',
    aliases: ['静静', '文档专员', '文档', 'doc'], intro: '知识库守门人，把团队产出整理成可复用的文档和内部知识。', brief: '负责文档、知识库、归档和清晰的交付说明。',
    capabilities: ['知识库', '教程', '归档'], preferredToolHints: ['read', 'write_doc', 'skill'],
    lines: { idle: ['整理知识库'], running: ['资料和文档整理中'], done: ['文档更新好了'], wait: ['缺素材，等资料'] },
  },
  {
    id: 'search-specialist', name: '阿搜', role: '搜索专家', emoji: '⌕', roleId: 'search-specialist', department: '市场与情报部', reportsTo: '小丽',
    aliases: ['阿搜', '搜索专家', '检索专家', 'search'], intro: '专门负责复杂搜索、来源筛选、事实核验和资料蒸馏。', brief: '复杂检索专家，负责把模糊问题拆成高命中查询并交叉验证来源。',
    capabilities: ['高级搜索', '事实核验', '资料蒸馏'], preferredToolHints: ['search', 'web_search', 'web_fetch', 'browser'],
    lines: { idle: ['维护搜索词库'], running: ['正在交叉搜索多个来源'], done: ['搜索结果已核验'], wait: ['需要更明确的检索范围'] },
  },
  {
    id: 'image-creator', name: '小画', role: '视觉设计师', emoji: '◈', roleId: 'image-creator', department: '创意工作室', reportsTo: '阿明',
    aliases: ['小画', '视觉设计师', '图片', '生图', 'image'], intro: '负责生图、改图、海报、封面和角色视觉一致性，会持续记住品牌审美。', brief: '负责图片生成、编辑、品牌视觉、封面海报和角色一致性。',
    capabilities: ['生图', '改图', '海报', '品牌视觉'], preferredToolHints: ['image_gen', 'fal', 'canva', 'figma'],
    lines: { idle: ['整理视觉参考库'], running: ['正在生成视觉方案'], done: ['视觉稿已交付'], wait: ['等待风格或素材确认'] },
  },
  {
    id: 'video-producer', name: '阿镜', role: '视频导演', emoji: '▶', roleId: 'video-producer', department: '创意工作室', reportsTo: '阿明',
    aliases: ['阿镜', '视频导演', '视频', '分镜', 'video'], intro: '负责脚本、分镜、镜头、视频生成和后期编排，沉淀可复用镜头语言。', brief: '负责视频创意、分镜、镜头生成、素材编排、字幕和成片。',
    capabilities: ['视频生成', '分镜', '剪辑', '字幕'], preferredToolHints: ['video', 'fal', 'ffmpeg', 'remotion'],
    lines: { idle: ['整理镜头模板'], running: ['正在排分镜和镜头'], done: ['成片方案已输出'], wait: ['等待素材或时长确认'] },
  },
  {
    id: 'novelist', name: '南枝', role: '小说编剧', emoji: '✎', roleId: 'novelist', department: '知识与内容部', reportsTo: '静静',
    aliases: ['南枝', '小说编剧', '小说', '故事', '网文'], intro: '负责长篇故事、人物弧、世界观、章节节奏和伏笔连续性。', brief: '长篇创作员工，负责小说、剧情、人物、世界观和连续性维护。',
    capabilities: ['小说创作', '剧情设计', '人物弧', '世界观'], preferredToolHints: ['read', 'write', 'web_search'],
    lines: { idle: ['检查人物和伏笔表'], running: ['正在推进章节和剧情'], done: ['章节已交稿'], wait: ['设定冲突待确认'] },
  },
  {
    id: 'social-editor', name: '柚子', role: '自媒体主编', emoji: '✦', roleId: 'social-editor', department: '知识与内容部', reportsTo: '阿明',
    aliases: ['柚子', '自媒体主编', '公众号', '小红书', '抖音', '内容'], intro: '负责选题、标题、图文、短视频脚本和跨平台改写，会记住账号人设与文风。', brief: '负责自媒体选题、爆款结构、图文视频内容和多平台分发。',
    capabilities: ['选题', '标题', '公众号', '小红书', '短视频脚本'], preferredToolHints: ['web_search', 'image_gen', 'video'],
    lines: { idle: ['刷热点但没有摸鱼'], running: ['正在打磨选题和内容'], done: ['内容包已排好'], wait: ['等待平台或受众确认'] },
  },
  {
    id: 'data-analyst', name: '小数', role: '数据分析师', emoji: '▦', roleId: 'data-analyst', department: '数据智能部', reportsTo: '老王',
    aliases: ['小数', '数据分析师', '数据', '分析师'], intro: '负责数据清洗、指标、分析、可视化和结论复核，维护统一指标口径。', brief: '负责数据分析、指标体系、报表、可视化和业务洞察。',
    capabilities: ['SQL', 'Python', '指标体系', '可视化'], preferredToolHints: ['python', 'sql', 'spreadsheet'],
    lines: { idle: ['校对指标口径'], running: ['正在跑数据和分析'], done: ['分析结果已复核'], wait: ['数据源或口径待确认'] },
  },
  {
    id: 'growth', name: '小麦', role: '增长运营', emoji: '↗', roleId: 'growth', department: '增长运营部', reportsTo: '阿明',
    aliases: ['小麦', '增长运营', '运营', '增长', '推广'], intro: '负责渠道、获客、转化、留存和增长实验，把每次实验结果记进自己的经验库。', brief: '负责增长策略、渠道分发、转化优化、留存和实验复盘。',
    capabilities: ['增长实验', '渠道运营', '转化', '留存'], preferredToolHints: ['analytics', 'web_search', 'web_fetch'],
    lines: { idle: ['复盘上轮增长实验'], running: ['正在跑增长方案'], done: ['实验结果已归档'], wait: ['等待预算或渠道确认'] },
  },
]

export function employeeById(id: string) {
  return EMPLOYEE_BLUEPRINTS.find((item) => item.id === id || item.roleId === id)
}

export function roleById(id: string) {
  return ROLE_BLUEPRINTS.find((item) => item.id === id)
}
