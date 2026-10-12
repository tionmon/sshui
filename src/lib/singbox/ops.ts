/**
 * Edits to a config, each keeping references consistent. They mutate a draft
 * snapshot (the store clones before calling them).
 */
import {
  allOutbounds,
  ensureRoute,
  findOutbound,
  groupsContaining,
  groupsOf,
  isObj,
  ruleSetTags,
  ruleSetsOf,
  sectionList,
  tagsOf,
  uniqueTag,
  defaultOutbound,
  type Obj,
  type Section,
} from './doc'
import { protocolOf } from './protocols'
import { removeRefs, renameRefs, replaceRefs } from './refs'
import {
  actionOf,
  defaultSource,
  presetRuleSet,
  ruleSetTag,
  sharedDownloadDetour,
  templateEntryFor,
  type QuickRule,
  type RuleSetPreset,
  type RuleSetSource,
} from './rules'

export interface DisabledNode {
  section: Section
  node: Obj
  /** Groups it was in, restored when it's enabled again */
  groups: string[]
}

/** SSHUI's own notes about a config, kept beside it (sing-box rejects unknown fields). */
export interface Meta {
  /** Hidden node tag → the groups it was taken out of */
  hidden: Record<string, string[]>
  disabled: DisabledNode[]
}

export interface Snapshot {
  doc: Obj
  meta: Meta
}

export const emptyMeta = (): Meta => ({ hidden: {}, disabled: [] })

export function normalizeMeta(raw: unknown): Meta {
  const meta = emptyMeta()
  if (!isObj(raw)) return meta
  if (isObj(raw.hidden)) {
    for (const [tag, groups] of Object.entries(raw.hidden)) {
      meta.hidden[tag] = Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : []
    }
  }
  if (Array.isArray(raw.disabled)) {
    for (const d of raw.disabled) {
      if (isObj(d) && isObj(d.node)) {
        meta.disabled.push({
          section: d.section === 'endpoints' ? 'endpoints' : 'outbounds',
          node: d.node,
          groups: Array.isArray(d.groups) ? d.groups.filter((g: unknown): g is string => typeof g === 'string') : [],
        })
      }
    }
  }
  return meta
}

/** Forget hidden marks for nodes that are gone or were put back into a group. */
export function reconcileMeta(s: Snapshot) {
  const tags = new Set(tagsOf(s.doc))
  for (const tag of Object.keys(s.meta.hidden)) {
    if (!tags.has(tag) || groupsContaining(s.doc, tag).length > 0) delete s.meta.hidden[tag]
  }
}

const sectionFor = (node: Obj): Section => {
  // Old-style WireGuard outbounds have a server; endpoints have peers
  if (node.type === 'wireguard') return Array.isArray(node.peers) || !node.server ? 'endpoints' : 'outbounds'
  return protocolOf(String(node.type))?.section ?? 'outbounds'
}

function addToGroups(s: Snapshot, tag: string, groups: string[]) {
  for (const g of groupsOf(s.doc)) {
    if (!groups.includes(g.tag)) continue
    if (!Array.isArray(g.value.outbounds)) g.value.outbounds = []
    if (!g.value.outbounds.includes(tag)) g.value.outbounds.push(tag)
  }
}

function removeFromGroups(s: Snapshot, tag: string, groups?: string[]) {
  for (const g of groupsOf(s.doc)) {
    if (groups && !groups.includes(g.tag)) continue
    if (Array.isArray(g.value.outbounds)) g.value.outbounds = g.value.outbounds.filter((m: unknown) => m !== tag)
    if (g.value.default === tag) delete g.value.default
  }
}

function removeOutbound(s: Snapshot, tag: string) {
  const o = findOutbound(s.doc, tag)
  if (o) s.doc[o.section].splice(o.index, 1)
}

/**
 * Without route.final the first outbound is the default; adding something in front
 * would silently change where unmatched traffic goes, so pin the current default.
 */
function pinDefault(s: Snapshot) {
  const { tag, explicit } = defaultOutbound(s.doc)
  if (!explicit && tag) ensureRoute(s.doc).final = tag
}

function renameMeta(s: Snapshot, from: string, to: string) {
  if (s.meta.hidden[from]) {
    s.meta.hidden[to] = s.meta.hidden[from]
    delete s.meta.hidden[from]
  }
  const swap = (list: string[]) => list.map((g) => (g === from ? to : g))
  for (const key of Object.keys(s.meta.hidden)) s.meta.hidden[key] = swap(s.meta.hidden[key])
  for (const d of s.meta.disabled) d.groups = swap(d.groups)
}

