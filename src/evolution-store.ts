// 兼容层：EvolutionStore 的真实实现已经拆到 src/persistence/*（types / evolution-store / migrations / company-store）。
// 保留本文件只为不破坏 host-v2.ts 等既有 import 路径，V1 时代导出的类型与 API 全部原样可用。
// 新代码请直接引用 ./persistence/types 与 ./persistence/evolution-store。
export * from './persistence/types'
export * from './persistence/evolution-store'
