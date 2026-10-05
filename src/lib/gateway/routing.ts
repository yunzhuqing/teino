import type { ApiType } from "../db/schema";

/**
 * 路由核心（纯函数，无 IO，便于测试）
 *
 * 规则：
 * 1. 候选 = 模型名匹配 + 模型启用 + 供应商启用 + 供应商支持该模型的上游协议
 *    （模型声明了 apiType 时按声明的协议校验并在必要时转换；否则沿用请求协议）
 * 2. 标签约束：
 *    - 调用方标签 = API Key 标签 ∪ 用户标签。若非空，候选的 (供应商标签 ∪ 模型标签)
 *      必须与之存在交集；调用方无标签则不受限制。
 *    - 请求头 X-Gateway-Tags 指定的标签：候选必须全部包含（AND），用于进一步收窄。
 * 3. 按 priority 降序分层；高优先级层全部失败后才降级到下一层。
 * 4. 层内按 weight 加权随机排序（无放回），第一个即按流量配比选中的上游，
 *    后续用于故障转移。weight = 0 的候选仅作为该层的兜底。
 */

export interface RouteCandidate {
  modelId: string;
  modelName: string;
  upstreamModel: string;
  /** 模型声明的上游协议；null 表示沿用请求协议 */
  modelApiType: ApiType | null;
  priority: number;
  weight: number;
  modelEnabled: boolean;
  modelTagIds: readonly string[];
  provider: {
    id: string;
    name: string;
    enabled: boolean;
    apiTypes: readonly ApiType[];
    tagIds: readonly string[];
  };
}

export interface RouteRequest {
  model: string;
  apiType: ApiType;
  /** API Key ∪ 用户 的标签 */
  callerTagIds: readonly string[];
  /** 请求头要求的标签（已解析为 id）；包含未知标签时应传入无法匹配的值 */
  requiredTagIds?: readonly string[];
}

export type RandomFn = () => number;

/** 该候选实际调用上游时使用的协议 */
export function upstreamApiType(c: Pick<RouteCandidate, "modelApiType">, requestApiType: ApiType): ApiType {
  return c.modelApiType ?? requestApiType;
}

export function filterCandidates<T extends RouteCandidate>(candidates: readonly T[], req: RouteRequest): T[] {
  const caller = new Set(req.callerTagIds);
  const required = req.requiredTagIds ?? [];

  return candidates.filter((c) => {
    if (c.modelName !== req.model || !c.modelEnabled) return false;
    if (!c.provider.enabled || !c.provider.apiTypes.includes(upstreamApiType(c, req.apiType))) return false;

    if (caller.size === 0 && required.length === 0) return true;
    const tags = new Set([...c.provider.tagIds, ...c.modelTagIds]);
    if (caller.size > 0 && !req.callerTagIds.some((t) => tags.has(t))) return false;
    return required.every((t) => tags.has(t));
  });
}

/** 加权随机排序（无放回），weight<=0 的排在最后并保持原序 */
export function weightedShuffle<T extends { weight: number }>(items: readonly T[], random: RandomFn = Math.random): T[] {
  const pool = items.filter((i) => i.weight > 0);
  const zero = items.filter((i) => i.weight <= 0);
  const out: T[] = [];
  let total = pool.reduce((s, i) => s + i.weight, 0);

  while (pool.length > 0) {
    let r = random() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r < 0) {
        idx = i;
        break;
      }
    }
    const [picked] = pool.splice(idx, 1);
    total -= picked.weight;
    out.push(picked);
  }
  return out.concat(zero);
}

export interface PriorityTier<T> {
  priority: number;
  items: T[];
}

export function groupByPriority<T extends { priority: number }>(items: readonly T[]): PriorityTier<T>[] {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const list = map.get(item.priority);
    if (list) list.push(item);
    else map.set(item.priority, [item]);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([priority, list]) => ({ priority, items: list }));
}

/** 返回按尝试顺序排列的上游列表 */
export function planRoute<T extends RouteCandidate>(
  candidates: readonly T[],
  req: RouteRequest,
  random: RandomFn = Math.random,
): T[] {
  return groupByPriority(filterCandidates(candidates, req)).flatMap((tier) => weightedShuffle(tier.items, random));
}

/** 计算每个候选在其优先级层内的流量占比（0~1），用于界面展示 */
export function trafficShares<T extends { priority: number; weight: number }>(items: readonly T[]): Map<T, number> {
  const shares = new Map<T, number>();
  for (const tier of groupByPriority(items)) {
    const total = tier.items.reduce((s, i) => s + Math.max(0, i.weight), 0);
    for (const i of tier.items) shares.set(i, total > 0 ? Math.max(0, i.weight) / total : 0);
  }
  return shares;
}