// ── Nodes ────────────────────────────────────────────────────────────────────

/** Append nodes, giving each a unique tag. Returns the tags used. */
export function addNodes(s: Snapshot, nodes: Obj[], groups: string[] = []): string[] {
  const taken = new Set(tagsOf(s.doc))
  const added: string[] = []
  for (const original of nodes) {
    const node = structuredClone(original)
    node.tag = uniqueTag(typeof node.tag === 'string' && node.tag ? node.tag : `${node.type}`, taken)
    taken.add(node.tag)
    sectionList(s.doc, sectionFor(node)).push(node)
    addToGroups(s, node.tag, groups)
    added.push(node.tag)
  }
  return added
}

/**
 * Save a node edited in the dialog. A changed tag is renamed everywhere it's used;
 * `groups` becomes its exact group membership.
 */
export function saveNode(s: Snapshot, originalTag: string | null, node: Obj, groups: string[]) {
  if (originalTag === null) {
    const [tag] = addNodes(s, [node], groups)
    return tag
  }
  const existing = findOutbound(s.doc, originalTag)
  if (!existing) throw new Error(`No outbound named ${originalTag}`)
  const tag = String(node.tag)
  if (tag !== originalTag) {
    renameRefs(s.doc, 'outbound', originalTag, tag)
    renameMeta(s, originalTag, tag)
  }
  s.doc[existing.section][existing.index] = node
  setMembership(s, tag, groups)
  return tag
}

export function setMembership(s: Snapshot, tag: string, groups: string[]) {
  const current = groupsContaining(s.doc, tag)
  removeFromGroups(
    s,
    tag,
    current.filter((g) => !groups.includes(g)),
  )
  addToGroups(
    s,
    tag,
    groups.filter((g) => !current.includes(g) && g !== tag),
  )
}

/** Delete outbounds (nodes or groups), removing or redirecting their references. */
export function deleteOutbounds(s: Snapshot, tags: string[], replacement?: string) {
  for (const tag of tags) {
    if (replacement && replacement !== tag) replaceRefs(s.doc, 'outbound', tag, replacement)
    else removeRefs(s.doc, 'outbound', tag)
    removeOutbound(s, tag)
    delete s.meta.hidden[tag]
  }
}

/** Take nodes out of every group, remembering where they were. */
export function hideNodes(s: Snapshot, tags: string[]) {
  for (const tag of tags) {
    const groups = groupsContaining(s.doc, tag)
    s.meta.hidden[tag] = [...new Set([...(s.meta.hidden[tag] ?? []), ...groups])]
    removeFromGroups(s, tag)
  }
}

export function unhideNodes(s: Snapshot, tags: string[]) {
  const existing = new Set(groupsOf(s.doc).map((g) => g.tag))
  for (const tag of tags) {
    addToGroups(
      s,
      tag,
      (s.meta.hidden[tag] ?? []).filter((g) => existing.has(g)),
    )
    delete s.meta.hidden[tag]
  }
}

/**
 * Move nodes out of the config into SSHUI's notes. Group memberships are remembered
 * for when they're enabled again; other references (rules, relays, the default route)
 * go to `replacement`, or are removed without one.
 */
export function disableNodes(s: Snapshot, tags: string[], replacement?: string) {
  for (const tag of tags) {
    const o = findOutbound(s.doc, tag)
    if (!o) continue
    const groups = [...new Set([...groupsContaining(s.doc, tag), ...(s.meta.hidden[tag] ?? [])])]
    const node = structuredClone(o.value)
    removeFromGroups(s, tag)
    if (replacement && replacement !== tag) replaceRefs(s.doc, 'outbound', tag, replacement)
    else removeRefs(s.doc, 'outbound', tag)
    removeOutbound(s, tag)
    delete s.meta.hidden[tag]
    s.meta.disabled.push({ section: o.section, node, groups })
  }
}

/** Put disabled nodes back (by their index in meta.disabled). Returns their tags. */
export function enableNodes(s: Snapshot, indexes: number[]): string[] {
  const picked = indexes.map((i) => s.meta.disabled[i]).filter(Boolean)
  s.meta.disabled = s.meta.disabled.filter((_, i) => !indexes.includes(i))
  const tags: string[] = []
  const existing = new Set(groupsOf(s.doc).map((g) => g.tag))
  for (const d of picked) {
    const node = structuredClone(d.node)
    node.tag = uniqueTag(String(node.tag ?? node.type), tagsOf(s.doc))
    sectionList(s.doc, d.section).push(node)
    addToGroups(
      s,
      node.tag,
      d.groups.filter((g) => existing.has(g)),
    )
    tags.push(node.tag)
  }
  return tags
}

