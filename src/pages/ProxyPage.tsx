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
  Skeleton,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Add, DeleteOutline, EditOutlined, NetworkCheck, Refresh, RouterOutlined } from '@mui/icons-material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import {
  proxyApply,
  proxyDeleteProfile,
  proxySaveProfile,
  proxySetTargets,
  proxyState,
  testUrl,
  PROXY_DIRECT_ID,
  PROXY_STATE_CHANGED_EVENT,
  type ProxyApplyResult,
  type ProxyProfile,
  type ProxyTargetStatus,
  type UrlTestResult,
} from '../api/tauri'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import TestResult from '../components/devtools/TestResult'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { confirmAction } from '../lib/confirm'
import { sameUrl } from '../lib/devtools'
import { FONT_MONO } from '../theme'

const QUERY_KEY = ['proxyState']
/** Small endpoint used to check that a proxy reaches the internet */
const PROXY_TEST_URL = 'https://www.google.com/generate_204'
const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1'
const isProxyUrl = (v: string) => /^(https?|socks5h?):\/\/[^\s/]+(:\d+)?\/?$/.test(v)

const failed = (e: unknown): UrlTestResult => ({ ok: false, status: null, elapsed_ms: 0, message: errorMessage(e) })

function ProfileDialog({
  open,
  profile,
  takenNames,
  onClose,
  onSaved,
}: {
  open: boolean
  profile: ProxyProfile | null
  takenNames: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [noProxy, setNoProxy] = useState('')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<UrlTestResult | 'pending' | null>(null)

  useEffect(() => {
    if (open) {
      setName(profile?.name ?? '')
      setUrl(profile?.url ?? '')
      setNoProxy(profile ? profile.no_proxy : DEFAULT_NO_PROXY)
      setTouched(false)
      setTest(null)
    }
  }, [open, profile])

  const nameError = !name.trim()
    ? t('proxy.nameRequired')
    : takenNames.includes(name.trim().toLowerCase())
      ? t('proxy.nameTaken')
      : null
  const urlError = isProxyUrl(url.trim()) ? null : t('proxy.urlInvalid')

  const save = async () => {
    setTouched(true)
    if (nameError || urlError) return
    setSaving(true)
    try {
      await proxySaveProfile({ id: profile?.id, name: name.trim(), url: url.trim(), no_proxy: noProxy })
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
    setTest(await testUrl(PROXY_TEST_URL, url.trim()).catch(failed))
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{profile ? t('proxy.editTitle') : t('proxy.newTitle')}</DialogTitle>
      <DialogContent>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, mt: 1 }}
        >
          <TextField
            label={t('proxy.name')}
            value={name}
            autoFocus
            placeholder={t('proxy.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            error={touched && !!nameError}
            helperText={touched && nameError}
          />
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              label={t('proxy.url')}
              value={url}
              placeholder="http://127.0.0.1:7890"
              onChange={(e) => setUrl(e.target.value)}
              error={(touched || !!url.trim()) && !!urlError}
              helperText={(touched || !!url.trim()) && urlError ? urlError : t('proxy.urlHint')}
              inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
            />
            <Button
              sx={{ mt: 3.25, flexShrink: 0 }}
              startIcon={<NetworkCheck />}
              onClick={runTest}
              disabled={!!urlError || test === 'pending'}
            >
              {t('devtools.test')}
            </Button>
          </Box>
          {test && (
            <Box sx={{ mt: -1 }}>
              <TestResult result={test === 'pending' ? null : test} pending={test === 'pending'} />
            </Box>
          )}
          <TextField
            label={t('proxy.noProxy')}
            value={noProxy}
            placeholder={DEFAULT_NO_PROXY}
            onChange={(e) => setNoProxy(e.target.value)}
            helperText={t('proxy.noProxyHint')}
            inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
          />
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

function ProxyPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: state, isLoading, isFetching, error } = useQuery({ queryKey: QUERY_KEY, queryFn: proxyState })
  const reload = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })

  // The tray can switch profiles too
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    listen(PROXY_STATE_CHANGED_EVENT, () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }))
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [queryClient])

  const [dialog, setDialog] = useState<{ open: boolean; profile: ProxyProfile | null }>({ open: false, profile: null })
  const [applying, setApplying] = useState<string | null>(null)
  const [failures, setFailures] = useState<ProxyApplyResult[]>([])
  const [tests, setTests] = useState<Record<string, UrlTestResult | 'pending'>>({})

  const profiles = state?.profiles ?? []
  const activeId = state?.active_id ?? null
  const activeProfile = profiles.find((p) => p.id === activeId) ?? null

  const apply = async (id: string, name: string) => {
    setApplying(id)
    setFailures([])
    try {
      const results = await proxyApply(id)
      const bad = results.filter((r) => !r.ok)
      setFailures(bad)
      if (results.length === 0) toast(t('proxy.noTargets'), 'warning')
      else if (bad.length === 0) toast(t('proxy.applied', { name, count: results.length }))
      else toast(t('proxy.appliedPartly', { name, ok: results.length - bad.length, total: results.length }), 'warning')
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    } finally {
      setApplying(null)
      reload()
    }
  }

  const remove = async (profile: ProxyProfile) => {
    if (!(await confirmAction(t('proxy.deleteConfirm', { name: profile.name }), t('proxy.delete')))) return
    try {
      await proxyDeleteProfile(profile.id)
      reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }

  const testProfile = async (profile: ProxyProfile) => {
    setTests((r) => ({ ...r, [profile.id]: 'pending' }))
    const result = await testUrl(PROXY_TEST_URL, profile.url).catch(failed)
    setTests((r) => ({ ...r, [profile.id]: result }))
  }

  const toggleTarget = async (target: ProxyTargetStatus, included: boolean) => {
    if (!state) return
    const next = state.targets.filter((x) => (x.id === target.id ? included : x.included)).map((x) => x.id)
    queryClient.setQueryData(QUERY_KEY, {
      ...state,
      targets: state.targets.map((x) => (x.id === target.id ? { ...x, included } : x)),
    })
    try {
      await proxySetTargets(next)
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
      reload()
    }
  }

  /** Whether a target already matches the active profile */
  const matches = (target: ProxyTargetStatus) => {
    if (!activeId || !target.available || !target.included) return null
    if (activeId === PROXY_DIRECT_ID) return !target.current
    return !!activeProfile && sameUrl(target.current, activeProfile.url)
  }

  const activeChip = <Chip label={t('devtools.current')} color="success" />

  return (
    <Box sx={{ maxWidth: 820 }}>
      <PageHeader
        title={t('proxy.title')}
        description={t('proxy.subtitle')}
        actions={
          <>
            <Button startIcon={<Refresh />} onClick={reload} disabled={isFetching}>
              {t('hosts.refresh')}
            </Button>
            <Button variant="contained" startIcon={<Add />} onClick={() => setDialog({ open: true, profile: null })}>
              {t('proxy.newProfile')}
            </Button>
          </>
        }
      />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {String(error)}
        </Alert>
      ) : null}

      {failures.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setFailures([])}>
          {t('proxy.someFailed')}
          {failures.map((f) => (
            <Box key={f.target} component="span" sx={{ display: 'block', fontSize: '0.8125rem' }}>
              {t(`proxy.targets.${f.target}`)}: {f.message}
            </Box>
          ))}
        </Alert>
      )}

      {isLoading ? (
        [0, 1].map((i) => <Skeleton key={i} variant="rounded" height={160} sx={{ mb: 3 }} />)
      ) : (
        <>
          <Section title={t('proxy.profiles')}>
            <Row
              leading={<RouterOutlined color="disabled" />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {t('proxy.direct')}
                  {activeId === PROXY_DIRECT_ID && activeChip}
                </Box>
              }
              description={t('proxy.directHint')}
              control={
                <Button
                  size="small"
                  onClick={() => apply(PROXY_DIRECT_ID, t('proxy.direct'))}
                  disabled={!!applying}
                >
                  {applying === PROXY_DIRECT_ID ? t('proxy.applying') : t('proxy.apply')}
                </Button>
              }
            />
            {profiles.length === 0 ? (
              <EmptyState
                icon={<RouterOutlined />}
                title={t('proxy.empty')}
                description={t('proxy.emptyHint')}
                action={
                  <Button startIcon={<Add />} onClick={() => setDialog({ open: true, profile: null })}>
                    {t('proxy.newProfile')}
                  </Button>
                }
              />
            ) : (
              profiles.map((profile) => {
                const active = profile.id === activeId
                const test = tests[profile.id]
                return (
                  <Row
                    key={profile.id}
                    leading={<RouterOutlined color={active ? 'success' : 'action'} />}
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        {profile.name}
                        {active && activeChip}
                      </Box>
                    }
                    description={
                      <>
                        <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>
                          {profile.url}
                        </Box>
                        {profile.no_proxy && (
                          <Box component="span" sx={{ display: 'block', fontSize: '0.75rem' }}>
                            {t('proxy.bypass')}: {profile.no_proxy}
                          </Box>
                        )}
                      </>
                    }
                    control={
                      <>
                        <TestResult result={test === 'pending' ? null : test} pending={test === 'pending'} />
                        <Tooltip title={t('proxy.test')}>
                          <IconButton size="small" onClick={() => testProfile(profile)} disabled={test === 'pending'}>
                            <NetworkCheck />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('proxy.edit')}>
                          <IconButton size="small" onClick={() => setDialog({ open: true, profile })}>
                            <EditOutlined />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('proxy.delete')}>
                          <IconButton size="small" color="error" onClick={() => remove(profile)}>
                            <DeleteOutline />
                          </IconButton>
                        </Tooltip>
                        <Button
                          size="small"
                          variant={active ? 'outlined' : 'contained'}
                          onClick={() => apply(profile.id, profile.name)}
                          disabled={!!applying}
                        >
                          {applying === profile.id ? t('proxy.applying') : active ? t('proxy.reapply') : t('proxy.apply')}
                        </Button>
                      </>
                    }
                  />
                )
              })
            )}
          </Section>

          <Section title={t('proxy.applyTo')}>
            {state?.targets.map((target) => {
              const match = matches(target)
              return (
                <Row
                  key={target.id}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      {t(`proxy.targets.${target.id}`)}
                      {!target.available ? (
                        <Chip label={t('devtools.notInstalledShort')} />
                      ) : match === true ? (
                        <Chip label={t('proxy.inSync')} color="success" />
                      ) : match === false ? (
                        <Chip label={t('proxy.outOfSync')} color="warning" />
                      ) : null}
                    </Box>
                  }
                  description={
                    <>
                      <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>
                        {target.available ? (target.current ?? t('proxy.notSet')) : '—'}
                      </Box>
                      <Box component="span" sx={{ display: 'block', fontSize: '0.75rem' }}>
                        {t(`proxy.targetHints.${target.id}`)} · {target.location}
                      </Box>
                    </>
                  }
                  control={
                    <Tooltip title={t('proxy.include')}>
                      <span>
                        <Switch
                          checked={target.included && target.available}
                          disabled={!target.available}
                          onChange={(e) => toggleTarget(target, e.target.checked)}
                        />
                      </span>
                    </Tooltip>
                  }
                />
              )
            })}
          </Section>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 0.25 }}>
            {t('proxy.restartNote')}
          </Typography>
        </>
      )}

      <ProfileDialog
        open={dialog.open}
        profile={dialog.profile}
        takenNames={profiles.filter((p) => p.id !== dialog.profile?.id).map((p) => p.name.toLowerCase())}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onSaved={() => {
          toast(t('devtools.saved'))
          reload()
        }}
      />
    </Box>
  )
}

export default ProxyPage
