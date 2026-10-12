import { Box, Button, TextField, Typography } from '@mui/material'
import { ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FONT_MONO } from '../../theme'

interface ConfigFieldProps {
  label: string
  description?: ReactNode
  /** The value currently saved in the config file (null = not set) */
  value: string | null
  placeholder?: string
  onSave: (value: string | null) => Promise<void>
  /** Return an error message for an invalid draft */
  validate?: (value: string) => string | null
  /** Extra controls next to Save, e.g. a Test button; receives the current draft */
  extra?: (draft: string) => ReactNode
  /** Shown under the field (e.g. a test result) */
  footer?: ReactNode
  type?: 'text' | 'password'
  mono?: boolean
}

/** One editable config value: text field with Save and Clear. */
function ConfigField({
  label,
  description,
  value,
  placeholder,
  onSave,
  validate,
  extra,
  footer,
  type = 'text',
  mono = true,
}: ConfigFieldProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(value ?? ''), [value])

  const trimmed = draft.trim()
  const error = trimmed && validate ? validate(trimmed) : null
  const dirty = trimmed !== (value ?? '')

  const save = async (next: string | null) => {
    setSaving(true)
    try {
      await onSave(next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box sx={{ px: 2.5, py: 2 }}>
      <Typography variant="body1" fontWeight={500}>
        {label}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
          {description}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 1.5 }}>
        <TextField
          fullWidth
          type={type}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          error={!!error}
          helperText={error}
          inputProps={{ spellCheck: false, autoComplete: 'off', style: mono ? { fontFamily: FONT_MONO } : undefined }}
        />
        {extra?.(trimmed)}
        <Button variant="contained" onClick={() => save(trimmed || null)} disabled={!dirty || !!error || saving}>
          {t('devtools.save')}
        </Button>
        {value && (
          <Button variant="text" color="error" onClick={() => save(null)} disabled={saving}>
            {t('devtools.clear')}
          </Button>
        )}
      </Box>
      {footer}
    </Box>
  )
}

export default ConfigField
