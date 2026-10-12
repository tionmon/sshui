import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Skeleton,
  TextField,
  Tooltip,
} from '@mui/material'
import { Add, CloudOutlined, DeleteOutline, EditOutlined, NetworkCheck, VerifiedOutlined } from '@mui/icons-material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import {
  agentApplyProfile,
  agentDeleteProfile,
  agentImportLive,
  agentProfiles,
  agentSaveProfile,
  testUrl,
  AGENT_OFFICIAL_ID,
  AGENT_PROFILES_CHANGED_EVENT,
  type AgentId,
  type AgentProfile,
  type AgentProfileView,
  type UrlTestResult,
} from '../../api/tauri'
import { Section, Row } from '../SettingsSection'
import TestResult from '../devtools/TestResult'
import { useToast, errorMessage } from '../../contexts/ToastContext'
import { confirmAction } from '../../lib/confirm'
import { FONT_MONO } from '../../theme'

const EMPTY: AgentProfile = {
  id: '',
  name: '',
  base_url: '',
  auth: 'token',
  model: '',
  opus_model: '',
  sonnet_model: '',
  haiku_model: '',
  wire_api: 'responses',
}
const isUrl = (v: string) => /^https?:\/\/\S+$/.test(v.trim())
const mono = { spellCheck: false, style: { fontFamily: FONT_MONO } }

