import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { FormLabel } from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type SchemeSource = 'current' | 'empty'

interface SchemeNameDialogProps {
  open: boolean
  mode: 'create' | 'rename'
  initialName?: string
  /** Lower-cased names already in use (excluding the scheme being renamed) */
  takenNames: string[]
  onClose: () => void
  onSubmit: (name: string, source: SchemeSource) => Promise<void>
}

function SchemeNameDialog({ open, mode, initialName = '', takenNames, onClose, onSubmit }: SchemeNameDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [source, setSource] = useState<SchemeSource>('current')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setSource('current')
      setTouched(false)
      setSubmitting(false)
    }
  }, [open, initialName])

  const trimmed = name.trim()
  const error = !trimmed
    ? t('hostsFile.nameRequired')
    : takenNames.includes(trimmed.toLowerCase())
      ? t('hostsFile.nameTaken')
      : null

  const handleSubmit = async () => {
    setTouched(true)
    if (error) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed, source)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {mode === 'create' ? t('hostsFile.createTitle') : t('hostsFile.renameTitle')}
        {mode === 'create' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('hostsFile.createSubtitle')}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, mt: 1 }}
        >
          <TextField
            autoFocus
            fullWidth
            label={t('hostsFile.nameLabel')}
            placeholder={t('hostsFile.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            error={touched && !!error}
            helperText={touched && error ? error : ' '}
            inputProps={{ maxLength: 64, spellCheck: false }}
          />
          {mode === 'create' && (
            <Box>
              <FormLabel sx={{ display: 'block', mb: 0.75 }}>{t('hostsFile.sourceLabel')}</FormLabel>
              <ToggleButtonGroup exclusive value={source} onChange={(_, v) => v && setSource(v)}>
                <ToggleButton value="current">{t('hostsFile.sourceCurrent')}</ToggleButton>
                <ToggleButton value="empty">{t('hostsFile.sourceEmpty')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={submitting}>
          {t('hostsFile.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting || (touched && !!error)}>
          {mode === 'create' ? t('hostsFile.create') : t('hostsFile.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default SchemeNameDialog
