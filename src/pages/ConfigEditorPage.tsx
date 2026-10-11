import { Alert, Box, Button, Chip, Paper, Skeleton } from '@mui/material'
import { Save, Undo } from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Editor, { type BeforeMount } from '@monaco-editor/react'
import { useThemeMode } from '../contexts/ThemeContext'
import { useToast } from '../contexts/ToastContext'
import PageHeader from '../components/PageHeader'
import { darkTokens, lightTokens, FONT_MONO, type Tokens } from '../theme'
import { loadSshConfig, serializeSshConfig, parseSshConfig, saveSshConfig } from '../api/tauri'

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
  'focusBorder': '#00000000',
})

const defineThemes: BeforeMount = (monaco) => {
  monaco.editor.defineTheme('sshui-light', { base: 'vs', inherit: true, rules: [], colors: editorColors(lightTokens) })
  monaco.editor.defineTheme('sshui-dark', { base: 'vs-dark', inherit: true, rules: [], colors: editorColors(darkTokens) })
}

function ConfigEditorPage() {
  const [content, setContent] = useState('')
  const [hasChanges, setHasChanges] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  const { mode } = useThemeMode()
  const { t } = useTranslation()

  const { data: config, isLoading, error } = useQuery({
    queryKey: ['sshConfig'],
    queryFn: loadSshConfig,
  })

  const serializeMutation = useMutation({
    mutationFn: serializeSshConfig,
    onSuccess: (text) => {
      setContent(text)
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (text: string) => {
      const parsed = await parseSshConfig(text)
      await saveSshConfig(parsed)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sshConfig'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setHasChanges(false)
      setParseError(null)
      toast(t('config.saved'))
    },
    onError: (err) => {
      setParseError(err instanceof Error ? err.message : String(err))
    },
  })

  useEffect(() => {
    if (config) {
      serializeMutation.mutate(config)
    }
  }, [config])

  const handleSave = () => {
    saveMutation.mutate(content)
  }

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['sshConfig'] })
    setHasChanges(false)
    setParseError(null)
  }

  const handleEditorChange = (value: string | undefined) => {
    setContent(value || '')
    setHasChanges(true)
    setParseError(null)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      <PageHeader
        title={t('config.title')}
        description={t('config.infoMessage')}
        meta={hasChanges && <Chip label={t('config.unsaved')} color="warning" />}
        actions={
          <>
            <Button startIcon={<Undo />} onClick={handleRefresh} disabled={!hasChanges}>
              {t('config.reset')}
            </Button>
            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? t('config.saving') : t('config.save')}
            </Button>
          </>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('config.loadError')}: {(error as Error).message}
        </Alert>
      )}

      {parseError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('config.parseError')}: {parseError}
        </Alert>
      )}

      <Paper
        variant="outlined"
        sx={(theme) => ({
          flex: 1,
          minHeight: 320,
          overflow: 'hidden',
          py: 1.5,
          bgcolor: theme.tokens.card,
          boxShadow: `0 1px 2px rgba(0,0,0,.05), ${theme.tokens.edge}`,
        })}
      >
        {isLoading ? (
          <Box sx={{ px: 3 }}>
            {[220, 160, 260, 140, 200].map((w, i) => (
              <Skeleton key={i} width={w} height={18} sx={{ mb: 1 }} />
            ))}
          </Box>
        ) : (
          <Editor
            height="100%"
            defaultLanguage="ini"
            theme={mode === 'dark' ? 'sshui-dark' : 'sshui-light'}
            beforeMount={defineThemes}
            value={content}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineHeight: 20,
              fontFamily: FONT_MONO,
              lineNumbers: 'on',
              wordWrap: 'on',
              renderLineHighlight: 'line',
              scrollBeyondLastLine: false,
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              padding: { top: 4, bottom: 4 },
              scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
            }}
          />
        )}
      </Paper>
    </Box>
  )
}

export default ConfigEditorPage
