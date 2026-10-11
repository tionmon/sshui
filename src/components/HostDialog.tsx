import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  MenuItem,
  Box,
  Typography,
  Tabs,
  Tab,
  Autocomplete,
} from '@mui/material'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { HostEntry } from '../api/tauri'
import { useToast } from '../contexts/ToastContext'
import { FONT_MONO } from '../theme'
import { scanSshKeys } from '../api/tauri'
import HostAdvancedOptions, {
  advancedFromHost,
  advancedToEntry,
  validateAdvanced,
  type AdvancedState,
} from './HostAdvancedOptions'

interface HostDialogProps {
  open: boolean
  host?: HostEntry
  onClose: () => void
  onSave: (host: HostEntry) => void
}

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ py: 2 }}>{children}</Box>}
    </div>
  )
}

function HostDialog({ open, host, onClose, onSave }: HostDialogProps) {
  const [tabValue, setTabValue] = useState(0)
  const [proxyType, setProxyType] = useState<'none' | 'jump' | 'socks5' | 'custom'>('none')
  const [socks5Host, setSocks5Host] = useState('')
  const [socks5Port, setSocks5Port] = useState('1080')
  const { t } = useTranslation()
  const toast = useToast()
  const [advanced, setAdvanced] = useState<AdvancedState>(() => advancedFromHost())
  const [showAdvancedErrors, setShowAdvancedErrors] = useState(false)
  const advancedErrors = validateAdvanced(advanced, t)

  // Fetch SSH keys for certificate dropdown
  const { data: sshKeys } = useQuery({
    queryKey: ['sshKeys'],
    queryFn: scanSshKeys,
    staleTime: 30000, // Cache for 30 seconds
  })

  const [formData, setFormData] = useState<HostEntry>({
    host: '',
    hostname: '',
    user: '',
    port: 22,
    identity_file: '',
    proxy_jump: '',
    proxy_command: '',
  })

  useEffect(() => {
    if (open) {
      setTabValue(0)
      setAdvanced(advancedFromHost(host))
      setShowAdvancedErrors(false)
    }
    if (host) {
      setFormData({
        ...host,
        port: host.port ?? 22, // 默认22端口
      })
      // Detect proxy type from existing config
      if (host.proxy_jump) {
        setProxyType('jump')
      } else if (host.proxy_command?.includes('nc -x')) {
        setProxyType('socks5')
        // Extract SOCKS5 host and port from ProxyCommand
        const match = host.proxy_command.match(/nc -x ([^:]+):(\d+)/)
        if (match) {
          setSocks5Host(match[1])
          setSocks5Port(match[2])
        }
      } else if (host.proxy_command) {
        setProxyType('custom')
      } else {
        setProxyType('none')
      }
    } else {
      setFormData({
        host: '',
        hostname: '',
        user: '',
        port: 22,
        identity_file: '',
        proxy_jump: '',
        proxy_command: '',
      })
      setProxyType('none')
      setSocks5Host('')
      setSocks5Port('1080')
    }
  }, [host, open])

  const handleChange = (field: keyof HostEntry, value: any) => {
    if (field === 'host') {
      // 过滤空格字符
      value = value.replace(/\s+/g, '')
    }
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleIdentityFileChange = (value: string | null) => {
    setFormData((prev) => ({ ...prev, identity_file: value || '' }))
  }

  const handleProxyTypeChange = (type: 'none' | 'jump' | 'socks5' | 'custom') => {
    setProxyType(type)
    if (type === 'none') {
      handleChange('proxy_jump', '')
      handleChange('proxy_command', '')
    } else if (type === 'jump') {
      handleChange('proxy_command', '')
    } else if (type === 'socks5') {
      handleChange('proxy_jump', '')
      updateSocks5ProxyCommand()
    } else if (type === 'custom') {
      handleChange('proxy_jump', '')
    }
  }

  const updateSocks5ProxyCommand = () => {
    if (socks5Host && socks5Port) {
      const proxyCommand = `nc -x ${socks5Host}:${socks5Port} %h %p`
      handleChange('proxy_command', proxyCommand)
    }
  }

  useEffect(() => {
    if (proxyType === 'socks5') {
      updateSocks5ProxyCommand()
    }
  }, [socks5Host, socks5Port])

  const handleSubmit = async () => {
    // Validate required fields
    const trimmedHost = formData.host.trim()
    const trimmedHostname = formData.hostname?.trim()
    const trimmedUser = formData.user?.trim()

    if (!trimmedHost) {
      toast(t('hostDialog.errorHostRequired'), 'error')
      return
    }

    if (!trimmedHostname) {
      toast(t('hostDialog.errorHostnameRequired'), 'error')
      return
    }

    if (!trimmedUser) {
      toast(t('hostDialog.errorUserRequired'), 'error')
      return
    }

    if (Object.keys(advancedErrors).length > 0) {
      setShowAdvancedErrors(true)
      setTabValue(2)
      toast(t('hostDialog.adv.fixErrors'), 'error')
      return
    }

    // 清理空字符串和默认值，转换为 null（而非 undefined），这样后端 Option<T> 会是 None
    const cleanedData: HostEntry = {
      host: trimmedHost,
      hostname: trimmedHostname,
      user: trimmedUser,
      port: formData.port === 22 ? undefined : formData.port, // 22 是默认端口，不保存
      identity_file: formData.identity_file?.trim() || undefined,
      proxy_jump: formData.proxy_jump?.trim() || undefined,
      proxy_command: formData.proxy_command?.trim() || undefined,
      ...advancedToEntry(advanced),
    }

    try {
      await onSave(cleanedData)
      // Only close dialog on success
      onClose()
    } catch (error) {
      // 解析后端返回的结构化错误码
      let errorMessage = String(error)
      try {
        const errorData = JSON.parse(String(error))
        if (errorData.code) {
          // 后端返回了结构化错误，根据 code 查翻译
          const translationKey = `validation.${errorData.code}`
          errorMessage = String(t(translationKey, errorData.params || {}))
        }
      } catch {
        // JSON 解析失败，直接显示原始错误
      }
      toast(`${t('validation.saveFailed')}: ${errorMessage}`, 'error')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {host ? t('hostDialog.titleEdit') : t('hostDialog.titleAdd')}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {host ? t('hostDialog.subtitleEdit') : t('hostDialog.subtitleAdd')}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mt: 1 }}>
          <Tab label={t('hostDialog.tabBasic')} />
          <Tab label={t('hostDialog.tabProxy')} />
          <Tab label={t('hostDialog.tabAdvanced')} />
        </Tabs>

        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                required
                label={t('hostDialog.fieldHost')}
                value={formData.host}
                onChange={(e) => handleChange('host', e.target.value)}
                helperText={t('hostDialog.fieldHostHelper')}
                inputProps={{
                  autoCapitalize: 'none',
                  autoCorrect: 'off',
                  spellCheck: false
                }}
              />
            </Grid>

            <Grid item xs={12} sm={8}>
              <TextField
                fullWidth
                label={t('hostDialog.fieldHostname')}
                value={formData.hostname || ''}
                onChange={(e) => handleChange('hostname', e.target.value)}
                helperText={t('hostDialog.fieldHostnameHelper')}
              />
            </Grid>

            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                type="number"
                label={t('hostDialog.fieldPort')}
                value={formData.port || 22}
                onChange={(e) => handleChange('port', parseInt(e.target.value))}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={t('hostDialog.fieldUser')}
                value={formData.user || ''}
                onChange={(e) => handleChange('user', e.target.value)}
                inputProps={{
                  autoCapitalize: 'none',
                  autoCorrect: 'off',
                  spellCheck: false
                }}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <Autocomplete
                fullWidth
                freeSolo
                options={sshKeys?.map((key) => key.path) || []}
                value={formData.identity_file || ''}
                onChange={(_, value) => handleIdentityFileChange(value)}
                onInputChange={(_, value) => handleIdentityFileChange(value)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('hostDialog.fieldIdentityFile')}
                    helperText={t('hostDialog.fieldIdentityFileHelper')}
                  />
                )}
                renderOption={(props, option) => {
                  const keyInfo = sshKeys?.find((key) => key.path === option)
                  return (
                    <li {...props} key={option}>
                      <Box>
                        <Typography variant="body2">{option}</Typography>
                        {keyInfo && (
                          <Typography variant="caption" color="text.secondary">
                            {keyInfo.key_type} {keyInfo.size ? `(${keyInfo.size} bits)` : ''}
                          </Typography>
                        )}
                      </Box>
                    </li>
                  )
                }}
              />
            </Grid>
          </Grid>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                select
                label={t('hostDialog.proxyType')}
                value={proxyType}
                onChange={(e) => handleProxyTypeChange(e.target.value as any)}
              >
                <MenuItem value="none">{t('hostDialog.proxyTypeNone')}</MenuItem>
                <MenuItem value="jump">{t('hostDialog.proxyTypeJump')}</MenuItem>
                <MenuItem value="socks5">{t('hostDialog.proxyTypeSocks5')}</MenuItem>
                <MenuItem value="custom">{t('hostDialog.proxyTypeCustom')}</MenuItem>
              </TextField>
            </Grid>

            {proxyType === 'jump' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label={t('hostDialog.fieldProxyJump')}
                  value={formData.proxy_jump || ''}
                  onChange={(e) => handleChange('proxy_jump', e.target.value)}
                  helperText={t('hostDialog.fieldProxyJumpHelper')}
                />
              </Grid>
            )}

            {proxyType === 'socks5' && (
              <>
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {t('hostDialog.socks5ConfigHint')}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={8}>
                  <TextField
                    fullWidth
                    label={t('hostDialog.fieldSocks5Host')}
                    value={socks5Host}
                    onChange={(e) => setSocks5Host(e.target.value)}
                    placeholder="127.0.0.1"
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    label={t('hostDialog.fieldSocks5Port')}
                    value={socks5Port}
                    onChange={(e) => setSocks5Port(e.target.value)}
                    placeholder="1080"
                  />
                </Grid>
                <Grid item xs={12}>
                  <Box
                    sx={(theme) => ({
                      bgcolor: theme.tokens.surface,
                      border: `1px solid ${theme.tokens.border}`,
                      px: 1.5,
                      py: 1.25,
                      borderRadius: '10px',
                    })}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {t('hostDialog.generatedProxyCommand')}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>
                      {formData.proxy_command || 'nc -x <host>:<port> %h %p'}
                    </Typography>
                  </Box>
                </Grid>
              </>
            )}

            {proxyType === 'custom' && (
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  label={t('hostDialog.fieldProxyCommand')}
                  value={formData.proxy_command || ''}
                  onChange={(e) => handleChange('proxy_command', e.target.value)}
                  helperText={t('hostDialog.fieldProxyCommandHelper')}
                />
              </Grid>
            )}
          </Grid>
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <HostAdvancedOptions
            value={advanced}
            onChange={setAdvanced}
            errors={showAdvancedErrors ? advancedErrors : {}}
          />
        </TabPanel>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>{t('hostDialog.cancel')}</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!formData.host}
        >
          {t('hostDialog.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default HostDialog
