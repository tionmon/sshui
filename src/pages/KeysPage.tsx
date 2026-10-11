import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Box, Button, Chip, IconButton, Paper, Skeleton, Tooltip, Typography } from '@mui/material'
import {
  Add,
  Refresh,
  Fingerprint,
  LockOutlined,
  LockOpenOutlined,
  DeleteOutline,
  ContentCopy,
  VpnKeyOutlined,
} from '@mui/icons-material'
import { scanSshKeys, generateSshKey, deleteSshKey, readPublicKey, type KeyInfo } from '../api/tauri'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import GenerateKeyDialog from '../components/GenerateKeyDialog'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { confirmAction } from '../lib/confirm'
import { FONT_MONO } from '../theme'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'

const keyTypeColor = (keyType: string) => {
  switch (keyType) {
    case 'Ed25519':
      return 'success'
    case 'ECDSA':
      return 'info'
    case 'DSA':
      return 'warning'
    default:
      return 'default'
  }
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || path

function KeysPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const { t } = useTranslation()

  const { data: keys, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['sshKeys'],
    queryFn: scanSshKeys,
  })

  const generateMutation = useMutation({
    mutationFn: (params: { keyType: string; name: string; comment?: string; passphrase?: string; bits?: number }) =>
      generateSshKey(params.keyType, params.name, params.comment, params.passphrase, params.bits),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sshKeys'] })
      setDialogOpen(false)
      toast(t('keys.generateSuccess'))
    },
    onError: (error) => {
      toast(`${t('keys.generateFailed')} ${errorMessage(error)}`, 'error')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (path: string) => deleteSshKey(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sshKeys'] })
    },
  })

  const handleDelete = async (key: KeyInfo) => {
    try {
      const confirmed = await confirmAction(t('keys.deleteConfirm', { keyName: key.path }), t('keys.deleteConfirmTitle'))
      if (!confirmed) return
      await deleteMutation.mutateAsync(key.path)
      toast(t('keys.deleted'))
    } catch (error) {
      toast(`${t('keys.deleteFailed')}: ${errorMessage(error)}`, 'error')
    }
  }

  const handleCopyPublicKey = async (key: KeyInfo) => {
    try {
      const publicKeyContent = await readPublicKey(key.path)
      await writeText(publicKeyContent)
      toast(t('keys.copied'))
    } catch (error) {
      toast(`${t('keys.copyFailed')}: ${errorMessage(error)}`, 'error')
    }
  }

  const handleGenerate = async (keyType: string, name: string, comment?: string, passphrase?: string, bits?: number) => {
    await generateMutation.mutateAsync({ keyType, name, comment, passphrase, bits })
  }

  return (
    <Box>
      <PageHeader
        title={t('keys.title')}
        description={t('keys.subtitle')}
        meta={keys && <Chip label={keys.length} />}
        actions={
          <>
            <Button startIcon={<Refresh />} onClick={() => refetch()} disabled={isFetching}>
              {t('keys.refresh')}
            </Button>
            <Button variant="contained" startIcon={<Add />} onClick={() => setDialogOpen(true)}>
              {t('keys.generateKey')}
            </Button>
          </>
        }
      />

      <GenerateKeyDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onGenerate={handleGenerate} />

      <Paper variant="outlined" sx={(theme) => ({ boxShadow: `0 1px 2px rgba(0,0,0,.05), ${theme.tokens.edge}`, overflow: 'hidden' })}>
        {isLoading ? (
          [0, 1].map((i) => (
            <Box key={i} sx={{ display: 'flex', gap: 2, p: 2.5, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
              <Skeleton variant="rounded" width={36} height={36} />
              <Box sx={{ flex: 1 }}>
                <Skeleton width={160} height={18} />
                <Skeleton width={280} height={14} sx={{ mt: 1 }} />
              </Box>
            </Box>
          ))
        ) : keys && keys.length > 0 ? (
          keys.map((key, index) => (
            <Box
              key={key.path}
              sx={(theme) => ({
                display: 'flex',
                alignItems: 'flex-start',
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
                <VpnKeyOutlined sx={{ fontSize: 18 }} />
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle1" sx={{ mr: 0.5 }}>
                    {fileName(key.path)}
                  </Typography>
                  <Chip label={key.key_type} color={keyTypeColor(key.key_type)} />
                  {key.size && <Chip label={`${key.size} ${t('keys.bits')}`} variant="outlined" />}
                  {key.is_encrypted ? (
                    <Chip icon={<LockOutlined />} label={t('keys.encrypted')} color="success" />
                  ) : (
                    <Chip icon={<LockOpenOutlined />} label={t('keys.unencrypted')} variant="outlined" />
                  )}
                </Box>

                <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.5, fontFamily: FONT_MONO, fontSize: '0.75rem' }}>
                  {key.path}
                </Typography>

                {key.fingerprint && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1 }}>
                    <Fingerprint sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', wordBreak: 'break-all' }}
                    >
                      {key.fingerprint}
                    </Typography>
                  </Box>
                )}

                {(key.comment || key.created) && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                    {key.comment && `${t('keys.comment')}: ${key.comment}`}
                    {key.comment && key.created && ' · '}
                    {key.created && `${t('keys.created')}: ${new Date(key.created).toLocaleString()}`}
                  </Typography>
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                <Tooltip title={t('keys.copyToClipboard')}>
                  <IconButton size="small" onClick={() => handleCopyPublicKey(key)}>
                    <ContentCopy />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('common.delete')}>
                  <IconButton size="small" color="error" onClick={() => handleDelete(key)}>
                    <DeleteOutline />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          ))
        ) : (
          <EmptyState
            icon={<VpnKeyOutlined />}
            title={t('keys.noKeysFound')}
            action={
              <Button variant="contained" startIcon={<Add />} onClick={() => setDialogOpen(true)}>
                {t('keys.generateKey')}
              </Button>
            }
          />
        )}
      </Paper>
    </Box>
  )
}

export default KeysPage
