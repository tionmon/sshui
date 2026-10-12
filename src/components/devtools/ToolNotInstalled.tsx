import { Box, Button, Paper } from '@mui/material'
import { OpenInNew, Refresh } from '@mui/icons-material'
import { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import EmptyState from '../EmptyState'
import { openExternalUrl } from '../../api/tauri'

interface ToolNotInstalledProps {
  icon: ReactNode
  name: string
  installUrl: string
  onRecheck: () => void
  checking: boolean
}

/** Shown instead of a tool's page when it isn't on PATH; nothing is read from disk. */
function ToolNotInstalled({ icon, name, installUrl, onRecheck, checking }: ToolNotInstalledProps) {
  const { t } = useTranslation()
  return (
    <Paper variant="outlined" sx={(theme) => ({ boxShadow: `0 1px 2px rgba(0,0,0,.05), ${theme.tokens.edge}` })}>
      <EmptyState
        icon={icon}
        title={t('devtools.notInstalled', { name })}
        description={t('devtools.notInstalledHint', { name })}
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button startIcon={<Refresh />} onClick={onRecheck} disabled={checking}>
              {t('devtools.checkAgain')}
            </Button>
            <Button variant="contained" endIcon={<OpenInNew />} onClick={() => openExternalUrl(installUrl)}>
              {t('devtools.install', { name })}
            </Button>
          </Box>
        }
      />
    </Paper>
  )
}

export default ToolNotInstalled