function ProfileDialog({
  agent,
  open,
  initial,
  taken,
  onClose,
  onSaved,
}: {
  agent: AgentId
  open: boolean
  initial: AgentProfileView | null
  taken: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [p, setP] = useState<AgentProfile>(EMPTY)
  const [key, setKey] = useState('')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<UrlTestResult | 'pending' | null>(null)
  const official = initial?.id === AGENT_OFFICIAL_ID
  const editingKey = !!initial?.key_hint

  useEffect(() => {
    if (!open) return
    setP(initial ? { ...EMPTY, ...initial, auth: initial.auth || 'token', wire_api: initial.wire_api || 'responses' } : EMPTY)
    setKey('')
    setTouched(false)
    setTest(null)
  }, [open, initial])

  const field = (k: keyof AgentProfile) => ({
    value: p[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value }),
  })
  const nameError = !p.name.trim() ? t('proxy.nameRequired') : taken.includes(p.name.trim().toLowerCase()) ? t('proxy.nameTaken') : null
  const urlError = official || isUrl(p.base_url) ? null : t('devtools.invalidUrl')

  const save = async () => {
    setTouched(true)
    if (nameError || urlError) return
    setSaving(true)
    try {
      // An empty key field keeps the saved key when editing
      await agentSaveProfile(agent, p, key.trim() ? key.trim() : editingKey ? null : '')
      onSaved()
      onClose()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTest('pending')
    setTest(
      await testUrl(p.base_url.trim()).catch((e) => ({ ok: false, status: null, elapsed_ms: 0, message: errorMessage(e) })),
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? t('agentProfiles.editTitle') : t('agentProfiles.newTitle')}</DialogTitle>
      <DialogContent>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, mt: 1 }}
        >
          {!official && (
            <>
              <TextField
                label={t('proxy.name')}
                autoFocus
                placeholder={t('agentProfiles.namePlaceholder')}
                {...field('name')}
                error={touched && !!nameError}
                helperText={touched && nameError}
              />
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  fullWidth
                  label={t('agentProfiles.baseUrl')}
                  placeholder={agent === 'claude' ? 'https://api.example.com' : 'https://api.example.com/v1'}
                  {...field('base_url')}
                  error={(touched || !!p.base_url) && !!urlError}
                  helperText={(touched || !!p.base_url) && urlError ? urlError : t(`agentProfiles.baseUrlHint.${agent}`)}
                  inputProps={mono}
                />
                <Button sx={{ mt: 3.25, flexShrink: 0 }} startIcon={<NetworkCheck />} onClick={runTest} disabled={!!urlError || test === 'pending'}>
                  {t('devtools.test')}
                </Button>
              </Box>
              {test && (
                <Box sx={{ mt: -1 }}>
                  <TestResult result={test === 'pending' ? null : test} pending={test === 'pending'} />
                </Box>
              )}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  fullWidth
                  type="password"
                  label={t('agentProfiles.apiKey')}
                  value={key}
                  placeholder={editingKey ? t('agentProfiles.keepKey', { hint: initial?.key_hint }) : 'sk-…'}
                  onChange={(e) => setKey(e.target.value)}
                  helperText={t('agentProfiles.keyHint')}
                  inputProps={{ ...mono, autoComplete: 'off' }}
                />
                {agent === 'claude' && (
                  <TextField select label={t('agentProfiles.keyType')} {...field('auth')} sx={{ width: 220, flexShrink: 0 }}>
                    <MenuItem value="token">AUTH_TOKEN (Bearer)</MenuItem>
                    <MenuItem value="apikey">API_KEY (x-api-key)</MenuItem>
                  </TextField>
                )}
                {agent === 'codex' && (
                  <TextField select label="wire_api" {...field('wire_api')} sx={{ width: 160, flexShrink: 0 }}>
                    <MenuItem value="responses">responses</MenuItem>
                    <MenuItem value="chat">chat</MenuItem>
                  </TextField>
                )}
              </Box>
            </>
          )}
          <TextField
            label={t('agentProfiles.model')}
            placeholder={agent === 'claude' ? 'claude-opus-5-5' : 'gpt-5-codex'}
            {...field('model')}
            helperText={t('agentProfiles.modelHint')}
            inputProps={mono}
          />
          {agent === 'claude' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
              <TextField label="Opus" {...field('opus_model')} inputProps={mono} />
              <TextField label="Sonnet" {...field('sonnet_model')} inputProps={mono} />
              <TextField label="Haiku" {...field('haiku_model')} inputProps={mono} />
            </Box>
          )}
          <button type="submit" hidden />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={saving}>
          {t('hostsFile.cancel')}
        </Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {t('devtools.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Saved endpoint/key/model profiles for an agent, switched with one click. */
function AgentProfiles({ agent, onApplied }: { agent: AgentId; onApplied: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const key = ['agentProfiles', agent]
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => agentProfiles(agent) })
  const reload = () => queryClient.invalidateQueries({ queryKey: key })
  const [dialog, setDialog] = useState<{ open: boolean; initial: AgentProfileView | null }>({ open: false, initial: null })
  const [applying, setApplying] = useState<string | null>(null)

  // The tray can switch profiles too
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    listen(AGENT_PROFILES_CHANGED_EVENT, () => {
      queryClient.invalidateQueries({ queryKey: key })
      onApplied()
    })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent])

  const apply = async (p: AgentProfileView) => {
    setApplying(p.id)
    try {
      await agentApplyProfile(agent, p.id)
      toast(t(`agentProfiles.applied.${agent}`, { name: p.name }))
      await reload()
      onApplied()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    } finally {
      setApplying(null)
    }
  }
  const remove = async (p: AgentProfileView) => {
    if (!(await confirmAction(t('agentProfiles.deleteConfirm', { name: p.name }), t('proxy.delete')))) return
    try {
      await agentDeleteProfile(agent, p.id)
      reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }
  const importLive = async () => {
    const taken = new Set(data?.profiles.map((p) => p.name.toLowerCase()))
    let name = t('agentProfiles.importedName')
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${t('agentProfiles.importedName')} ${i}`
    try {
      await agentImportLive(agent, name)
      toast(t('agentProfiles.imported', { name }))
      reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }

  const describe = (p: AgentProfileView) => {
    const models = [p.model, p.opus_model && `opus ${p.opus_model}`, p.sonnet_model && `sonnet ${p.sonnet_model}`, p.haiku_model && `haiku ${p.haiku_model}`]
      .filter(Boolean)
      .join(' · ')
    return (
      <>
        {p.id === AGENT_OFFICIAL_ID ? (
          t(`agentProfiles.officialHint.${agent}`)
        ) : (
          <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>
            {p.base_url}
            {p.key_hint && ` · ${p.key_hint}`}
          </Box>
        )}
        {models && (
          <Box component="span" sx={{ display: 'block', fontFamily: FONT_MONO, fontSize: '0.75rem' }}>
            {models}
          </Box>
        )}
      </>
    )
  }

  return (
    <>
      <Section
        title={t('agentProfiles.title')}
        action={
          <Button size="small" startIcon={<Add />} onClick={() => setDialog({ open: true, initial: null })}>
            {t('proxy.newProfile')}
          </Button>
        }
      >
        {error ? <Alert severity="error" sx={{ borderRadius: 0 }}>{String(error)}</Alert> : null}
        {isLoading && <Skeleton variant="rectangular" height={120} />}
        {data && !data.current_id && (
          <Alert
            severity="info"
            sx={{ borderRadius: 0 }}
            action={
              data.live.base_url ? (
                <Button size="small" color="inherit" onClick={importLive}>
                  {t('agentProfiles.saveCurrent')}
                </Button>
              ) : undefined
            }
          >
            {data.live.base_url
              ? t('agentProfiles.unsavedLive', { url: data.live.base_url })
              : t('agentProfiles.modifiedLive')}
          </Alert>
        )}
        {data?.env_base_url && data.current_id === AGENT_OFFICIAL_ID && (
          <Alert
            severity="info"
            sx={{ borderRadius: 0 }}
            action={
              <Button size="small" color="inherit" onClick={importLive}>
                {t('agentProfiles.saveCurrent')}
              </Button>
            }
          >
            {t('agentProfiles.envBaseUrl', { url: data.env_base_url })}
          </Alert>
        )}
        {data?.profiles.map((p) => {
          const current = p.id === data.current_id
          const official = p.id === AGENT_OFFICIAL_ID
          return (
            <Row
              key={p.id}
              leading={official ? <VerifiedOutlined color={current ? 'success' : 'action'} /> : <CloudOutlined color={current ? 'success' : 'action'} />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {official ? t('agentProfiles.official') : p.name}
                  {current && <Chip label={t('devtools.current')} color="success" />}
                </Box>
              }
              description={describe(p)}
              control={
                <>
                  <Tooltip title={t('proxy.edit')}>
                    <IconButton size="small" onClick={() => setDialog({ open: true, initial: p })}>
                      <EditOutlined />
                    </IconButton>
                  </Tooltip>
                  {!official && (
                    <Tooltip title={t('proxy.delete')}>
                      <IconButton size="small" color="error" onClick={() => remove(p)}>
                        <DeleteOutline />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Button
                    size="small"
                    variant={current ? 'outlined' : 'contained'}
                    onClick={() => apply(p)}
                    disabled={!!applying}
                  >
                    {applying === p.id ? t('proxy.applying') : current ? t('proxy.reapply') : t('agentProfiles.use')}
                  </Button>
                </>
              }
            />
          )
        })}
      </Section>
      <ProfileDialog
        agent={agent}
        open={dialog.open}
        initial={dialog.initial}
        taken={(data?.profiles ?? []).filter((p) => p.id !== dialog.initial?.id).map((p) => p.name.toLowerCase())}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onSaved={() => {
          toast(t('devtools.saved'))
          reload()
        }}
      />
    </>
  )
}

export default AgentProfiles
