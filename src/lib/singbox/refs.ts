/**
 * Everything in a config that points at an outbound or rule-set tag, so renames,
 * deletes and replacements keep the config consistent instead of leaving dangling
 * references that sing-box refuses to start with.
 */
import { allOutbounds, groupsOf, isGroupType, isObj, membersOf, ruleSetTags, type Obj, type Path } from './doc'

export type RefKind = 'outbound' | 'ruleset'

export type RefSite =
  | { kind: 'outbound'; at: 'member'; group: string }
  | { kind: 'outbound'; at: 'default'; group: string }
  | { kind: 'outbound'; at: 'detour'; owner: string }
  | { kind: 'outbound'; at: 'rule'; index: number }
  | { kind: 'outbound'; at: 'final' }
  | { kind: 'outbound'; at: 'download'; ruleSet: string }
  | { kind: 'outbound'; at: 'dnsServer'; server: string }
  | { kind: 'outbound'; at: 'dnsRule'; index: number }
  | { kind: 'outbound'; at: 'other'; path: string }
  | { kind: 'ruleset'; at: 'rule'; index: number }
  | { kind: 'ruleset'; at: 'dnsRule'; index: number }

export interface Ref {
  tag: string
  site: RefSite
  /** Location of the referencing string, for renames */
  path: Path
}

/** Keys of a rule that aren't match conditions. Anything else counts as one. */
const NON_MATCHER_KEYS = new Set([
  'type',
  'mode',
  'rules',
  'invert',
  'action',
  'outbound',
  'server',
  'method',
  'no_drop',
  'override_address',
  'override_port',
  'network_strategy',
  'network_type',
  'fallback_network_type',
  'fallback_delay',
  'udp_disable_domain_unmapping',
  'udp_connect',
  'udp_timeout',
  'tls_fragment',
  'tls_fragment_fallback_delay',
  'tls_record_fragment',
  'sniffer',
  'timeout',
  'strategy',
  'disable_cache',
  'rewrite_ttl',
  'client_subnet',
  'rcode',
  'answer',
  'ns',
  'extra',
])

export const matcherKeys = (rule: Obj) => Object.keys(rule).filter((k) => !NON_MATCHER_KEYS.has(k))

/** Visit every rule (logical rules' children included) with its top-level index. */
function walkRules(rules: unknown, base: Path, visit: (rule: Obj, path: Path, top: number) => void, top?: number) {
  if (!Array.isArray(rules)) return
  rules.forEach((rule, i) => {
    if (!isObj(rule)) return
    const path = [...base, i]
    const index = top ?? i
    visit(rule, path, index)
    if (rule.type === 'logical') walkRules(rule.rules, [...path, 'rules'], visit, index)
  })
}

/** All references in the document. */
export function findRefs(doc: Obj): Ref[] {
  const refs: Ref[] = []
  const add = (tag: unknown, site: RefSite, path: Path) => {
    if (typeof tag === 'string' && tag) refs.push({ tag, site, path })
  }
  const addList = (value: unknown, site: RefSite, path: Path) => {
    if (Array.isArray(value)) value.forEach((v, i) => add(v, site, [...path, i]))
    else add(value, site, path)
  }

  for (const o of allOutbounds(doc)) {
    const base: Path = [o.section, o.index]
    if (isGroupType(o.type)) {
      if (Array.isArray(o.value.outbounds)) {
        o.value.outbounds.forEach((m: unknown, i: number) =>
          add(m, { kind: 'outbound', at: 'member', group: o.tag }, [...base, 'outbounds', i]),
        )
      }
      add(o.value.default, { kind: 'outbound', at: 'default', group: o.tag }, [...base, 'default'])
    }
    add(o.value.detour, { kind: 'outbound', at: 'detour', owner: o.tag }, [...base, 'detour'])
  }

  const route = isObj(doc.route) ? doc.route : null
  if (route) {
    walkRules(route.rules, ['route', 'rules'], (rule, path, top) => {
      add(rule.outbound, { kind: 'outbound', at: 'rule', index: top }, [...path, 'outbound'])
      addList(rule.rule_set, { kind: 'ruleset', at: 'rule', index: top }, [...path, 'rule_set'])
    })
    add(route.final, { kind: 'outbound', at: 'final' }, ['route', 'final'])
    if (Array.isArray(route.rule_set)) {
      route.rule_set.forEach((rs: unknown, i: number) => {
        if (isObj(rs)) {
          const name = ruleSetTags(rs).join(', ') || String(i)
          add(rs.download_detour, { kind: 'outbound', at: 'download', ruleSet: name }, ['route', 'rule_set', i, 'download_detour'])
        }
      })
    }
  }

  const dns = isObj(doc.dns) ? doc.dns : null
  if (dns) {
    if (Array.isArray(dns.servers)) {
      dns.servers.forEach((s: unknown, i: number) => {
        if (isObj(s)) add(s.detour, { kind: 'outbound', at: 'dnsServer', server: String(s.tag ?? i) }, ['dns', 'servers', i, 'detour'])
      })
    }
    walkRules(dns.rules, ['dns', 'rules'], (rule, path, top) => {
      // `outbound` in a DNS rule is a match condition; "any" is a keyword, not a tag
      const outbounds = rule.outbound
      if (Array.isArray(outbounds)) {
        outbounds.forEach((v, i) => v !== 'any' && add(v, { kind: 'outbound', at: 'dnsRule', index: top }, [...path, 'outbound', i]))
      } else if (outbounds !== 'any') {
        add(outbounds, { kind: 'outbound', at: 'dnsRule', index: top }, [...path, 'outbound'])
      }
      addList(rule.rule_set, { kind: 'ruleset', at: 'dnsRule', index: top }, [...path, 'rule_set'])
    })
  }

  if (isObj(doc.ntp)) add(doc.ntp.detour, { kind: 'outbound', at: 'other', path: 'ntp.detour' }, ['ntp', 'detour'])
  const clash = isObj(doc.experimental) && isObj(doc.experimental.clash_api) ? doc.experimental.clash_api : null
  if (clash) {
    add(
      clash.external_ui_download_detour,
      { kind: 'outbound', at: 'other', path: 'experimental.clash_api.external_ui_download_detour' },
      ['experimental', 'clash_api', 'external_ui_download_detour'],
    )
  }
  return refs
}