export function deleteDisabled(s: Snapshot, indexes: number[]) {
  s.meta.disabled = s.meta.disabled.filter((_, i) => !indexes.includes(i))
}

/**
 * Copy a node, optionally connecting through `via`. The copy goes right after the
 * original and joins the same groups.
 */
export function duplicateNode(s: Snapshot, tag: string, via?: string): string {
  const o = findOutbound(s.doc, tag)
  if (!o) throw new Error(`No outbound named ${tag}`)
  const node = structuredClone(o.value)
  node.tag = uniqueTag(via ? `${tag} via ${via}` : `${tag} copy`, tagsOf(s.doc))
  if (via) node.detour = via
  s.doc[o.section].splice(o.index + 1, 0, node)
  addToGroups(s, node.tag, groupsContaining(s.doc, tag))
  return node.tag
}

/** Point a node's connection through another outbound (or connect directly). */
export function setDetour(s: Snapshot, tag: string, via: string | null) {
  const o = findOutbound(s.doc, tag)
  if (!o) return
  if (via) o.value.detour = via
  else delete o.value.detour
}

// ── Groups ───────────────────────────────────────────────────────────────────

export function saveGroup(s: Snapshot, originalTag: string | null, group: Obj) {
  const tag = String(group.tag)
  if (originalTag === null) {
    const groups = groupsOf(s.doc).filter((g) => g.section === 'outbounds')
    const list = sectionList(s.doc, 'outbounds')
    if (groups.length) {
      list.splice(groups[groups.length - 1].index + 1, 0, group)
    } else {
      // Groups conventionally come first; keep the current default when doing so
      pinDefault(s)
      list.unshift(group)
    }
    return tag
  }
  const existing = findOutbound(s.doc, originalTag)
  if (!existing) throw new Error(`No outbound named ${originalTag}`)
  if (tag !== originalTag) {
    renameRefs(s.doc, 'outbound', originalTag, tag)
    renameMeta(s, originalTag, tag)
    // The group's own member list was renamed above if it contained itself
  }
  s.doc[existing.section][existing.index] = group
  return tag
}

/** Fields that only apply to one group type. */
const SELECTOR_ONLY = ['default']
const URLTEST_ONLY = ['url', 'interval', 'tolerance', 'idle_timeout']

export function changeGroupType(group: Obj, type: string): Obj {
  const next: Obj = { ...group, type }
  for (const key of type === 'selector' ? URLTEST_ONLY : SELECTOR_ONLY) delete next[key]
  return next
}

// ── Rules ────────────────────────────────────────────────────────────────────

const rulesList = (s: Snapshot): unknown[] => {
  const route = ensureRoute(s.doc)
  if (!Array.isArray(route.rules)) route.rules = []
  return route.rules
}

export function saveRule(s: Snapshot, index: number | null, rule: Obj) {
  const rules = rulesList(s)
  if (index === null) rules.push(rule)
  else rules[index] = rule
}

/** Insert a rule right after `index` (used to duplicate a rule next to the original). */
export function insertRuleAfter(s: Snapshot, index: number, rule: Obj) {
  rulesList(s).splice(index + 1, 0, rule)
}

export function deleteRule(s: Snapshot, index: number) {
  rulesList(s).splice(index, 1)
}

export function moveRule(s: Snapshot, from: number, to: number) {
  const rules = rulesList(s)
  if (to < 0 || to >= rules.length) return
  const [rule] = rules.splice(from, 1)
  rules.splice(to, 0, rule)
}

export function setFinal(s: Snapshot, tag: string | null) {
  const route = ensureRoute(s.doc)
  if (tag) route.final = tag
  else delete route.final
}

// ── Rule sets ────────────────────────────────────────────────────────────────

/** Add (index null) or replace a rule-set entry; a renamed tag is renamed in rules too. */
export function saveRuleSet(s: Snapshot, index: number | null, rs: Obj) {
  const route = ensureRoute(s.doc)
  if (!Array.isArray(route.rule_set)) route.rule_set = []
  if (index === null) {
    route.rule_set.push(rs)
    return
  }
  const old = route.rule_set[index]
  if (!isObj(old)) throw new Error(`No rule set at ${index}`)
  const before = ruleSetTags(old)
  const after = ruleSetTags(rs)
  const removed = before.filter((t) => !after.includes(t))
  const added = after.filter((t) => !before.includes(t))
  // One name swapped for another is a rename; anything else is left to the user
  if (removed.length === 1 && added.length === 1) renameRefs(s.doc, 'ruleset', removed[0], added[0])
  route.rule_set[index] = rs
}

