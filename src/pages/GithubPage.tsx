import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Skeleton,
  TextField,
  Typography,
} from '@mui/material'
import {
  CheckCircleOutline,
  ContentCopy,
  ErrorOutline,
  GitHub,
  Login,
  Logout,
  NetworkCheck,
  OpenInNew,
  Refresh,
  Save,
  VerifiedUserOutlined,
} from '@mui/icons-material'
import { useEffect, useState, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { listen } from '@tauri-apps/api/event'
import { ask } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import {
  githubLogin,
  githubLoginCancel,
  githubLogout,
  githubSetGitIdentity,
  githubSetGitProxy,
  githubSshTest,
  githubStatus,
  githubTestProxy,
  githubTrustHostKeys,
  openExternalUrl,
  GITHUB_LOGIN_CODE_EVENT,
  type ProxyTestResult,
  type SshTestResult,
} from '../api/tauri'
import PageHeader from '../components/PageHeader'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { FONT_MONO } from '../theme'

const QUERY_KEY = ['githubStatus']

function StatusText({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'flex-start',
        gap: 0.5,
        color: ok ? theme.tokens.successForeground : theme.tokens.destructiveForeground,
        '& svg': { fontSize: 15, mt: '2px', flexShrink: 0 },
      })}
    >
      {ok ? <CheckCircleOutline /> : <ErrorOutline />}
      <span>{children}</span>
    </Box>
  )
}

const Mono = ({ children }: { children: ReactNode }) => (
  <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>
    {children}
  </Box>
)

function GithubPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fail = (e: unknown) => toast(`${t('github.failed')}: ${errorMessage(e)}`, 'error')

  const { data: status, isLoading, isFetching, refetch } = useQuery({ queryKey: QUERY_KEY, queryFn: githubStatus })
  const reload = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })

  // ── Login ──
  const [login, setLogin] = useState<{ code: string | null } | null>(null)

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    listen<{ code: string; url: string }>(GITHUB_LOGIN_CODE_EVENT, (e) => setLogin({ code: e.payload.code }))
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const startLogin = async () => {
    setLogin({ code: null })
    try {
      await githubLogin()
      toast(t('github.signedIn'))
    } catch (e) {
      if (errorMessage(e) !== 'cancelled') fail(e)
    } finally {
      setLogin(null)
      reload()
    }
  }

  const cancelLogin = () => {
    githubLoginCancel().catch(() => {})
    setLogin(null)
  }

  const logout = async (account: string) => {
    if (!(await ask(t('github.signOutConfirm', { login: account }), { title: t('github.signOut'), kind: 'warning' }))) return
    try {
      await githubLogout(account)
      toast(t('github.signedOut'))
    } catch (e) {
      fail(e)
    }
    reload()
  }

  // ── SSH ──
  const [sshTest, setSshTest] = useState<SshTestResult | null>(null)
  const [sshBusy, setSshBusy] = useState(false)
  const [trusting, setTrusting] = useState(false)

  const runSshTest = async () => {
    setSshBusy(true)
    try {
      setSshTest(await githubSshTest())
    } catch (e) {
      setSshTest({ status: 'error', user: null, message: errorMessage(e) })
    } finally {
      setSshBusy(false)
    }
  }

  const trustKeys = async () => {
    setTrusting(true)
    try {
      const added = await githubTrustHostKeys()
      toast(t('github.hostKeysAdded', { count: added }))
      reload()
    } catch (e) {
      fail(e)
    } finally {
      setTrusting(false)
    }
  }

  // ── Git identity ──
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [savingIdentity, setSavingIdentity] = useState(false)
  const savedName = status?.git.user_name ?? ''
  const savedEmail = status?.git.user_email ?? ''
  useEffect(() => {
    setName(savedName)
    setEmail(savedEmail)
  }, [savedName, savedEmail])
  const identityDirty = name.trim() !== savedName || email.trim() !== savedEmail
  const emailInvalid = !!email.trim() && !/^[^\s@]+@[^\s@]+$/.test(email.trim())

  const saveIdentity = async () => {
    setSavingIdentity(true)
    try {
      await githubSetGitIdentity(name.trim(), email.trim())
      toast(t('github.identitySaved'))
      await reload()
    } catch (e) {
      fail(e)
    } finally {
      setSavingIdentity(false)
    }
  }

  // ── Proxy ──
  const savedProxy = status?.git.https_proxy ?? status?.git.http_proxy ?? ''
  const proxiesDiffer =
    !!status?.git.http_proxy && !!status?.git.https_proxy && status.git.http_proxy !== status.git.https_proxy
  const [proxy, setProxy] = useState('')
  const [proxyTest, setProxyTest] = useState<(ProxyTestResult & { tested: string }) | null>(null)
  const [proxyBusy, setProxyBusy] = useState<null | 'test' | 'save'>(null)
  useEffect(() => setProxy(savedProxy), [savedProxy])

  const testProxy = async () => {
    setProxyBusy('test')
    try {
      const value = proxy.trim()
      setProxyTest({ ...(await githubTestProxy(value || null)), tested: value })
    } catch (e) {
      fail(e)
    } finally {
      setProxyBusy(null)
    }
  }

  const saveProxy = async (value: string | null) => {
    setProxyBusy('save')
    try {
      await githubSetGitProxy(value)
      toast(value ? t('github.proxySaved') : t('github.proxyCleared'))
      await reload()
    } catch (e) {
      fail(e)
    } finally {
      setProxyBusy(null)
    }
  }

  const accounts = status?.gh.accounts ?? []
  const helper = status?.git.credential_helper ?? ''
  // e.g. !'C:\Program Files\GitHub CLI\gh.exe' auth git-credential, or !/usr/bin/gh auth git-credential
  const helperUsesGh = /gh(\.exe)?['"]?\s+auth\s+git-credential/i.test(helper)
  const envProxy = Object.entries(status?.env_proxy ?? {})

  const sshDescription = () => {
    if (!sshTest) return t('github.sshTestHint')
    if (sshTest.status === 'ok') return <StatusText ok>{t('github.sshOk', { user: sshTest.user })}</StatusText>
    if (sshTest.status === 'denied') {
      return (
        <Box>
          <StatusText ok={false}>{t('github.sshDenied')}</StatusText>
          <Box sx={{ mt: 0.75, display: 'flex', gap: 2 }}>
            <Link component="button" variant="body2" onClick={() => openExternalUrl('https://github.com/settings/ssh/new')}>
              {t('github.addKeyOnGithub')}
            </Link>
            <Link component="button" variant="body2" onClick={() => navigate('/keys')}>
              {t('github.copyPublicKey')}
            </Link>
          </Box>
        </Box>
      )
    }
    return <StatusText ok={false}>{sshTest.message || t('github.failed')}</StatusText>
  }

  if (isLoading) {
    return (
      <Box sx={{ maxWidth: 760 }}>
        <PageHeader title="GitHub" description={t('github.subtitle')} />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" height={120} sx={{ mb: 3 }} />
        ))}
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 760 }}>
      <PageHeader
        title="GitHub"
        description={t('github.subtitle')}
        actions={
          <Button startIcon={<Refresh />} onClick={() => refetch()} disabled={isFetching}>
            {t('hosts.refresh')}
          </Button>
        }
      />

      {/* Account */}
      <Section
        title={t('github.account')}
        action={
          status?.gh.installed &&
          accounts.length > 0 && (
            <Button size="small" startIcon={<Login />} onClick={startLogin} disabled={!!login}>
              {t('github.addAccount')}
            </Button>
          )
        }
      >
        {!status?.gh.installed ? (
          <Row
            leading={<GitHub sx={{ fontSize: 28, color: 'text.secondary' }} />}
            label={t('github.cliMissing')}
            description={t('github.cliMissingHint')}
            control={
              <Button endIcon={<OpenInNew />} onClick={() => openExternalUrl('https://cli.github.com/')}>
                {t('github.getCli')}
              </Button>
            }
          />
        ) : accounts.length === 0 ? (
          <Row
            leading={<GitHub sx={{ fontSize: 28, color: 'text.secondary' }} />}
            label={t('github.notSignedIn')}
            description={t('github.notSignedInHint')}
            control={
              <Button variant="contained" startIcon={<Login />} onClick={startLogin} disabled={!!login}>
                {t('github.signIn')}
              </Button>
            }
          />
        ) : (
          accounts.map((account) => (
            <Row
              key={account.login}
              leading={
                <Avatar
                  src={`https://github.com/${account.login}.png?size=80`}
                  alt={account.login}
                  sx={(theme) => ({ width: 36, height: 36, border: `1px solid ${theme.tokens.border}` })}
                >
                  {account.login[0]?.toUpperCase()}
                </Avatar>
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                  {account.login}
                  {account.active && <Chip label={t('github.active')} color="success" />}
                  {account.state !== 'success' && <Chip label={t('github.tokenInvalid')} color="error" />}
                </Box>
              }
              description={
                <>
                  {t('github.tokenInfo', { source: account.token_source || '—', protocol: account.git_protocol || '—' })}
                  {account.scopes.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.75 }}>
                      {account.scopes.map((scope) => (
                        <Chip key={scope} label={scope} variant="outlined" sx={{ fontFamily: FONT_MONO }} />
                      ))}
                    </Box>
                  )}
                </>
              }
              control={
                <>
                  <Button size="small" endIcon={<OpenInNew />} onClick={() => openExternalUrl(`https://github.com/${account.login}`)}>
                    {t('github.profile')}
                  </Button>
                  <Button size="small" color="error" startIcon={<Logout />} onClick={() => logout(account.login)}>
                    {t('github.signOut')}
                  </Button>
                </>
              }
            />
          ))
        )}
        {status?.git.installed && (
          <Row
            label={t('github.gitHttps')}
            description={
              helperUsesGh ? (
                <StatusText ok>{t('github.gitHttpsGh')}</StatusText>
              ) : helper ? (
                <>
                  {t('github.gitHttpsOther')} <Mono>{helper}</Mono>
                </>
              ) : (
                t('github.gitHttpsNone')
              )
            }
          />
        )}
      </Section>

      {/* SSH */}
      <Section title={t('github.ssh')}>
        <Row
          label={t('github.hostKey')}
          description={status?.known_host ? <StatusText ok>{t('github.hostKeyKnown')}</StatusText> : t('github.hostKeyUnknown')}
          control={
            status?.known_host ? (
              <Chip icon={<VerifiedUserOutlined />} label={t('github.trusted')} color="success" />
            ) : (
              <Button onClick={trustKeys} disabled={trusting} startIcon={trusting ? <CircularProgress size={14} /> : <VerifiedUserOutlined />}>
                {t('github.trustKeys')}
              </Button>
            )
          }
        />
        <Row
          label={t('github.sshAuth')}
          description={sshDescription()}
          control={
            <Button onClick={runSshTest} disabled={sshBusy} startIcon={sshBusy ? <CircularProgress size={14} /> : <NetworkCheck />}>
              {sshBusy ? t('github.testing') : t('github.test')}
            </Button>
          }
        />
      </Section>

      {/* Git identity */}
      {status?.git.installed && (
        <Section title={t('github.identity')}>
          <Box sx={{ px: 2.5, py: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('github.identityHint')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 1.5, alignItems: 'end' }}>
              <TextField label="user.name" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ spellCheck: false }} />
              <TextField
                label="user.email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={emailInvalid}
                inputProps={{ spellCheck: false }}
              />
              <Button
                variant="contained"
                startIcon={<Save />}
                onClick={saveIdentity}
                disabled={!identityDirty || emailInvalid || savingIdentity}
              >
                {t('github.save')}
              </Button>
            </Box>
          </Box>
        </Section>
      )}

      {/* Proxy */}
      <Section title={t('github.proxy')}>
        {status?.git.installed && (
          <Box sx={{ px: 2.5, py: 2 }}>
            <Typography variant="body1" fontWeight={500}>
              {t('github.gitProxy')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 2 }}>
              {t('github.gitProxyHint')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField
                fullWidth
                value={proxy}
                placeholder="http://127.0.0.1:7890"
                onChange={(e) => {
                  setProxy(e.target.value)
                  setProxyTest(null)
                }}
                helperText={
                  proxiesDiffer
                    ? t('github.proxiesDiffer', { http: status?.git.http_proxy, https: status?.git.https_proxy })
                    : !savedProxy
                      ? t('github.noProxy')
                      : undefined
                }
                inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
              />
              <Button onClick={testProxy} disabled={!!proxyBusy} startIcon={proxyBusy === 'test' ? <CircularProgress size={14} /> : <NetworkCheck />}>
                {t('github.test')}
              </Button>
              <Button
                variant="contained"
                onClick={() => saveProxy(proxy.trim() || null)}
                disabled={!!proxyBusy || (proxy.trim() === savedProxy && !proxiesDiffer)}
              >
                {t('github.save')}
              </Button>
              {savedProxy && (
                <Button variant="text" color="error" onClick={() => saveProxy(null)} disabled={!!proxyBusy}>
                  {t('github.clear')}
                </Button>
              )}
            </Box>
            {proxyTest && (
              <Typography variant="body2" component="div" sx={{ mt: 1.5 }}>
                {proxyTest.github_ok ? (
                  <StatusText ok>
                    {t(proxyTest.tested ? 'github.proxyOk' : 'github.directOk', { ms: proxyTest.elapsed_ms })}
                  </StatusText>
                ) : (
                  <StatusText ok={false}>
                    {!proxyTest.reachable ? t('github.proxyUnreachable') : t('github.proxyNoGithub')}
                    {proxyTest.message && (
                      <Box component="span" sx={{ display: 'block', color: 'text.secondary', fontFamily: FONT_MONO, fontSize: '0.75rem', mt: 0.25 }}>
                        {proxyTest.message}
                      </Box>
                    )}
                  </StatusText>
                )}
              </Typography>
            )}
          </Box>
        )}
        <Row
          label={t('github.envProxy')}
          description={
            envProxy.length === 0 ? (
              t('github.envProxyNone')
            ) : (
              <>
                {t('github.envProxyHint')}
                <Box sx={{ mt: 0.75, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.25 }}>
                  {envProxy.map(([key, value]) => (
                    <Box key={key} sx={{ display: 'contents' }}>
                      <Mono>{key}</Mono>
                      <Mono>{value}</Mono>
                    </Box>
                  ))}
                </Box>
              </>
            )
          }
        />
      </Section>

      {(status?.gh.version || status?.git.version) && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 0.25 }}>
          {[status?.gh.version && `gh ${status.gh.version}`, status?.git.version && `git ${status.git.version}`]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      )}

      <Dialog open={!!login} onClose={cancelLogin} maxWidth="xs" fullWidth>
        <DialogTitle>
          {t('github.signInTitle')}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('github.signInHint')}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {login?.code ? (
            <Box sx={{ textAlign: 'center', py: 1 }}>
              <Box
                sx={(theme) => ({
                  display: 'inline-block',
                  px: 2.5,
                  py: 1.25,
                  borderRadius: '12px',
                  border: `1px solid ${theme.tokens.border}`,
                  bgcolor: theme.tokens.surface,
                  fontFamily: FONT_MONO,
                  fontSize: '1.75rem',
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                })}
              >
                {login.code}
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2 }}>
                <Button
                  size="small"
                  startIcon={<ContentCopy />}
                  onClick={() => writeText(login.code!).then(() => toast(t('common.copied')))}
                >
                  {t('github.copyCode')}
                </Button>
                <Button size="small" endIcon={<OpenInNew />} onClick={() => openExternalUrl('https://github.com/login/device')}>
                  github.com/login/device
                </Button>
              </Box>
            </Box>
          ) : null}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 2, color: 'text.secondary' }}>
            <CircularProgress size={14} color="inherit" />
            <Typography variant="body2">{login?.code ? t('github.waiting') : t('github.starting')}</Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={cancelLogin}>
            {t('hostsFile.cancel')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default GithubPage
