/**
 * The sing-box config document: parsing, serialising and typed views over the
 * parts SSHUI edits (outbounds/endpoints, groups, route rules and rule sets).
 *
 * The document is kept as plain JSON so every field SSHUI doesn't know about
 * survives a round trip untouched, in its original order.
 */

// sing-box configs are free-form JSON; the editor works on plain objects
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>
export type Section = 'outbounds' | 'endpoints'

export const GROUP_TYPES = ['selector', 'urltest']
/** Outbounds that aren't proxies; shown with the nodes but never imported or tested */
export const BUILTIN_TYPES = ['direct', 'block', 'dns']

export interface NodeRef {
  section: Section
  index: number
  /** Effective tag; sing-box names an untagged outbound by its index */
  tag: string
  tagged: boolean
  type: string
  value: Obj
}

export const isGroupType = (type: unknown) => GROUP_TYPES.includes(String(type))
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Every outbound and endpoint, groups included, in file order. */
export function allOutbounds(doc: Obj): NodeRef[] {
  const out: NodeRef[] = []
  for (const section of ['outbounds', 'endpoints'] as Section[]) {
    const list = Array.isArray(doc[section]) ? doc[section] : []
    list.forEach((value: unknown, index: number) => {
      if (!isObj(value)) return
      const tagged = typeof value.tag === 'string' && value.tag !== ''
      out.push({
        section,
        index,
        tag: tagged ? value.tag : String(index),
        tagged,
        type: String(value.type ?? ''),
        value,
      })
    })
  }
  return out
}

export const nodesOf = (doc: Obj) => allOutbounds(doc).filter((o) => !isGroupType(o.type))
export const groupsOf = (doc: Obj) => allOutbounds(doc).filter((o) => isGroupType(o.type))
export const tagsOf = (doc: Obj) => allOutbounds(doc).filter((o) => o.tagged).map((o) => o.tag)
/** An outbound by tag; untagged ones are found by the index sing-box names them with. */
export const findOutbound = (doc: Obj, tag: string) => {
  const all = allOutbounds(doc)
  return all.find((o) => o.tagged && o.tag === tag) ?? all.find((o) => !o.tagged && o.tag === tag)
}

export const ruleSetsOf = (doc: Obj): Obj[] =>
  isObj(doc.route) && Array.isArray(doc.route.rule_set) ? doc.route.rule_set.filter(isObj) : []
/**
 * The tags one rule-set entry defines. An entry may list several tags that share a
 * URL template containing "{tag}", e.g. one entry for many geosite lists.
 */
export const ruleSetTags = (rs: Obj): string[] => asList(rs.tag).filter(Boolean)
export const allRuleSetTags = (doc: Obj): string[] => ruleSetsOf(doc).flatMap(ruleSetTags)
export const routeRulesOf = (doc: Obj): Obj[] =>
  isObj(doc.route) && Array.isArray(doc.route.rules) ? doc.route.rules : []
export const inboundTagsOf = (doc: Obj): string[] =>
  Array.isArray(doc.inbounds)
    ? doc.inbounds.filter(isObj).map((i: Obj) => i.tag).filter((t: unknown): t is string => typeof t === 'string' && !!t)
    : []

/** Members of a group, ignoring anything that isn't a string tag. */
export const membersOf = (group: Obj): string[] =>
  Array.isArray(group.outbounds) ? group.outbounds.filter((m: unknown): m is string => typeof m === 'string') : []

/** Groups (by tag) that list `tag` as a member. */
export const groupsContaining = (doc: Obj, tag: string) =>
  groupsOf(doc)
    .filter((g) => membersOf(g.value).includes(tag))
    .map((g) => g.tag)

/** The section's array, created on demand. */
export function sectionList(doc: Obj, section: Section): Obj[] {
  if (!Array.isArray(doc[section])) doc[section] = []
  return doc[section]
}

export function ensureRoute(doc: Obj): Obj {
  if (!isObj(doc.route)) doc.route = {}
  return doc.route
}

/** A tag not used by any outbound or endpoint: "name", "name 2", "name 3"… */
export function uniqueTag(base: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  const clean = base.trim() || 'node'
  if (!set.has(clean)) return clean
  for (let i = 2; ; i++) {
    const candidate = `${clean} ${i}`
    if (!set.has(candidate)) return candidate
  }
}

/** The outbound sing-box uses when no rule matches. */
export function defaultOutbound(doc: Obj): { tag: string | null; explicit: boolean } {
  const final = isObj(doc.route) && typeof doc.route.final === 'string' && doc.route.final ? doc.route.final : null
  if (final) return { tag: final, explicit: true }
  const first = allOutbounds(doc).find((o) => o.section === 'outbounds')
  return { tag: first?.tag ?? null, explicit: false }
}

// ── Paths ────────────────────────────────────────────────────────────────────

export type Path = (string | number)[]
export const splitPath = (path: string): Path => path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p))

export function getIn(obj: unknown, path: Path | string): unknown {
  let cur: unknown = obj
  for (const key of typeof path === 'string' ? splitPath(path) : path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Obj)[key as string]
  }
  return cur
}