export const refsTo = (doc: Obj, kind: RefKind, tag: string) =>
  findRefs(doc).filter((r) => r.site.kind === kind && r.tag === tag)

function setAt(doc: Obj, path: Path, value: string) {
  let cur: Obj = doc
  for (const key of path.slice(0, -1)) cur = cur[key as string]
  cur[path[path.length - 1] as string] = value
}

/** Point every reference to `from` at `to` (the tag itself is renamed by the caller). */
export function renameRefs(doc: Obj, kind: RefKind, from: string, to: string) {
  for (const ref of refsTo(doc, kind, from)) setAt(doc, ref.path, to)
  if (kind === 'outbound') dedupeMembers(doc)
}

function dedupeMembers(doc: Obj) {
  for (const g of groupsOf(doc)) {
    if (Array.isArray(g.value.outbounds)) g.value.outbounds = [...new Set(g.value.outbounds)]
  }
}

/**
 * Filter a rule list. `strip` removes a tag from one rule (returning whether the rule
 * itself must go); a rule whose last match condition was removed is dropped too,
 * since an empty rule would match everything.
 */
function pruneRules(rules: unknown, strip: (rule: Obj) => 'drop' | 'keep'): unknown[] | undefined {
  if (!Array.isArray(rules)) return undefined
  const out: unknown[] = []
  for (const rule of rules) {
    if (!isObj(rule)) {
      out.push(rule)
      continue
    }
    const before = matcherKeys(rule).length
    if (strip(rule) === 'drop') continue
    if (rule.type === 'logical') {
      rule.rules = pruneRules(rule.rules, strip)
      if (!rule.rules || rule.rules.length === 0) continue
    } else if (before > 0 && matcherKeys(rule).length === 0) {
      continue
    }
    out.push(rule)
  }
  return out
}

/** Remove a value from a listable field, deleting the field when it empties. */
function stripValue(rule: Obj, key: string, tag: string) {
  const value = rule[key]
  if (Array.isArray(value)) {
    const next = value.filter((v) => v !== tag)
    if (next.length) rule[key] = next
    else delete rule[key]
  } else if (value === tag) {
    delete rule[key]
  }
}

/**
 * Remove every reference to a tag: group memberships and defaults go, detours fall
 * back to a direct connection, rules that route to it are deleted.
 */
