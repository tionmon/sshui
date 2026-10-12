/**
 * Writes an edited config back with as little change to the file as possible: parts
 * that weren't edited are copied from the original text exactly (formatting, one-line
 * objects, comments and line endings included); only edited parts are re-serialized,
 * in the file's own style.
 */
import { isObj, type Obj } from './doc'

interface SourceNode {
  start: number
  end: number
  /** The parsed value at this node */
  value: unknown
  keys?: Map<string, SourceNode>
  items?: SourceNode[]
}

/**
 * Parse JSON text into a tree of source ranges. `text` must already have comments and
 * trailing commas blanked out (same length as the original, see stripJsonc).
 */
function parseSource(text: string): SourceNode {
  let i = 0
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  const value = (): SourceNode => {
    ws()
    const start = i
    const c = text[i]
    if (c === '{') {
      i++
      const keys = new Map<string, SourceNode>()
      const obj: Obj = {}
      ws()
      if (text[i] === '}') {
        i++
        return { start, end: i, value: obj, keys }
      }
      for (;;) {
        ws()
        const keyNode = value()
        const key = keyNode.value as string
        ws()
        i++ // ':'
        const child = value()
        keys.set(key, child)
        obj[key] = child.value
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        i++ // '}'
        return { start, end: i, value: obj, keys }
      }
    }
    if (c === '[') {
      i++
      const items: SourceNode[] = []
      ws()
      if (text[i] === ']') {
        i++
        return { start, end: i, value: [], items }
      }
      for (;;) {
        items.push(value())
        ws()
        if (text[i] === ',') {
          i++
          ws()
          // A trailing comma blanked to a space leaves "]" next
          if (text[i] === ']') {
            i++
            break
          }
          continue
        }
        i++ // ']'
        break
      }
      return { start, end: i, value: items.map((n) => n.value), items }
    }
    if (c === '"') {
      i++
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
      i++
      return { start, end: i, value: JSON.parse(text.slice(start, i)) }
    }
    while (i < text.length && /[^\s,\]}]/.test(text[i])) i++
    return { start, end: i, value: JSON.parse(text.slice(start, i)) }
  }
  return value()
}

const keyCache = new WeakMap<object, string>()
const keyOf = (v: unknown) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  let k = keyCache.get(v)
  if (k === undefined) {
    k = JSON.stringify(v)
    keyCache.set(v, k)
  }
  return k
}

export interface SourceText {
  /** The original file text */
  text: string
  /** The same text with comments and trailing commas blanked (equal length) */
  clean: string
  indent: string
  eol: string
}

let cached: { clean: string; root: SourceNode } | null = null
function sourceTree(clean: string): SourceNode {
  if (cached?.clean !== clean) {
    let root: SourceNode
    try {
      root = parseSource(clean)
    } catch {
      root = { start: 0, end: 0, value: undefined }
    }
    cached = { clean, root }
  }
  return cached.root
}

interface Replacement {
  start: number
  end: number
  text: string
}