/** Delete one rule-set tag (and its uses); an entry left without tags goes too. */
export function deleteRuleSet(s: Snapshot, tag: string) {
  removeRefs(s.doc, 'ruleset', tag)
  const route = ensureRoute(s.doc)
  if (!Array.isArray(route.rule_set)) return
  route.rule_set = route.rule_set.flatMap((r: unknown) => {
    if (!isObj(r)) return [r]
    if (Array.isArray(r.tag)) {
      if (!r.tag.includes(tag)) return [r]
      const rest = r.tag.filter((t: unknown) => t !== tag)
      return rest.length ? [{ ...r, tag: rest }] : []
    }
    return r.tag === tag ? [] : [r]
  })
  if (route.rule_set.length === 0) delete route.rule_set
}

/**
 * Add preset rule sets that aren't defined yet. Lists from a repository the config
 * already downloads through a "{tag}" template join that entry; others get their own.
 * Returns the tags that were added.
 */
export function addPresetRuleSets(s: Snapshot, presets: RuleSetPreset[], source?: RuleSetSource, downloadDetour?: string): string[] {
  const route = ensureRoute(s.doc)
  if (!Array.isArray(route.rule_set)) route.rule_set = []
  const existing = ruleSetsOf(s.doc)
  const from = source ?? defaultSource(existing)
  const detour = downloadDetour ?? sharedDownloadDetour(existing)
  const added: string[] = []
  for (const p of presets) {
    const tag = ruleSetTag(p)
    if (ruleSetsOf(s.doc).some((rs) => ruleSetTags(rs).includes(tag))) continue
    const template = templateEntryFor(ruleSetsOf(s.doc), p)
    if (template) template.tag.push(tag)
    else route.rule_set.push(presetRuleSet(p, from, detour))
    added.push(tag)
  }
  return added
}

/** Make sure a preset rule set exists, returning its tag. */
function ensurePresetRuleSet(s: Snapshot, db: 'geosite' | 'geoip', name: string, source?: RuleSetSource): string {
  addPresetRuleSets(s, [{ db, name }], source)
  return `${db}-${name}`
}

/** A direct outbound to route to, created when the config has none. */
function directTag(s: Snapshot): string {
  const direct = allOutbounds(s.doc).find((o) => o.type === 'direct' && o.tagged)
  if (direct) return direct.tag
  const tag = uniqueTag('direct', tagsOf(s.doc))
  sectionList(s.doc, 'outbounds').push({ type: 'direct', tag })
  return tag
}

/** Index just after the leading sniff / hijack-dns / reject rules. */
function earlyIndex(rules: unknown[], kinds: string[]) {
  let i = 0
  while (i < rules.length && isObj(rules[i]) && kinds.includes(actionOf(rules[i] as Obj))) i++
  return i
}

/** Add a ready-made rule. Returns false when an equivalent rule already exists. */
export function addQuickRule(s: Snapshot, kind: QuickRule, source?: RuleSetSource): boolean {
  const rules = rulesList(s)
  const has = (pred: (r: Obj) => boolean) => rules.some((r) => isObj(r) && pred(r))
  switch (kind) {
    case 'sniff':
      if (has((r) => r.action === 'sniff')) return false
      rules.unshift({ action: 'sniff' })
      return true
    case 'hijackDns':
      if (has((r) => r.action === 'hijack-dns')) return false
      rules.splice(earlyIndex(rules, ['sniff']), 0, { protocol: 'dns', action: 'hijack-dns' })
      return true
    case 'privateDirect': {
      if (has((r) => r.ip_is_private === true)) return false
      const direct = directTag(s)
      rules.splice(earlyIndex(rules, ['sniff', 'hijack-dns']), 0, { ip_is_private: true, outbound: direct })
      return true
    }
    case 'blockAds': {
      const tag = ensurePresetRuleSet(s, 'geosite', 'category-ads-all', source)
      if (has((r) => Array.isArray(r.rule_set) ? r.rule_set.includes(tag) : r.rule_set === tag)) return false
      rules.splice(earlyIndex(rules, ['sniff', 'hijack-dns']), 0, { rule_set: [tag], action: 'reject' })
      return true
    }
    case 'cnDirect': {
      const site = ensurePresetRuleSet(s, 'geosite', 'cn', source)
      const ip = ensurePresetRuleSet(s, 'geoip', 'cn', source)
      if (has((r) => Array.isArray(r.rule_set) && r.rule_set.includes(site))) return false
      rules.push({ rule_set: [site, ip], outbound: directTag(s) })
      return true
    }
  }
}