export function removeRefs(doc: Obj, kind: RefKind, tag: string) {
  const route = isObj(doc.route) ? doc.route : null
  const dns = isObj(doc.dns) ? doc.dns : null
  if (kind === 'outbound') {
    for (const o of allOutbounds(doc)) {
      if (isGroupType(o.type)) {
        if (Array.isArray(o.value.outbounds)) o.value.outbounds = o.value.outbounds.filter((m: unknown) => m !== tag)
        if (o.value.default === tag) delete o.value.default
      }
      if (o.value.detour === tag) delete o.value.detour
    }
    if (route) {
      const rules = pruneRules(route.rules, (rule) => (rule.outbound === tag ? 'drop' : 'keep'))
      if (rules) route.rules = rules
      if (route.final === tag) delete route.final
      for (const rs of Array.isArray(route.rule_set) ? route.rule_set : []) {
        if (isObj(rs) && rs.download_detour === tag) delete rs.download_detour
      }
    }
    if (dns) {
      for (const s of Array.isArray(dns.servers) ? dns.servers : []) if (isObj(s) && s.detour === tag) delete s.detour
      const rules = pruneRules(dns.rules, (rule) => {
        stripValue(rule, 'outbound', tag)
        return 'keep'
      })
      if (rules) dns.rules = rules
    }
    if (isObj(doc.ntp) && doc.ntp.detour === tag) delete doc.ntp.detour
    const clash = isObj(doc.experimental) && isObj(doc.experimental.clash_api) ? doc.experimental.clash_api : null
    if (clash && clash.external_ui_download_detour === tag) delete clash.external_ui_download_detour
  } else {
    const strip = (rule: Obj) => {
      stripValue(rule, 'rule_set', tag)
      return 'keep' as const
    }
    if (route) {
      const rules = pruneRules(route.rules, strip)
      if (rules) route.rules = rules
    }
    if (dns) {
      const rules = pruneRules(dns.rules, strip)
      if (rules) dns.rules = rules
    }
  }
}

/**
 * Point references to `from` at `to` instead. A group never ends up containing
 * itself, and a node never ends up as its own detour: those references are removed.
 */
export function replaceRefs(doc: Obj, kind: RefKind, from: string, to: string) {
  if (kind === 'outbound') {
    for (const o of allOutbounds(doc)) {
      if (o.tag !== to) continue
      if (isGroupType(o.type) && Array.isArray(o.value.outbounds)) {
        o.value.outbounds = o.value.outbounds.filter((m: unknown) => m !== from)
        if (o.value.default === from) delete o.value.default
      }
      if (o.value.detour === from) delete o.value.detour
    }
  }
  renameRefs(doc, kind, from, to)
}

// ── Dependencies ─────────────────────────────────────────────────────────────

/** Outbound tags `tag` depends on directly: group members and its detour. */
function dependencies(byTag: Map<string, Obj>, tag: string): string[] {
  const o = byTag.get(tag)
  if (!o) return []
  const deps = isGroupType(o.type) ? membersOf(o) : []
  if (typeof o.detour === 'string' && o.detour) deps.push(o.detour)
  return deps
}

const tagMap = (doc: Obj) => new Map(allOutbounds(doc).filter((o) => o.tagged).map((o) => [o.tag, o.value]))

/** Whether `from` depends (directly or not) on `target`. */
export function dependsOn(doc: Obj, from: string, target: string): boolean {
  const byTag = tagMap(doc)
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === target) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...dependencies(byTag, cur))
  }
  return false
}

/** Tags involved in a dependency cycle (group membership or detour), one list per cycle. */
export function findCycles(doc: Obj): string[][] {
  const byTag = tagMap(doc)
  const state = new Map<string, 'visiting' | 'done'>()
  const cycles: string[][] = []
  const stack: string[] = []
  const visit = (tag: string) => {
    if (state.get(tag) === 'done') return
    if (state.get(tag) === 'visiting') {
      cycles.push(stack.slice(stack.indexOf(tag)))
      return
    }
    state.set(tag, 'visiting')
    stack.push(tag)
    for (const dep of dependencies(byTag, tag)) if (byTag.has(dep)) visit(dep)
    stack.pop()
    state.set(tag, 'done')
  }
  for (const tag of byTag.keys()) visit(tag)
  return cycles
}

/** The detour chain from a node outwards: [first hop, second hop, …]. Stops at loops. */
export function detourChain(doc: Obj, tag: string): string[] {
  const byTag = tagMap(doc)
  const chain: string[] = []
  let cur = byTag.get(tag)
  while (cur && typeof cur.detour === 'string' && cur.detour && !chain.includes(cur.detour) && cur.detour !== tag) {
    chain.push(cur.detour)
    cur = byTag.get(cur.detour)
  }
  return chain
}

/** Nodes (by tag) that use `tag` as their detour. */
export const detourUsers = (doc: Obj, tag: string) =>
  allOutbounds(doc)
    .filter((o) => o.value.detour === tag)
    .map((o) => o.tag)

