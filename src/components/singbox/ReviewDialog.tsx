import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
  useTheme,
} from '@mui/material'
import { CheckCircleOutline, ErrorOutline } from '@mui/icons-material'
import { DiffEditor } from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { singboxCheck, singboxOpen, singboxSave, type SingboxCheck } from '../../api/tauri'
import { fileChanged, getSession, loadFile, markSaved, textOf, useSingbox } from '../../lib/singbox/store'
import type { Problem } from '../../lib/singbox/validate'
import { editorOptions, editorTheme, setupMonaco } from '../../lib/monaco'
import { useToast, errorMessage } from '../../contexts/ToastContext'
import { FONT_MONO } from '../../theme'
import { problemText } from './common'

/** Shows the diff, runs `sing-box check`, then saves (with conflict detection). */
function ReviewDialog({ open, problems, onClose }: { open: boolean; problems: Problem[]; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const theme = useTheme()
  const session = useSingbox()
  const [check, setCheck] = useState<SingboxCheck | 'running' | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = session ? fileChanged(session) : false
  // Unchanged documents are written back byte for byte (only SSHUI's notes changed)
  const text = session ? (changed ? textOf(session) : session.originalText) : ''

  useEffect(() => {
    if (!open || !session) return
    setConflict(false)
    setError(null)
    if (!changed) {
      setCheck(null)
      return
    }
    setCheck('running')
    let cancelled = false
    singboxCheck(session.path, text)
      .then((r) => !cancelled && setCheck(r))
      .catch((e) => !cancelled && setCheck({ available: true, ok: false, output: errorMessage(e) }))
    return () => {
      cancelled = true
    }
    // Run once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!session) return null
  const errors = problems.filter((p) => p.level === 'error')
  const checkFailed = check !== null && check !== 'running' && check.available && !check.ok
  const risky = errors.length > 0 || checkFailed

  const save = async (force = false) => {
    setSaving(true)
    setError(null)
    try {
      const s = getSession()!
      const result = await singboxSave(s.path, text, s.current.meta, s.revision, force)
      if (result.status === 'conflict') {
        setConflict(true)
        return
      }
      markSaved(text, result.revision)
      toast(t('singbox.savedToast'))
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const reload = async () => {
    try {
      loadFile(await singboxOpen(session.path))
      toast(t('singbox.reloaded'))
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{t('singbox.reviewTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {conflict && (
            <Alert
              severity="error"
              action={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" color="inherit" onClick={reload}>
                    {t('singbox.reloadDiscard')}
                  </Button>
                  <Button size="small" color="inherit" onClick={() => save(true)}>
                    {t('singbox.overwrite')}
                  </Button>
                </Box>
              }
            >
              {t('singbox.conflict')}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {session.lossy && changed && <Alert severity="warning">{t('singbox.lossyWarning')}</Alert>}

          {errors.length > 0 && (
            <Alert severity="error">
              {t('singbox.reviewErrors', { count: errors.length })}
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {errors.slice(0, 6).map((p, i) => (
                  <li key={i}>{problemText(t, p)}</li>
                ))}
              </Box>
            </Alert>
          )}

          {changed ? (
            <>
              {check === 'running' && (
                <Alert severity="info" icon={<CircularProgress size={16} />}>
                  {t('singbox.checking')}
                </Alert>
              )}
              {check && check !== 'running' && !check.available && <Alert severity="info">{t('singbox.noBinary')}</Alert>}
              {check && check !== 'running' && check.available && (
                <Alert severity={check.ok ? 'success' : 'error'} icon={check.ok ? <CheckCircleOutline /> : <ErrorOutline />}>
                  {check.ok ? t('singbox.checkOk') : t('singbox.checkFailed')}
                  {!check.ok && check.output && (
                    <Box component="pre" sx={{ m: 0, mt: 0.75, fontFamily: FONT_MONO, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto' }}>
                      {check.output}
                    </Box>
                  )}
                </Alert>
              )}
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                <Box sx={{ height: 440 }}>
                  <DiffEditor
                    height="100%"
                    language="json"
                    theme={editorTheme(theme.palette.mode)}
                    beforeMount={setupMonaco}
                    original={session.originalText}
                    modified={text}
                    options={{ ...editorOptions, readOnly: true, renderSideBySide: false, originalEditable: false, wordWrap: 'off', hideUnchangedRegions: { enabled: true } }}
                  />
                </Box>
              </Paper>
              <Typography variant="caption" color="text.secondary">
                {t('singbox.reviewHint', { path: session.path })}
              </Typography>
            </>
          ) : (
            <Alert severity="info">{t('singbox.notesOnly')}</Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" color={risky ? 'warning' : 'primary'} onClick={() => save()} disabled={saving || check === 'running' || conflict}>
          {risky ? t('singbox.saveAnyway') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ReviewDialog
