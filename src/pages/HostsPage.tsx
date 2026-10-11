import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Add, EditOutlined, DeleteOutline, Search, Refresh, DnsOutlined } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadSshConfig, deleteHost, addHost, updateHost, type HostEntry } from '../api/tauri'
import HostDialog from '../components/HostDialog'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { confirmAction } from '../lib/confirm'
import { FONT_MONO } from '../theme'

function HostsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<HostEntry | undefined>()
  const queryClient = useQueryClient()
  const toast = useToast()
  const { t } = useTranslation()

  const { data: config, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['sshConfig'],
    queryFn: loadSshConfig,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sshConfig'] })
    queryClient.invalidateQueries({ queryKey: ['backups'] })
  }

  const addMutation = useMutation({ mutationFn: addHost, onSuccess: invalidate })

  const updateMutation = useMutation({
    mutationFn: ({ name, entry }: { name: string; entry: HostEntry }) => updateHost(name, entry),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({ mutationFn: deleteHost, onSuccess: invalidate })

  const hosts = (config?.hosts ?? []).filter((host) => host && host.host)
  const query = searchQuery.toLowerCase()
  const filteredHosts = hosts.filter(
    (host) =>
      host.host.toLowerCase().includes(query) ||
      host.hostname?.toLowerCase().includes(query) ||
      host.user?.toLowerCase().includes(query),
  )

  const handleDelete = async (hostName: string) => {
    try {
      const confirmed = await confirmAction(
        t('hosts.deleteConfirm', { hostName }),
        t('hosts.deleteConfirmTitle'),
      )
      if (!confirmed) return
      await deleteMutation.mutateAsync(hostName)
      toast(t('hosts.deleted'))
    } catch (error) {
      toast(`${t('hosts.deleteFailed')}: ${errorMessage(error)}`, 'error')
    }
  }

  const handleAdd = () => {
    setEditingHost(undefined)
    setDialogOpen(true)
  }

  const handleEdit = (host: HostEntry) => {
    setEditingHost(host)
    setDialogOpen(true)
  }

  // Errors propagate to HostDialog, which keeps the dialog open and reports them.
  const handleSave = async (host: HostEntry) => {
    if (editingHost) {
      await updateMutation.mutateAsync({ name: editingHost.host, entry: host })
    } else {
      await addMutation.mutateAsync(host)
    }
    toast(t('hosts.saved'))
  }

  const columns = [
    t('hosts.tableHost'),
    t('hosts.tableHostname'),
    t('hosts.tableUser'),
    t('hosts.tablePort'),
    t('hosts.tableProxy'),
  ]

  return (
    <Box>
      <PageHeader
        title={t('hosts.title')}
        description={t('hosts.subtitle')}
        meta={!isLoading && <Chip label={hosts.length} />}
        actions={
          <>
            <Button startIcon={<Refresh />} onClick={() => refetch()} disabled={isFetching}>
              {t('hosts.refresh')}
            </Button>
            <Button variant="contained" startIcon={<Add />} onClick={handleAdd}>
              {t('hosts.addHost')}
            </Button>
          </>
        }
      />

      <HostDialog
        open={dialogOpen}
        host={editingHost}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />

      <TableContainer component={Paper}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5 }}>
          <TextField
            placeholder={t('hosts.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ width: 300 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ fontSize: 16, color: 'text.secondary' }} />
                </InputAdornment>
              ),
            }}
            inputProps={{ autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }}
          />
          {searchQuery && (
            <Typography variant="body2" color="text.secondary">
              {t('hosts.count', { count: filteredHosts.length })}
            </Typography>
          )}
        </Box>
        <Table>
          <TableHead>
            <TableRow>
              {columns.map((label) => (
                <TableCell key={label}>{label}</TableCell>
              ))}
              <TableCell align="right" sx={{ width: 96 }}>
                {t('hosts.tableActions')}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              [0, 1, 2].map((i) => (
                <TableRow key={i}>
                  {[0, 1, 2, 3, 4, 5].map((j) => (
                    <TableCell key={j}>
                      <Skeleton width={j === 0 ? 120 : j === 5 ? 56 : 80} height={16} sx={{ ml: j === 5 ? 'auto' : 0 }} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredHosts.length > 0 ? (
              filteredHosts.map((host, index) => (
                <TableRow key={`${host.host}-${index}`} hover>
                  <TableCell>
                    <Typography variant="body1" fontWeight={500} noWrap>
                      {host.host}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>{host.hostname || '—'}</TableCell>
                  <TableCell sx={{ color: host.user ? 'text.primary' : 'text.secondary' }}>{host.user || '—'}</TableCell>
                  <TableCell sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>{host.port || 22}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {host.proxy_jump && <Chip label={t('hosts.proxyJump')} color="info" />}
                      {host.proxy_command && <Chip label={t('hosts.proxyCommand')} color="warning" />}
                      {!host.proxy_jump && !host.proxy_command && (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ py: 0.5 }}>
                    <Tooltip title={t('common.edit')}>
                      <IconButton size="small" onClick={() => handleEdit(host)}>
                        <EditOutlined />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('common.delete')}>
                      <IconButton size="small" color="error" onClick={() => handleDelete(host.host)}>
                        <DeleteOutline />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} sx={{ p: 0 }}>
                  <EmptyState
                    icon={searchQuery ? <Search /> : <DnsOutlined />}
                    title={searchQuery ? t('hosts.noHostsFound') : t('hosts.noHostsConfigured')}
                    description={searchQuery ? undefined : t('hosts.emptyHint')}
                    action={
                      !searchQuery && (
                        <Button variant="contained" startIcon={<Add />} onClick={handleAdd}>
                          {t('hosts.addHost')}
                        </Button>
                      )
                    }
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}

export default HostsPage