/** Serialize `doc`, reusing unchanged parts of the original text. */
export function serializeLike(doc: Obj, src: SourceText, trailingNewline: boolean): string {
  const root = sourceTree(src.clean)
  const { text, indent, eol } = src
  const pad = (depth: number) => indent.repeat(depth)
  const verbatim = (node: SourceNode) => text.slice(node.start, node.end)
  const isOneLine = (node?: SourceNode) => !!node && !text.slice(node.start, node.end).includes('\n')
  /** ', ' or ',' between items of a one-line container, following how it was written */
  const inlineSep = (node: SourceNode) => {
    const v = verbatim(node)
    return /,\s/.test(v) || /^[{[]\s/.test(v) ? ', ' : ','
  }
  /** Leading whitespace of the line `pos` is on */
  const lineIndent = (pos: number) => {
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1
    return /^[ \t]*/.exec(text.slice(lineStart, pos))![0]
  }

  /**
   * Rewrite a container in place: changed children replaced, new ones appended after
   * the last existing child. Everything else (comments, spacing) stays as written.
   */
  const splice = (node: SourceNode, replacements: Replacement[], lastEnd: number, appended: string[], oneLine: boolean) => {
    let out = ''
    let pos = node.start
    for (const r of replacements.sort((a, b) => a.start - b.start)) {
      out += text.slice(pos, r.start) + r.text
      pos = r.end
    }
    if (appended.length) {
      out += text.slice(pos, lastEnd)
      pos = lastEnd
      const sep = oneLine ? inlineSep(node) : `,${eol}${lineIndent(lastEnd)}`
      out += appended.map((a) => sep + a).join('')
    }
    return out + text.slice(pos, node.end)
  }

  const emit = (v: unknown, node: SourceNode | undefined, depth: number, inline: boolean): string => {
    if (node && keyOf(v) === keyOf(node.value)) return verbatim(node)
    // Containers written on one line stay on one line
    const oneLine = inline || isOneLine(node)

    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      const originals = node?.items && Array.isArray(node.value) ? node.items : []
      // Same items in place (edited or not), maybe with more at the end: edit in place
      const inPlace =
        originals.length > 0 &&
        v.length >= originals.length &&
        originals.every((o, i) => {
          const item = v[i]
          if (keyOf(item) === keyOf(o.value)) return true
          if (isObj(item) && isObj(o.value)) return item.tag === o.value.tag
          return typeof item !== 'object' && typeof o.value !== 'object'
        })
      if (node && inPlace) {
        const replacements = originals
          .map((o, i) => ({ o, i }))
          .filter(({ o, i }) => keyOf(v[i]) !== keyOf(o.value))
          .map(({ o, i }) => ({ start: o.start, end: o.end, text: emit(v[i], o, depth + 1, oneLine) }))
        const appended = v.slice(originals.length).map((item) => emit(item, undefined, depth + 1, oneLine))
        return splice(node, replacements, originals[originals.length - 1].end, appended, oneLine)
      }
      // Otherwise rebuild the list, reusing each item's original text where possible
      const used = new Set<number>()
      const parts = v.map((item, idx) => {
        let match = originals.findIndex((o, j) => !used.has(j) && keyOf(o.value) === keyOf(item))
        // Edited objects are matched by tag, otherwise by position
        if (match < 0 && isObj(item) && typeof item.tag === 'string') {
          match = originals.findIndex((o, j) => !used.has(j) && isObj(o.value) && o.value.tag === item.tag)
        }
        if (match < 0 && originals[idx] && !used.has(idx) && typeof originals[idx].value === typeof item) match = idx
        if (match >= 0) used.add(match)
        return emit(item, match >= 0 ? originals[match] : undefined, depth + 1, oneLine)
      })
      if (oneLine) {
        const sep = node ? inlineSep(node) : ', '
        return `[${parts.join(sep)}]`
      }
      const inner = node && originals.length ? lineIndent(originals[0].start) : pad(depth + 1)
      const outer = node ? lineIndent(node.start) : pad(depth)
      return `[${eol}${inner}${parts.join(`,${eol}${inner}`)}${eol}${outer}]`
    }

    if (isObj(v)) {
      const keys = Object.keys(v)
      if (keys.length === 0) return '{}'
      const children = node?.keys && isObj(node.value) ? node.keys : undefined
      const member = (k: string, child?: SourceNode) => `${JSON.stringify(k)}: ${emit(v[k], child, depth + 1, oneLine)}`
      // Same keys in the same order, maybe with new ones at the end: edit in place
      const origKeys = children ? [...children.keys()] : []
      if (node && children && origKeys.length > 0 && origKeys.every((k, i) => keys[i] === k)) {
        const replacements = origKeys
          .filter((k) => keyOf(v[k]) !== keyOf(children.get(k)!.value))
          .map((k) => {
            const child = children.get(k)!
            return { start: child.start, end: child.end, text: emit(v[k], child, depth + 1, oneLine) }
          })
        const appended = keys.slice(origKeys.length).map((k) => member(k))
        return splice(node, replacements, children.get(origKeys[origKeys.length - 1])!.end, appended, oneLine)
      }
      const parts = keys.map((k) => member(k, children?.get(k)))
      if (oneLine) {
        const spaced = !node || /^\{\s/.test(verbatim(node))
        return spaced ? `{ ${parts.join(', ')} }` : `{${parts.join(',')}}`
      }
      const inner = node && origKeys.length ? lineIndent(children!.get(origKeys[0])!.start) : pad(depth + 1)
      const outer = node ? lineIndent(node.start) : pad(depth)
      return `{${eol}${inner}${parts.join(`,${eol}${inner}`)}${eol}${outer}}`
    }
    return JSON.stringify(v)
  }

  const body = emit(doc, root.value === undefined ? undefined : root, 0, false)
  // Keep whatever came before and after the top-level object (usually nothing)
  const before = root.value === undefined ? '' : text.slice(0, root.start)
  const after = root.value === undefined ? (trailingNewline ? eol : '') : text.slice(root.end)
  return before + body + after
}