const isEmptyValue = (v: unknown) =>
  v === undefined || v === '' || v === null || (Array.isArray(v) && v.length === 0)

/**
 * Set a value, creating objects/arrays along the way. Empty values (undefined, '',
 * null, []) remove the key, and containers left empty by that are removed too.
 */
export function setIn(obj: Obj, path: Path | string, value: unknown) {
  const keys = typeof path === 'string' ? splitPath(path) : path
  if (isEmptyValue(value)) {
    deleteIn(obj, keys)
    return
  }
  let cur: Obj = obj
  keys.slice(0, -1).forEach((key, i) => {
    const next = cur[key as string]
    if (next === null || typeof next !== 'object') {
      cur[key as string] = typeof keys[i + 1] === 'number' ? [] : {}
    }
    cur = cur[key as string]
  })
  cur[keys[keys.length - 1] as string] = value
}

export function deleteIn(obj: Obj, path: Path | string) {
  const keys = typeof path === 'string' ? splitPath(path) : path
  const isEmpty = (v: unknown) =>
    v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0)
  const walk = (cur: unknown, i: number) => {
    if (cur === null || typeof cur !== 'object') return
    const key = keys[i]
    const target = cur as Obj
    if (i === keys.length - 1) {
      if (Array.isArray(cur) && typeof key === 'number') cur.splice(key, 1)
      else delete target[key as string]
      return
    }
    walk(target[key as string], i + 1)
    // Prune objects this left empty; array items are kept so indexes don't shift
    if (!Array.isArray(cur) && isEmpty(target[key as string])) delete target[key as string]
  }
  walk(obj, 0)
}

/** A sing-box "listable" value (string or array) as an array. */
export const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === '' ? [] : [String(v)]

// ── Text ─────────────────────────────────────────────────────────────────────

export interface ParsedText {
  doc: Obj
  indent: string
  trailingNewline: boolean
  /** The file had comments or trailing commas; edited parts lose them on save */
  lossy: boolean
  /** The text without a byte order mark */
  text: string
  /** The text with comments and trailing commas blanked, position for position */
  clean: string
  /** "\r\n" for files with Windows line endings */
  eol: string
}

/** Remove // and /* *\/ comments and trailing commas, leaving strings alone. */
export function stripJsonc(text: string): { text: string; changed: boolean } {
  let out = ''
  let changed = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      // Blanked rather than removed, so positions match the original text
      while (i < text.length && text[i] !== '\n') {
        out += text[i] === '\r' ? '\r' : ' '
        i++
      }
      changed = true
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      // Keep line breaks so error positions still line up
      const body = text.slice(i, end < 0 ? text.length : end + 2)
      out += body.replace(/[^\n]/g, ' ')
      i = end < 0 ? text.length : end + 2
      changed = true
    } else if (c === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === '}' || text[j] === ']') {
        changed = true
        out += ' '
      } else {
        out += c
      }
      i++
    } else {
      out += c
      i++
    }
  }
  return { text: out, changed }
}

export class ParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message)
  }
}

function positionOf(text: string, offset: number) {
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  return { line, column: offset - before.lastIndexOf('\n') }
}

export function parseConfig(raw: string): ParsedText {
  const text = raw.replace(/^﻿/, '')
  const { text: clean, changed } = stripJsonc(text)
  let doc: unknown
  try {
    doc = JSON.parse(clean)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const m = message.match(/position (\d+)/)
    if (m) {
      const { line, column } = positionOf(clean, Number(m[1]))
      // The line and column are shown separately
      throw new ParseError(message.replace(/\s*(in JSON )?at position \d+.*$/, ''), line, column)
    }
    const lc = message.match(/line (\d+) column (\d+)/)
    throw new ParseError(message, lc ? Number(lc[1]) : undefined, lc ? Number(lc[2]) : undefined)
  }
  if (!isObj(doc)) throw new ParseError('The file is not a JSON object')
  const indentMatch = text.match(/\n([ \t]+)["{[\]}]/)
  return {
    doc,
    indent: indentMatch ? (indentMatch[1].startsWith('\t') ? '\t' : ' '.repeat(Math.min(indentMatch[1].length, 8))) : '  ',
    trailingNewline: text.endsWith('\n') || text === '',
    lossy: changed,
    text,
    clean,
    // Files with mixed line endings get whichever is more common
    eol: (text.match(/\r\n/g)?.length ?? 0) * 2 > (text.match(/\n/g)?.length ?? 0) ? '\r\n' : '\n',
  }
}

export const serialize = (doc: Obj, indent: string, trailingNewline: boolean) =>
  JSON.stringify(doc, null, indent) + (trailingNewline ? '\n' : '')

export const clone = <T>(v: T): T => structuredClone(v)

/** A small starting point for people without a config yet. */
export const STARTER_CONFIG: Obj = {
  log: { level: 'info', timestamp: true },
  inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 }],
  outbounds: [
    { type: 'selector', tag: 'Proxy', outbounds: ['direct'] },
    { type: 'direct', tag: 'direct' },
  ],
  route: {
    rules: [{ action: 'sniff' }, { ip_is_private: true, outbound: 'direct' }],
    final: 'Proxy',
    auto_detect_interface: true,
  },
}
