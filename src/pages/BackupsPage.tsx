import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, IconButton, Paper, Skeleton, Tooltip, Typography } from '@mui/material'
import { Restore, DeleteOutline, Refresh, HistoryOutlined } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { listBackups, restoreBackup, deleteBackup, loadSettings, type BackupInfo } from '../api/tauri'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { confirmAction } from '../lib/confirm'
import { FONT_MONO } from '../theme'

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Format: YYYYMMDD_HHMMSS
const formatTimestamp = (timestamp: string) => {
  const year = timestamp.substring(0, 4)
  const month = timestamp.substring(4, 6)
  const day = timestamp.substring(6, 8)
  const hour = timestamp.substring(9, 11)
  const minute = timestamp.substring(11, 13)
  const second = timestamp.substring(13, 15)
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function BackupsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { t } = useTranslation()

  const { data: backups, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['backups'],
    queryFn: listBackups,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: loadSettings,
  })

  const restoreMutation = useMutation({
    mutationFn: restoreBackup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      queryClient.invalidateQueries({ queryKey: ['sshConfig'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteBackup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
  })

  const handleRestore = async (backupId: number) => {
    try {
      const confirmed = await confirmAction(t('backups.restoreConfirmOverwrite'), t('backups.restoreConfirmTitle'))
      if (!confirmed) return
      await restoreMutation.mutateAsync(backupId)
      toast(t('backups.restored'))
    } catch (error) {
      toast(`${t('backups.restoreFailed')}: ${errorMessage(error)}`, 'error')
    }
  }

  const handleDelete = async (backupId: number) => {
    try {
      const confirmed = await confirmAction(t('backups.deleteConfirm'), t('backups.deleteConfirmTitle'))
      if (!confirmed) return
      await deleteMutation.mutateAsync(backupId)
      toast(t('backups.deleted'))
    } catch (error) {
      toast(`${t('backups.deleteFailed')}: ${errorMessage(error)}`, 'error')
    }
  }

  return (
    <Box>
      <PageHeader
        title={t('backups.title')}
        description={t('backups.subtitle')}
        meta={backups && <Chip label={backups.length} />}
        actions={
          <Button startIcon={<Refresh />} onClick={() => refetch()} disabled={isFetching}>
            {t('backups.refresh')}
          </Button>
        }
      />

      <Alert severity="info" sx={{ mb: 2 }}>
        {t('backups.infoMessage', { limit: settings?.backup_limit || 10 })}
      </Alert>

      <Paper variant="outlined" sx={(theme) => ({ boxShadow: `0 1px 2px rgba(0,0,0,.05), ${theme.tokens.edge}`, overflow: 'hidden' })}>
        {isLoading ? (
          [0, 1, 2].map((i) => (
            <Box key={i} sx={{ display: 'flex', gap: 2, p: 2.5, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
              <Skeleton variant="rounded" width={36} height={36} />
              <Box sx={{ flex: 1 }}>
                <Skeleton width={180} height={18} />
                <Skeleton width={320} height={14} sx={{ mt: 1 }} />
              </Box>
            </Box>
          ))
        ) : backups && backups.length > 0 ? (
          backups.map((backup: BackupInfo, index) => (
            <Box
              key={backup.id}
              sx={(theme) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2.5,
                py: 2,
                borderTop: index ? `1px solid ${theme.tokens.border}` : 0,
                transition: 'background-color .1s',
                '&:hover': { bgcolor: theme.tokens.accent },
              })}
            >
              <Box
                sx={(theme) => ({
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  borderRadius: '10px',
                  border: `1px solid ${theme.tokens.border}`,
                  bgcolor: theme.tokens.muted,
                  color: 'text.secondary',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <HistoryOutlined sx={{ fontSize: 18 }} />
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle1" sx={{ mr: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                    {formatTimestamp(backup.timestamp)}
                  </Typography>
                  <Chip label={`${backup.host_count} ${t('backups.hosts')}`} />
                  <Chip label={formatBytes(backup.size_bytes)} variant="outlined" />
                </Box>
                <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.5, fontFamily: FONT_MONO, fontSize: '0.75rem' }}>
                  {backup.file_path}
                </Typography>
                <Tooltip title={backup.config_hash} placement="bottom-start">
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25, fontFamily: FONT_MONO, opacity: 0.8 }}>
                    {t('backups.hash')}: {backup.config_hash.slice(0, 16)}…
                  </Typography>
                </Tooltip>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <Button size="small" startIcon={<Restore />} onClick={() => handleRestore(backup.id)}>
                  {t('backups.restore')}
                </Button>
                <Tooltip title={t('common.delete')}>
                  <IconButton size="small" color="error" onClick={() => handleDelete(backup.id)}>
                    <DeleteOutline />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          ))
        ) : (
          <EmptyState icon={<HistoryOutlined />} title={t('backups.noBackupsFound')} />
        )}
      </Paper>
    </Box>
  )
}

export default BackupsPage
