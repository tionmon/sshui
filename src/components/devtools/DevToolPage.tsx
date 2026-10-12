import { Alert, Box, Button, Skeleton, Typography } from '@mui/material'
import { Refresh } from '@mui/icons-material'
import { useQueryClient } from '@tanstack/react-query'
import { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import PageHeader from '../PageHeader'
import ToolNotInstalled from './ToolNotInstalled'
import { useDevTools } from '../../lib/devtools'
import type { DevTools } from '../../api/tauri'
import { FONT_MONO } from '../../theme'

interface DevToolPageProps {
  tool: keyof DevTools
  title: string
  description: string
  icon: ReactNode
  installUrl: string
  /** react-query key of the page's config query, refreshed with the page */
  infoKey: string[]
  /** Config file shown at the bottom of the page */
  configPath?: string
  envOverrides?: Record<string, string>
  loading: boolean
  error?: unknown
  children: ReactNode
}

/**
 * Layout for a developer-tool page. Detection comes from the session cache; when the
 * tool is missing only the "not installed" view renders and nothing else is read.
 */
function DevToolPage({
  tool,
  title,
  description,
  icon,
  installUrl,
  infoKey,
  configPath,
  envOverrides,
  loading,
  error,
  children,
}: DevToolPageProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: tools, isLoading: detecting, isFetching: rechecking, recheck } = useDevTools()
  const installed = tools?.[tool].installed

  const refresh = async () => {
    await recheck()
    queryClient.invalidateQueries({ queryKey: infoKey })
  }

  const overrides = Object.entries(envOverrides ?? {})

  return (
    <Box sx={{ maxWidth: 820 }}>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button startIcon={<Refresh />} onClick={refresh} disabled={rechecking}>
            {t('hosts.refresh')}
          </Button>
        }
      />
      {detecting ? (
        <Skeleton variant="rounded" height={160} />
      ) : !installed ? (
        <ToolNotInstalled icon={icon} name={title} installUrl={installUrl} onRecheck={recheck} checking={rechecking} />
      ) : (
        <>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {String(error)}
            </Alert>
          ) : null}
          {overrides.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('devtools.envOverrides')}{' '}
              {overrides.map(([k, v]) => (
                <Box key={k} component="span" sx={{ display: 'block', fontFamily: FONT_MONO, fontSize: '0.75rem' }}>
                  {k}={v}
                </Box>
              ))}
            </Alert>
          )}
          {loading
            ? [0, 1].map((i) => <Skeleton key={i} variant="rounded" height={140} sx={{ mb: 3 }} />)
            : children}
          {configPath && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 0.25 }}>
              {t('devtools.configFile')}: <Box component="span" sx={{ fontFamily: FONT_MONO }}>{configPath}</Box>
            </Typography>
          )}
        </>
      )}
    </Box>
  )
}

export default DevToolPage
