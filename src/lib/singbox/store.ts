/**
 * The open sing-box config: the document as saved, the working copy, and undo/redo
 * history. Lives outside React so edits survive switching pages.
 */
import { useSyncExternalStore } from 'react'
import type { SingboxBinary, SingboxFile } from '../../api/tauri'
import { clone, parseConfig, type Obj } from './doc'
import { serializeLike, type SourceText } from './format'
import { normalizeMeta, reconcileMeta, type Snapshot } from './ops'

export interface Session {
  path: string
  /** Identifies the file contents we loaded, to detect changes made elsewhere */
  revision: string
  originalText: string
  indent: string
  trailingNewline: boolean
  /** Comments or trailing commas, which edited parts lose on save */
  lossy: boolean
  /** The saved text, so unedited parts are written back unchanged */
  source: SourceText
  binary: SingboxBinary | null
  saved: Snapshot
  current: Snapshot
  past: Snapshot[]
  future: Snapshot[]
}

const HISTORY_LIMIT = 100

const sourceOf = (p: ReturnType<typeof parseConfig>): SourceText => ({ text: p.text, clean: p.clean, indent: p.indent, eol: p.eol })

let session: Session | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useSingbox = () => useSyncExternalStore(subscribe, () => session)
export const getSession = () => session

/** Open a file read by the backend. Throws a ParseError for invalid JSON. */
export function loadFile(file: SingboxFile) {
  const parsed = parseConfig(file.text)
  const snapshot: Snapshot = { doc: parsed.doc, meta: normalizeMeta(file.meta) }
  reconcileMeta(snapshot)
  session = {
    path: file.path,
    revision: file.revision,
    originalText: file.text,
    indent: parsed.indent,
    trailingNewline: parsed.trailingNewline,
    lossy: parsed.lossy,
    source: sourceOf(parsed),
    binary: file.binary,
    saved: clone(snapshot),
    current: snapshot,
    past: [],
    future: [],
  }
  emit()
}

export function closeSession() {
  session = null
  emit()
}

/**
 * Apply an edit to a copy of the working document. If `fn` throws nothing changes.
 * Returns what `fn` returned.
 */
export function edit<R>(fn: (draft: Snapshot) => R): R {
  if (!session) throw new Error('No config is open')
  const draft = clone(session.current)
  const result = fn(draft)
  reconcileMeta(draft)
  if (JSON.stringify(draft) === JSON.stringify(session.current)) return result
  session = {
    ...session,
    current: draft,
    past: [...session.past, session.current].slice(-HISTORY_LIMIT),
    future: [],
  }
  emit()
  return result
}

/** Replace the whole document, e.g. from the JSON editor. */
export const replaceDoc = (doc: Obj) =>
  edit((s) => {
    s.doc = doc
  })

export function undo() {
  if (!session || session.past.length === 0) return
  const previous = session.past[session.past.length - 1]
  session = { ...session, current: previous, past: session.past.slice(0, -1), future: [session.current, ...session.future] }
  emit()
}

export function redo() {
  if (!session || session.future.length === 0) return
  const [next, ...rest] = session.future
  session = { ...session, current: next, past: [...session.past, session.current], future: rest }
  emit()
}

/** Throw away unsaved edits. */
export function revert() {
  if (!session) return
  session = { ...session, current: clone(session.saved), past: [...session.past, session.current], future: [] }
  emit()
}

export const textOf = (s: Session, doc: Obj = s.current.doc) => serializeLike(doc, s.source, s.trailingNewline)

const keyCache = new WeakMap<Snapshot, string>()
const keyOf = (s: Snapshot) => {
  let key = keyCache.get(s)
  if (key === undefined) {
    key = JSON.stringify(s)
    keyCache.set(s, key)
  }
  return key
}

export const isDirty = (s: Session | null) => !!s && keyOf(s.current) !== keyOf(s.saved)
/** Only SSHUI's notes changed (hidden/disabled), not the file itself */
export const fileChanged = (s: Session) => JSON.stringify(s.current.doc) !== JSON.stringify(s.saved.doc)

export function markSaved(text: string, revision: string) {
  if (!session) return
  const parsed = parseConfig(text)
  session = { ...session, originalText: text, revision, lossy: parsed.lossy, source: sourceOf(parsed), saved: clone(session.current) }
  emit()
}

export function setBinary(binary: SingboxBinary | null) {
  if (!session) return
  session = { ...session, binary }
  emit()
}
