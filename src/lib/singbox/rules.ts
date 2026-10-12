/**
 * Route rules and rule sets: the conditions SSHUI edits as fields, rule summaries,
 * and presets for the rule sets most people need.
 */
import { asList, isObj, type Obj } from './doc'
import { matcherKeys } from './refs'

export type MatcherKind = 'list' | 'ports' | 'bool' | 'select' | 'multiselect' | 'ruleset' | 'inbound'

export interface MatcherDef {
  key: string
  kind: MatcherKind
  options?: string[]
  placeholder?: string
}

/** Conditions offered in the rule editor, most common first. */
export const MATCHERS: MatcherDef[] = [
  { key: 'rule_set', kind: 'ruleset' },
  { key: 'domain_suffix', kind: 'list', placeholder: 'google.com' },
  { key: 'domain', kind: 'list', placeholder: 'www.example.com' },
  { key: 'domain_keyword', kind: 'list', placeholder: 'google' },
  { key: 'domain_regex', kind: 'list', placeholder: '^stun\\..+' },
  { key: 'ip_cidr', kind: 'list', placeholder: '10.0.0.0/8' },
  { key: 'ip_is_private', kind: 'bool' },
  { key: 'process_name', kind: 'list', placeholder: 'chrome.exe' },
  { key: 'process_path', kind: 'list' },
  { key: 'port', kind: 'ports', placeholder: '443' },
  { key: 'port_range', kind: 'list', placeholder: '1000:2000' },
  { key: 'network', kind: 'select', options: ['tcp', 'udp'] },
  {
    key: 'protocol',
    kind: 'multiselect',
    options: ['http', 'tls', 'quic', 'dns', 'stun', 'bittorrent', 'dtls', 'ssh', 'rdp', 'ntp'],
  },
  { key: 'inbound', kind: 'inbound' },
  { key: 'source_ip_cidr', kind: 'list', placeholder: '192.168.1.0/24' },
  { key: 'clash_mode', kind: 'list', placeholder: 'direct' },
  { key: 'package_name', kind: 'list', placeholder: 'com.example.app' },
]

export const matcherDef = (key: string) => MATCHERS.find((m) => m.key === key)

/** Rule actions the editor understands (sing-box 1.11+); others stay as they are. */
export const ACTIONS = ['route', 'reject', 'hijack-dns', 'sniff', 'resolve']

/** A rule's action; rules without one route to their outbound (the pre-1.11 form). */
export const actionOf = (rule: Obj): string => (typeof rule.action === 'string' && rule.action ? rule.action : 'route')

export const isLogical = (rule: Obj) => rule.type === 'logical'

export interface RuleSummary {
  conditions: { key: string; values: string[] }[]
  /** Conditions of a logical rule, as "and"/"or" with a count */
  logical?: { mode: string; count: number }
  action: string
  outbound?: string
  invert: boolean
}

export function summarizeRule(rule: Obj): RuleSummary {
  const conditions = isLogical(rule)
    ? []
    : matcherKeys(rule).map((key) => {
        const v = rule[key]
        return { key, values: typeof v === 'boolean' ? [String(v)] : asList(v).length ? asList(v) : [JSON.stringify(v)] }
      })
  return {
    conditions,
    logical: isLogical(rule) ? { mode: String(rule.mode ?? 'and'), count: Array.isArray(rule.rules) ? rule.rules.length : 0 } : undefined,
    action: actionOf(rule),
    outbound: typeof rule.outbound === 'string' ? rule.outbound : undefined,
    invert: !!rule.invert,
  }
}

/** Domain conditions only work on connections whose domain is known: sniffed or resolved. */
export const DOMAIN_MATCHERS = ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex']

// ── Rule sets ────────────────────────────────────────────────────────────────

/** "github", "jsdelivr", or a mirror prefix put in front of the GitHub URL */
export type RuleSetSource = string

export interface RuleSetPreset {
  /** "geosite" or "geoip" */
  db: 'geosite' | 'geoip'
  name: string
}

export const ruleSetTag = (p: RuleSetPreset) => `${p.db}-${p.name}`

const repoOf = (p: RuleSetPreset) => (p.db === 'geosite' ? 'sing-geosite' : 'sing-geoip')

