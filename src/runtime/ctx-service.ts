// cordis Context 上「可选宿主能力」的安全读取口（本轮 T0 的根因修复）。
//
// 背景（实测，不是推断）：cordis 4 的 Context 是带 inject 校验的 Proxy。
//   - 读一个没在 inject 数组里声明过的自定义属性 → 抛 `cannot get property "x" without inject`
//   - 写一个没 provide 过的自定义属性       → 抛 `cannot set property "x" in multiple fibers`
// 而本项目对若干宿主能力做的是「有就用、没有就如实降级」的探测（secrets / approvals / …），
// 这些能力不能进 `export const inject`：Inject.resolve 把数组每一项都当**必需**依赖，
// 没有 optional 形式，声明了就等于把整个插件绑死在一个可能根本不存在的服务上。
//
// 所以统一走这里：
//   1. 优先用 cordis 自己的 `get`（源码注释明写「Read a service from the store without the
//      inject requirement」），它对未提供的服务返回 undefined，不抛；
//   2. 再回落到裸属性读，并吞掉 Proxy 抛出的异常 —— 非 cordis 宿主与单测传的是普通对象，
//      那条路必须继续有效（既有用例依赖它）。
//
// 结论只有两种：拿到真实服务，或者 undefined。绝不为了「好看」编造一个空实现。

/** 安全读取 ctx 上的一个可选服务；读不到就是 undefined，不抛异常。 */
export function readCtxService<T = any>(ctx: any, name: string): T | undefined {
  if (!ctx || !name) return undefined
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get(name) : undefined
    if (viaGet !== undefined && viaGet !== null) return viaGet as T
  } catch { /* 宿主的 get 不认这个名字：继续回落到裸属性 */ }
  try {
    const value = ctx[name]
    return value === null || value === undefined ? undefined : (value as T)
  } catch { return undefined }
}

/** 按顺序探测多个候选服务名，返回第一个真实存在的。全都没有就返回 undefined。 */
export function firstCtxService<T = any>(ctx: any, names: readonly string[]): T | undefined {
  for (const name of names) {
    const value = readCtxService<T>(ctx, name)
    if (value !== undefined) return value
  }
  return undefined
}
