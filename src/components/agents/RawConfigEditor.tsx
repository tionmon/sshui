import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Paper, Skeleton, Typography, useTheme } from '@mui/material'
import { SaveOutlined, Undo } from '@mui/icons-material'
import Editor from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentConfig, agentSaveConfig, type AgentId } from '../../api/tauri'
import { useToast, errorMessage } from '../../contexts/ToastContext'
import { editorOptions, editorTheme, setupMonaco } from '../../lib/monaco'
import { FONT_MONO } from '../../theme'

/** Edits an agent's whole config file; the backend validates it before saving. */
function RawConfigEditor({ agent, onSaved }: { agent: AgentId; onSaved: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const theme = useTheme()
  const queryClient = useQueryClient()
  const key = ['agentConfig', agent]
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => agentConfig(agent) })
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  useEffect(() => setDraft(data?.content ?? ''), [data?.content])
  const dirty = draft !== (data?.content ?? '')

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await agentSaveConfig(agent, draft)
      toast(t('devtools.saved'))
      await queryClient.invalidateQueries({ queryKey: key })
      onSaved()
    } catch (e) {
      setSaveError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  return (
    <>
      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{String(error)}</Alert> : null}
      <Paper
        variant="outlined"
        sx={(th) => ({ overflow: 'hidden', boxShadow: `0 1px 2px rgba(0,0,0,.05), ${th.tokens.edge}` })}
      >
        <Box
          sx={(th) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            height: 44,
            borderBottom: `1px solid ${th.tokens.border}`,
          })}
        >
          <Typography noWrap sx={{ flex: 1, fontFamily: FONT_MONO, fontSize: '0.75rem', color: 'text.secondary' }}>
            {data?.path}
            {dirty && ' •'}
          </Typography>
          <Button size="small" variant="text" startIcon={<Undo />} onClick={() => setDraft(data?.content ?? '')} disabled={!dirty || saving}>
            {t('agents.revert')}
          </Button>
          <Button size="small" variant="contained" startIcon={<SaveOutlined />} onClick={save} disabled={!dirty || saving}>
            {t('devtools.save')}
          </Button>
        </Box>
        <Box sx={{ height: 520 }}>
          {isLoading ? (
            <Box sx={{ p: 2 }}>
              {[260, 180, 300].map((w, i) => (
                <Skeleton key={i} width={w} height={18} />
              ))}
            </Box>
          ) : (
            <Editor
              height="100%"
              language={agent === 'codex' ? 'ini' : 'json'}
              theme={editorTheme(theme.palette.mode)}
              beforeMount={setupMonaco}
              onMount={(editor, monaco) => {
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
              }}
              value={draft}
              onChange={(v) => setDraft(v ?? '')}
              options={editorOptions}
            />
          )}
        </Box>
      </Paper>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1, px: 0.25 }}>
        {t('agents.rawHint', { format: agent === 'codex' ? 'TOML' : 'JSON' })}
      </Typography>
    </>
  )
}

export default RawConfigEditor
