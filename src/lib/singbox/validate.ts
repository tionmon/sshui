/**
 * Problems sing-box would refuse to start with (errors), or that are probably
 * mistakes or deprecated (warnings/info). `sing-box check` remains the authority;
 * these show up while editing, before a save.
 */
import { allOutbounds, groupsOf, isObj, membersOf, routeRulesOf, ruleSetTags as tagsOfRuleSet, ruleSetsOf, type Obj } from './doc'
import { missingFields } from './protocols'
import { findCycles, findRefs, matcherKeys, type RefSite } from './refs'
import { DOMAIN_MATCHERS, actionOf } from './rules'

export type Level = 'error' | 'warning' | 'info'
export type Tab = 'nodes' | 'groups' | 'rules'

export interface Problem {
  level: Level
  code: string
  params: Record<string, string | number>
  /** Where to fix it */
  tab?: Tab
  tag?: string
  site?: RefSite
}

/** "1.12.4" → [1, 12, 4] */
export const parseVersion = (v: string | null | undefined) => {
  const m = v?.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}
export const versionAtLeast = (v: string | null | undefined, major: number, minor: number) => {
  const p = parseVersion(v)
  return !p || p[0] > major || (p[0] === major && p[1] >= minor)
}

export function validate(doc: Obj, version?: string | null): Problem[] {
  const problems: Problem[] = []
  const push = (level: Level, code: string, params: Problem['params'] = {}, extra: Partial<Problem> = {}) =>
    problems.push({ level, code, params, ...extra })

  const outbounds = allOutbounds(doc)
  const seen = new Map<string, number>()
  for (const o of outbounds) {
    if (o.tagged) seen.set(o.tag, (seen.get(o.tag) ?? 0) + 1)
    else push('warning', 'untagged', { type: o.type || '?', index: o.index }, { tab: 'nodes' })
  }
  for (const [tag, count] of seen) if (count > 1) push('error', 'dupTag', { tag }, { tab: 'nodes', tag })

  const tags = new Set(outbounds.filter((o) => o.tagged).map((o) => o.tag))
  const ruleSetTags = new Set<string>()
  for (const rs of ruleSetsOf(doc)) {
    const entryTags = tagsOfRuleSet(rs)
    if (entryTags.length === 0) push('error', 'ruleSetUntagged', {}, { tab: 'rules' })
    for (const tag of entryTags) {
      if (ruleSetTags.has(tag)) push('error', 'dupRuleSet', { tag }, { tab: 'rules', tag })
      ruleSetTags.add(tag)
    }
    const tag = entryTags.join(', ')
    const first = entryTags[0]
    if (rs.type === 'remote' && !rs.url) push('error', 'ruleSetNoUrl', { tag }, { tab: 'rules', tag: first })
    if (rs.type === 'local' && !rs.path) push('error', 'ruleSetNoPath', { tag }, { tab: 'rules', tag: first })
    // Several tags in one entry only work when the URL or path says where each one goes
    if (entryTags.length > 1 && !String(rs.url ?? rs.path ?? '').includes('{tag}')) {
      push('warning', 'ruleSetNoTemplate', { tag }, { tab: 'rules', tag: first })
    }
  }

  for (const ref of findRefs(doc)) {
    if (ref.site.kind === 'ruleset') {
      if (!ruleSetTags.has(ref.tag)) push('error', 'missingRuleSet', { tag: ref.tag }, { tab: 'rules', site: ref.site })
    } else if (!tags.has(ref.tag)) {
      // DNS rule outbound conditions don't stop sing-box from starting
      push(ref.site.at === 'dnsRule' ? 'warning' : 'error', 'missingOutbound', { tag: ref.tag }, { site: ref.site, tab: tabOf(ref.site) })
    }
  }

  for (const g of groupsOf(doc)) {
    const members = membersOf(g.value)
    if (members.length === 0) push('error', 'emptyGroup', { group: g.tag }, { tab: 'groups', tag: g.tag })
    if (typeof g.value.default === 'string' && g.value.default && !members.includes(g.value.default)) {
      push('error', 'badDefault', { group: g.tag, tag: g.value.default }, { tab: 'groups', tag: g.tag })
    }
  }

  for (const cycle of findCycles(doc)) push('error', 'cycle', { tags: cycle.join(' → ') }, { tab: 'nodes' })

  for (const o of outbounds) {
    const missing = missingFields(o.value)
    if (missing.length) push('error', 'missingFields', { tag: o.tag, fields: missing.join(', ') }, { tab: 'nodes', tag: o.tag })
    if (o.type === 'block' || o.type === 'dns') push('warning', 'deprecatedType', { tag: o.tag, type: o.type }, { tab: 'nodes', tag: o.tag })
    if (o.type === 'wireguard' && o.section === 'outbounds') push('warning', 'legacyWireguard', { tag: o.tag }, { tab: 'nodes', tag: o.tag })
    if (typeof o.value.detour === 'string') {
      const target = outbounds.find((x) => x.tag === o.value.detour)
      if (target && (target.type === 'block' || target.type === 'dns')) {
        push('error', 'badDetour', { tag: o.tag, via: target.tag }, { tab: 'nodes', tag: o.tag })
      }
    }
  }

  const rules = routeRulesOf(doc)
  const flat: Obj[] = []
  const collect = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const r of list) {
      if (!isObj(r)) continue
      flat.push(r)
      if (r.type === 'logical') collect(r.rules)
    }
  }
  collect(rules)
  rules.forEach((r, i) => {
    if (!isObj(r)) return
    if (r.geosite !== undefined || r.geoip !== undefined || r.source_geoip !== undefined) {
      push('warning', 'geoMatcher', { index: i + 1 }, { tab: 'rules' })
    }
    const action = actionOf(r)
    if (action === 'route' && !r.outbound) push('error', 'ruleNoOutbound', { index: i + 1 }, { tab: 'rules' })
    if (r.action && !versionAtLeast(version, 1, 11)) push('error', 'actionsNeedNewer', { index: i + 1, version: version ?? '' }, { tab: 'rules' })
    if (r.type !== 'logical' && matcherKeys(r).length === 0 && action === 'route') {
      push('warning', 'matchesAll', { index: i + 1 }, { tab: 'rules' })
    }
  })

  // Domain rules need the domain: sniffed (1.11+ rule action, or the old inbound flag) or known from DNS
  const usesDomains = flat.some((r) => DOMAIN_MATCHERS.some((k) => r[k] !== undefined) || r.rule_set !== undefined)
  const sniffs =
    flat.some((r) => r.action === 'sniff') ||
    (Array.isArray(doc.inbounds) && doc.inbounds.some((i: unknown) => isObj(i) && i.sniff === true))
  if (usesDomains && !sniffs) push('info', 'noSniff', {}, { tab: 'rules' })

  return problems
}

const tabOf = (site: RefSite): Tab => {
  if (site.at === 'member' || site.at === 'default') return 'groups'
  if (site.at === 'detour') return 'nodes'
  return 'rules'
}
