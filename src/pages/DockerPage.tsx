import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Add, DeleteOutline, Login, Logout, Speed, ViewInArOutlined } from '@mui/icons-material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ask } from '@tauri-apps/plugin-dialog'
import { dockerInfo, dockerLogin, dockerLogout, dockerSetMirrors, testUrl, type UrlTestResult } from '../api/tauri'
import DevToolPage from '../components/devtools/DevToolPage'
import TestResult from '../components/devtools/TestResult'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { useDevTools, dockerPingUrl, TOOL_INFO_STALE_MS } from '../lib/devtools'
import { FONT_MONO } from '../theme'

const INFO_KEY = ['dockerInfo']
const DOCKER_HUB = 'https://index.docker.io/v1/'
const isUrl = (v: string) => /^https?:\/\/\S+$/.test(v)

function DockerPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: tools } = useDevTools()
  const installed = !!tools?.docker.installed
  const { data: info, isLoading, error } = useQuery({
    queryKey: INFO_KEY,
    queryFn: dockerInfo,
    enabled: installed,
    staleTime: TOOL_INFO_STALE_MS,
  })
  const reload = () => queryClient.invalidateQueries({ queryKey: INFO_KEY })
  const fail = (e: unknown) => toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')

  // ── Login ──
  const [loginOpen, setLoginOpen] = useState(false)
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  const openLogin = () => {
    setServer('')
    setUsername('')
    setPassword('')
    setLoginOpen(true)
  }
  const submitLogin = async () => {
    setLoggingIn(true)
    try {
      await dockerLogin(server, username, password)
      toast(t('docker.loggedIn'))
      setLoginOpen(false)
      await reload()
    } catch (e) {
      fail(e)
    } finally {
      setPassword('')
      setLoggingIn(false)
    }
  }
  const logout = async (registry: string) => {
    if (!(await ask(t('docker.logoutConfirm', { registry: registryName(registry) }), { title: t('docker.logout'), kind: 'warning' }))) return
    try {
      await dockerLogout(registry === DOCKER_HUB ? '' : registry)
      toast(t('docker.loggedOut'))
      await reload()
    } catch (e) {
      fail(e)
    }
  }
  const registryName = (s: string) => (s === DOCKER_HUB ? 'Docker Hub' : s)

  // ── Mirrors ──
  const [mirrors, setMirrors] = useState<string[]>([])
  const [newMirror, setNewMirror] = useState('')
  const [results, setResults] = useState<Record<string, UrlTestResult | null>>({})
  const [testing, setTesting] = useState(false)
  const [savingMirrors, setSavingMirrors] = useState(false)
  const savedMirrors = info?.registry_mirrors ?? []
  useEffect(() => setMirrors(info?.registry_mirrors ?? []), [info?.registry_mirrors])
  const mirrorsDirty = JSON.stringify(mirrors) !== JSON.stringify(savedMirrors)

  const testMirrors = async () => {
    setTesting(true)
    setResults({})
    await Promise.all(
      mirrors.map(async (m) => {
        const r = await testUrl(dockerPingUrl(m)).catch((e) => ({ ok: false, status: null, elapsed_ms: 0, message: errorMessage(e) }))
        setResults((prev) => ({ ...prev, [m]: r }))
      }),
    )
    setTesting(false)
  }
  const saveMirrors = async () => {
    setSavingMirrors(true)
    try {
      await dockerSetMirrors(mirrors)
      toast(t('docker.mirrorsSaved'))
      await reload()
    } catch (e) {
      fail(e)
    } finally {
      setSavingMirrors(false)
    }
  }
  const addMirror = () => {
    const url = newMirror.trim()
    if (isUrl(url) && !mirrors.includes(url)) setMirrors([...mirrors, url])
    setNewMirror('')
  }

  return (
    <DevToolPage
      tool="docker"
      title="Docker"
      description={info?.version ? `${t('docker.subtitle')} · ${info.version}` : t('docker.subtitle')}
      icon={<ViewInArOutlined />}
      installUrl="https://www.docker.com/products/docker-desktop/"
      infoKey={INFO_KEY}
      configPath={info?.config_path}
      loading={isLoading}
      error={error}
    >
      {info && (
        <>
          <Section
            title={t('docker.registries')}
            action={
              <Button size="small" startIcon={<Login />} onClick={openLogin}>
                {t('docker.login')}
              </Button>
            }
          >
            {info.registries.length === 0 ? (
              <Row label={t('docker.noRegistries')} description={t('docker.noRegistriesHint')} />
            ) : (
              info.registries.map((r) => (
                <Row
                  key={r.server}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      {registryName(r.server)}
                      <Chip label={r.store} variant="outlined" />
                    </Box>
                  }
                  description={r.username ? t('docker.asUser', { user: r.username }) : t('docker.unknownUser')}
                  control={
                    <Button size="small" color="error" startIcon={<Logout />} onClick={() => logout(r.server)}>
                      {t('docker.logout')}
                    </Button>
                  }
                />
              ))
            )}
            <Row
              label={t('docker.credsStore')}
              description={
                info.creds_store ? (
                  t('docker.credsStoreHelper', { helper: info.creds_store })
                ) : (
                  t('docker.credsStoreFile')
                )
              }
            />
          </Section>

          <Section
            title={t('docker.mirrors')}
            action={
              mirrors.length > 0 && (
                <Button size="small" startIcon={<Speed />} onClick={testMirrors} disabled={testing}>
                  {t('devtools.testSpeed')}
                </Button>
              )
            }
          >
            <Box sx={{ px: 2.5, py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('docker.mirrorsHint')}
              </Typography>
              {mirrors.length === 0 ? (
                <Typography variant="body2" sx={{ mt: 1.5 }}>
                  {t('docker.noMirrors')}
                </Typography>
              ) : (
                <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {mirrors.map((m) => (
                    <Box key={m} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Typography sx={{ flex: 1, fontFamily: FONT_MONO, fontSize: '0.8125rem' }} noWrap>
                        {m}
                      </Typography>
                      <TestResult result={results[m]} pending={testing && !(m in results)} />
                      <Tooltip title={t('devtools.remove')}>
                        <IconButton size="small" color="error" onClick={() => setMirrors(mirrors.filter((x) => x !== m))}>
                          <DeleteOutline />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ))}
                </Box>
              )}
              <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                <TextField
                  fullWidth
                  value={newMirror}
                  placeholder="https://mirror.example.com"
                  onChange={(e) => setNewMirror(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addMirror()}
                  error={!!newMirror.trim() && !isUrl(newMirror.trim())}
                  inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
                />
                <Button startIcon={<Add />} onClick={addMirror} disabled={!isUrl(newMirror.trim())}>
                  {t('devtools.add')}
                </Button>
                <Button variant="contained" onClick={saveMirrors} disabled={!mirrorsDirty || savingMirrors}>
                  {t('devtools.save')}
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                {t('docker.daemonFile')}: <Box component="span" sx={{ fontFamily: FONT_MONO }}>{info.daemon_path}</Box>
              </Typography>
            </Box>
          </Section>

          {info.current_context && (
            <Section title={t('docker.cli')}>
              <Row label={t('docker.context')} description={<Box component="span" sx={{ fontFamily: FONT_MONO }}>{info.current_context}</Box>} />
            </Section>
          )}

          <Dialog open={loginOpen} onClose={() => !loggingIn && setLoginOpen(false)} maxWidth="xs" fullWidth>
            <DialogTitle>
              {t('docker.loginTitle')}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('docker.loginHint')}
              </Typography>
            </DialogTitle>
            <DialogContent>
              <Box
                component="form"
                onSubmit={(e) => {
                  e.preventDefault()
                  submitLogin()
                }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, mt: 1 }}
              >
                <TextField
                  label={t('docker.server')}
                  value={server}
                  placeholder="Docker Hub"
                  onChange={(e) => setServer(e.target.value)}
                  helperText={t('docker.serverHint')}
                  inputProps={{ spellCheck: false }}
                />
                <TextField
                  label={t('docker.username')}
                  value={username}
                  autoFocus
                  onChange={(e) => setUsername(e.target.value)}
                  inputProps={{ spellCheck: false, autoComplete: 'off' }}
                />
                <TextField
                  label={t('docker.password')}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  helperText={t('docker.passwordHint')}
                  inputProps={{ autoComplete: 'off' }}
                />
                <button type="submit" hidden />
              </Box>
            </DialogContent>
            <DialogActions>
              <Button variant="text" onClick={() => setLoginOpen(false)} disabled={loggingIn}>
                {t('hostsFile.cancel')}
              </Button>
              <Button variant="contained" onClick={submitLogin} disabled={!username.trim() || !password || loggingIn}>
                {loggingIn ? t('docker.loggingIn') : t('docker.login')}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </DevToolPage>
  )
}

export default DockerPage
