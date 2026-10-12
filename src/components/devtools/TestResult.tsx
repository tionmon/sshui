import { Box, CircularProgress } from '@mui/material'
import { CheckCircleOutline, ErrorOutline } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { UrlTestResult } from '../../api/tauri'

/** Compact latency / reachability text for a URL test. */
function TestResult({ result, pending }: { result?: UrlTestResult | null; pending?: boolean }) {
  const { t } = useTranslation()
  if (pending) return <CircularProgress size={14} />
  if (!result) return null
  const slow = result.ok && result.elapsed_ms > 1500
  return (
    <Box
      component="span"
      title={result.message || (result.status ? `HTTP ${result.status}` : undefined)}
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        fontSize: '0.8125rem',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        color: !result.ok
          ? theme.tokens.destructiveForeground
          : slow
            ? theme.tokens.warningForeground
            : theme.tokens.successForeground,
        '& svg': { fontSize: 15 },
      })}
    >
      {result.ok ? <CheckCircleOutline /> : <ErrorOutline />}
      {result.ok ? t('devtools.latency', { ms: result.elapsed_ms }) : t('devtools.unreachable')}
    </Box>
  )
}

export default TestResult
