// Node host entry v3: self-evolving employees + real DSH community plugin discovery.
import { apply as applyCore, inject as coreInject } from './host-v2'
import { registerCommunityMarket } from './community-market'

export const inject = coreInject

export function apply(ctx: any, config?: any) {
  applyCore(ctx, config)
  registerCommunityMarket(ctx)
}
