import type { BeforeMount } from '@monaco-editor/react'
import { darkTokens, lightTokens, FONT_MONO, type Tokens } from '../theme'

// Monaco wants 6/8-digit hex; flatten our rgba tokens onto the card colour.
const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')
const flatten = (rgba: string, base: string) => {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
  if (!m) return rgba
  const [r, g, b, a] = m.slice(1).map(Number)
  const br = parseInt(base.slice(1, 3), 16)
  const bg = parseInt(base.slice(3, 5), 16)
  const bb = parseInt(base.slice(5, 7), 16)
  return `#${hex(r * a + br * (1 - a))}${hex(g * a + bg * (1 - a))}${hex(b * a + bb * (1 - a))}`
}

const editorColors = (tk: Tokens) => ({
  'editor.background': tk.card,
  'editor.foreground': tk.foreground,
  'editorLineNumber.foreground': tk.mutedForeground + '99',
  'editorLineNumber.activeForeground': tk.foreground,
  'editor.lineHighlightBackground': flatten(tk.muted, tk.card),
  'editor.lineHighlightBorder': '#00000000',
  'editor.selectionBackground': tk.mutedForeground + '40',
  'editorCursor.foreground': tk.foreground,
  'editorIndentGuide.background1': flatten(tk.border, tk.card),
  'editorWidget.background': tk.popover,
  'editorWidget.border': flatten(tk.border, tk.card),
  'scrollbarSlider.background': tk.mutedForeground + '33',
  'scrollbarSlider.hoverBackground': tk.mutedForeground + '55',
  focusBorder: '#00000000',
})

const editorRules = (tk: Tokens) => [
  { token: 'comment', foreground: tk.mutedForeground.slice(1), fontStyle: 'italic' },
  { token: 'number.ip', foreground: tk.infoForeground.slice(1) },
]

/** Registers the SSHUI editor themes and the `hosts` language. Safe to call on every mount. */
export const setupMonaco: BeforeMount = (monaco) => {
  monaco.editor.defineTheme('sshui-light', {
    base: 'vs',
    inherit: true,
    rules: editorRules(lightTokens),
    colors: editorColors(lightTokens),
  })
  monaco.editor.defineTheme('sshui-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: editorRules(darkTokens),
    colors: editorColors(darkTokens),
  })

  if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === 'hosts')) {
    monaco.languages.register({ id: 'hosts' })
    monaco.languages.setMonarchTokensProvider('hosts', {
      tokenizer: {
        root: [
          [/#.*$/, 'comment'],
          [/^\s*[0-9a-fA-F:.%]+(?=\s|$)/, 'number.ip'],
          [/[^\s#]+/, 'identifier'],
        ],
      },
    })
    monaco.languages.setLanguageConfiguration('hosts', { comments: { lineComment: '#' } })
  }
}

export const editorTheme = (mode: 'light' | 'dark') => (mode === 'dark' ? 'sshui-dark' : 'sshui-light')

export const editorOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  lineHeight: 20,
  fontFamily: FONT_MONO,
  lineNumbers: 'on' as const,
  wordWrap: 'on' as const,
  renderLineHighlight: 'line' as const,
  scrollBeyondLastLine: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  padding: { top: 4, bottom: 4 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
}