export function ruleSetUrl(p: RuleSetPreset, source: RuleSetSource) {
  const file = `${ruleSetTag(p)}.srs`
  if (source === 'jsdelivr') return `https://cdn.jsdelivr.net/gh/SagerNet/${repoOf(p)}@rule-set/${file}`
  const raw = `https://raw.githubusercontent.com/SagerNet/${repoOf(p)}/rule-set/${file}`
  return /^https?:\/\//.test(source) ? source + raw : raw
}

/**
 * A mirror the config already puts in front of GitHub download URLs, such as
 * "https://gh-proxy.com/", so new rule sets download the same way.
 */
export function detectMirror(ruleSets: Obj[]): string | null {
  for (const rs of ruleSets) {
    const m = typeof rs.url === 'string' ? rs.url.match(/^(https?:\/\/.+?\/)https:\/\/raw\.githubusercontent\.com\//) : null
    if (m) return m[1]
  }
  return null
}

/** Where new rule sets download from by default: the config's own mirror, else GitHub. */
export const defaultSource = (ruleSets: Obj[]): RuleSetSource => detectMirror(ruleSets) ?? 'github'

/**
 * An existing entry that downloads several SagerNet lists through one "{tag}" URL
 * template; new lists from the same repository are added to it as extra tags.
 */
export function templateEntryFor(ruleSets: Obj[], p: RuleSetPreset): Obj | undefined {
  return ruleSets.find(
    (rs) => Array.isArray(rs.tag) && typeof rs.url === 'string' && rs.url.includes('{tag}') && rs.url.includes(`/${repoOf(p)}/`),
  )
}

/** Commonly used SagerNet rule sets (from the v2fly domain list and GeoIP). */
export const RULESET_PRESETS: RuleSetPreset[] = [
  { db: 'geosite', name: 'cn' },
  { db: 'geoip', name: 'cn' },
  { db: 'geosite', name: 'geolocation-!cn' },
  { db: 'geosite', name: 'category-ads-all' },
  { db: 'geosite', name: 'private' },
  { db: 'geosite', name: 'google' },
  { db: 'geosite', name: 'youtube' },
  { db: 'geosite', name: 'github' },
  { db: 'geosite', name: 'openai' },
  { db: 'geosite', name: 'anthropic' },
  { db: 'geosite', name: 'telegram' },
  { db: 'geoip', name: 'telegram' },
  { db: 'geosite', name: 'netflix' },
  { db: 'geosite', name: 'spotify' },
  { db: 'geosite', name: 'twitter' },
  { db: 'geosite', name: 'apple' },
  { db: 'geosite', name: 'microsoft' },
  { db: 'geosite', name: 'steam' },
]

/** A remote rule-set definition for a preset. */
export function presetRuleSet(p: RuleSetPreset, source: RuleSetSource, downloadDetour?: string): Obj {
  const rs: Obj = { type: 'remote', tag: ruleSetTag(p), format: 'binary', url: ruleSetUrl(p, source) }
  if (downloadDetour) rs.download_detour = downloadDetour
  return rs
}

/** Where a rule set's rules come from, for display. */
export function ruleSetSource(rs: Obj): string {
  if (rs.type === 'remote') return String(rs.url ?? '')
  if (rs.type === 'local') return String(rs.path ?? '')
  if (rs.type === 'inline') return `${Array.isArray(rs.rules) ? rs.rules.length : 0} inline`
  return ''
}

/** Rule-set format from a file name or URL. */
export const formatFromName = (name: string) => (/\.json(\?|$)/i.test(name) ? 'source' : 'binary')

/**
 * When every remote rule set already downloads through the same outbound, new ones
 * should too (a rule set that can't download stops sing-box from starting).
 */
export function sharedDownloadDetour(ruleSets: Obj[]): string | undefined {
  const remotes = ruleSets.filter((rs) => isObj(rs) && rs.type === 'remote')
  const detours = new Set(remotes.map((rs) => rs.download_detour ?? ''))
  if (remotes.length === 0 || detours.size !== 1) return undefined
  const [only] = detours
  return only || undefined
}

/** Ready-made rules for the "Quick add" menu. */
export type QuickRule = 'sniff' | 'hijackDns' | 'privateDirect' | 'blockAds' | 'cnDirect'
export const QUICK_RULES: QuickRule[] = ['sniff', 'hijackDns', 'privateDirect', 'cnDirect', 'blockAds']
