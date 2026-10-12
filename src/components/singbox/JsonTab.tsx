import { Alert, Box, Button, Typography } from '@mui/material'
import { CheckOutlined, Undo } from '@mui/icons-material'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ParseError, parseConfig } from '../../lib/singbox/doc'
import { replaceDoc, textOf, useSingbox } from '../../lib/singbox/store'
import JsonEditor from './JsonEditor'

export interface JsonTabHandle {
  /** Apply pending edits; false (with an error shown) when the JSON is invalid */
  commit: () => boolean
}

/** The whole document as JSON, for anything the other tabs don't cover. */
const JsonTab = forwardRef<JsonTabHandle>(function JsonTab(_, ref) {
  const { t } = useTranslation()
  const session = useSingbox()
  const current = session ? textOf(session) : ''
  const [text, setText] = useState(current)
  const [error, setError] = useState<string | null>(null)

  // Follow undo/redo and other outside changes
  useEffect(() => {
    setText(current)
    setError(null)
  }, [current])

  const pending = text !== current
  const commit = () => {
    if (!pending) return true
    try {
      replaceDoc(parseConfig(text).doc)
      setError(null)
      return true
    } catch (e) {
      setError(e instanceof ParseError && e.line ? t('singbox.jsonErrorAt', { line: e.line, column: e.column, message: e.message }) : String(e instanceof Error ? e.message : e))
      return false
    }
  }
  useImperativeHandle(ref, () => ({ commit }))

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t('singbox.jsonTabHint')}
        </Typography>
        <Button size="small" startIcon={<Undo />} disabled={!pending} onClick={() => setText(current)}>
          {t('agents.revert')}
        </Button>
        <Button size="small" variant="contained" startIcon={<CheckOutlined />} disabled={!pending} onClick={commit}>
          {t('singbox.applyJson')}
        </Button>
      </Box>
      <JsonEditor value={text} onChange={setText} height="calc(100vh - 330px)" />
    </>
  )
})

export default JsonTab
