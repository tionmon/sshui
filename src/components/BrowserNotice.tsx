import { Box, Paper, Typography } from '@mui/material'
import { DesktopWindowsOutlined } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { FONT_MONO } from '../theme'

/**
 * Shown when the frontend is opened in a regular browser (e.g. the Vite URL
 * http://localhost:5173) instead of the Tauri window, where no backend exists.
 */
function BrowserNotice() {
  const { t } = useTranslation()

  return (
    <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
      <Paper
        variant="outlined"
        sx={(theme) => ({
          maxWidth: 460,
          p: 4,
          textAlign: 'center',
          boxShadow: `0 1px 2px rgba(0,0,0,.05), ${theme.tokens.edge}`,
        })}
      >
        <Box
          sx={(theme) => ({
            width: 48,
            height: 48,
            mx: 'auto',
            mb: 2,
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: theme.tokens.muted,
            color: 'text.secondary',
          })}
        >
          <DesktopWindowsOutlined />
        </Box>
        <Typography variant="h5">{t('common.browserTitle')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('common.browserBody')}
        </Typography>
        <Box
          component="code"
          sx={(theme) => ({
            display: 'inline-block',
            mt: 2,
            px: 1.5,
            py: 0.75,
            borderRadius: '8px',
            fontFamily: FONT_MONO,
            fontSize: '0.8125rem',
            bgcolor: theme.tokens.surface,
            border: `1px solid ${theme.tokens.border}`,
          })}
        >
          pnpm tauri dev
        </Box>
      </Paper>
    </Box>
  )
}

export default BrowserNotice
