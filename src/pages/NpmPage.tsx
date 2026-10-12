import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Button, Chip, CircularProgress, Switch, TextField, Typography } from '@mui/material'
import { DeleteOutline, Inventory2Outlined, NetworkCheck, PersonSearchOutlined } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ask } from '@tauri-apps/plugin-dialog'
import { npmInfo, npmSetConfig, npmSetToken, npmWhoami, testUrl, type UrlTestResult } from '../api/tauri'
import DevToolPage from '../components/devtools/DevToolPage'
import MirrorPicker from '../components/devtools/MirrorPicker'
import ConfigField from '../components/devtools/ConfigField'
import TestResult from '../components/devtools/TestResult'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { useDevTools, NPM_MIRRORS, npmPingUrl, TOOL_INFO_STALE_MS } from '../lib/devtools'
import { FONT_MONO } from '../theme'

const INFO_KEY = ['npmInfo']
const urlError = (t: (k: string) => string) => (v: string) => (/^https?:\/\/\S+$/.test(v) ? null : t('devtools.invalidUrl'))
/** "//registry.npmjs.org/" → "https://registry.npmjs.org/" */
const prefixToUrl = (prefix: string) => (prefix.startsWith('//') ? `https:${prefix}` : null)

function NpmPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: tools } = useDevTools()
  const installed = !!tools?.npm.installed
  const { data: info, isLoading, error } = useQuery({
    queryKey: INFO_KEY,
    queryFn: npmInfo,
    enabled: installed,
    staleTime: TOOL_INFO_STALE_MS,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: INFO_KEY })
  const save = (key: string) => async (value: string | null) => {
    try {
      await npmSetConfig(key, value)
      toast(value === null ? t('devtools.removed') : t('devtools.saved'))
      await reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }

  const registry = info?.registry ?? NPM_MIRRORS[0].url
  const [proxyTest, setProxyTest] = useState<Record<string, UrlTestResult | 'pending'>>({})
  const testProxy = async (field: string, proxy: string) => {
    setProxyTest((r) => ({ ...r, [field]: 'pending' }))
    const result = await testUrl(npmPingUrl(registry), proxy || null).catch((e) => ({
      ok: false, status: null, elapsed_ms: 0, message: errorMessage(e),
    }))
    setProxyTest((r) => ({ ...r, [field]: result }))
  }
  const proxyField = (key: 'proxy' | 'https-proxy', value: string | null, description: string) => (
    <ConfigField
      label={key}
      description={description}
      value={value}
      placeholder="http://127.0.0.1:7890"
      validate={urlError(t)}
      onSave={save(key)}
      extra={(draft) => (
        <Button startIcon={<NetworkCheck />} onClick={() => testProxy(key, draft)} disabled={proxyTest[key] === 'pending'}>
          {t('devtools.test')}
        </Button>
      )}
      footer={
        proxyTest[key] && (
          <Box sx={{ mt: 1 }}>
            <TestResult result={proxyTest[key] === 'pending' ? null : (proxyTest[key] as UrlTestResult)} pending={proxyTest[key] === 'pending'} />
          </Box>
        )
      }
    />
  )

  // ── Authentication ──
  const [whoami, setWhoami] = useState<Record<string, string | 'pending'>>({})
  const checkWhoami = async (prefix: string) => {
    setWhoami((w) => ({ ...w, [prefix]: 'pending' }))
    try {
      const user = await npmWhoami(prefixToUrl(prefix))
      setWhoami((w) => ({ ...w, [prefix]: t('npm.signedInAs', { user }) }))
    } catch (e) {
      setWhoami((w) => ({ ...w, [prefix]: `✕ ${errorMessage(e)}` }))
    }
  }
  const removeAuth = async (prefix: string) => {
    if (!(await ask(t('npm.removeAuthConfirm', { registry: prefix }), { title: t('npm.auth'), kind: 'warning' }))) return
    const url = prefixToUrl(prefix)
    try {
      if (url) await npmSetToken(url, null)
      else for (const key of ['_authToken', '_auth', '_password', 'username']) await npmSetConfig(key, null)
      toast(t('devtools.removed'))
      await reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }

  const [tokenRegistry, setTokenRegistry] = useState('')
  const [token, setToken] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const addToken = async () => {
    setSavingToken(true)
    try {
      await npmSetToken(tokenRegistry.trim() || registry, token.trim())
      setToken('')
      setTokenRegistry('')
      toast(t('npm.tokenSaved'))
      await reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    } finally {
      setSavingToken(false)
    }
  }

  // ── Scoped registries ──
  const [scope, setScope] = useState('')
  const [scopeUrl, setScopeUrl] = useState('')
  const scopeName = scope.trim().startsWith('@') ? scope.trim() : `@${scope.trim()}`
  const scopeValid = /^@[a-z0-9-_.]+$/i.test(scopeName) && /^https?:\/\/\S+$/.test(scopeUrl.trim())
  const addScope = async () => {
    await save(`${scopeName}:registry`)(scopeUrl.trim())
    setScope('')
    setScopeUrl('')
  }

  return (
    <DevToolPage
      tool="npm"
      title="npm"
      description={info?.version ? `${t('npm.subtitle')} · v${info.version}` : t('npm.subtitle')}
      icon={<Inventory2Outlined />}
      installUrl="https://nodejs.org/"
      infoKey={INFO_KEY}
      configPath={info?.config_path}
      envOverrides={info?.env_overrides}
      loading={isLoading}
      error={error}
    >
      {info && (
        <>
          <MirrorPicker
            title={t('npm.registry')}
            presets={NPM_MIRRORS}
            value={info.registry}
            pingUrl={npmPingUrl}
            proxy={info.https_proxy ?? info.proxy}
            onSave={save('registry')}
            customLabel={t('devtools.customMirror')}
            customDescription={t('npm.customRegistryHint')}
          />

          <Section title={t('devtools.proxy')}>
            {proxyField('proxy', info.proxy, t('npm.proxyHint'))}
            {proxyField('https-proxy', info.https_proxy, t('npm.httpsProxyHint'))}
            <ConfigField
              label="noproxy"
              description={t('npm.noproxyHint')}
              value={info.noproxy}
              placeholder="localhost,127.0.0.1,.internal"
              onSave={save('noproxy')}
            />
            <Row
              label="strict-ssl"
              description={info.strict_ssl === 'false' ? t('npm.strictSslOff') : t('npm.strictSslHint')}
              control={<Switch checked={info.strict_ssl !== 'false'} onChange={(e) => save('strict-ssl')(e.target.checked ? null : 'false')} />}
            />
          </Section>

          <Section title={t('npm.auth')}>
            {info.auths.length === 0 ? (
              <Row label={t('npm.noAuth')} description={t('npm.noAuthHint')} />
            ) : (
              info.auths.map((auth) => {
                const result = whoami[auth.registry]
                return (
                  <Row
                    key={`${auth.registry}-${auth.kind}`}
                    label={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>{auth.registry}</Box>}
                    description={
                      <>
                        <Chip label={t(`npm.authKind.${auth.kind}`)} sx={{ mr: 1 }} />
                        <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>{auth.masked}</Box>
                        {result && result !== 'pending' && (
                          <Box component="div" sx={{ mt: 0.5 }}>{result}</Box>
                        )}
                      </>
                    }
                    control={
                      <>
                        <Button
                          size="small"
                          startIcon={result === 'pending' ? <CircularProgress size={12} /> : <PersonSearchOutlined />}
                          onClick={() => checkWhoami(auth.registry)}
                          disabled={result === 'pending'}
                        >
                          {t('npm.whoami')}
                        </Button>
                        <Button size="small" color="error" startIcon={<DeleteOutline />} onClick={() => removeAuth(auth.registry)}>
                          {t('devtools.remove')}
                        </Button>
                      </>
                    }
                  />
                )
              })
            )}
            <Box sx={{ px: 2.5, py: 2 }}>
              <Typography variant="body1" fontWeight={500}>
                {t('npm.addToken')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 1.5 }}>
                {t('npm.addTokenHint')}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 1, alignItems: 'start' }}>
                <TextField
                  value={tokenRegistry}
                  placeholder={registry}
                  onChange={(e) => setTokenRegistry(e.target.value)}
                  inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
                />
                <TextField
                  type="password"
                  value={token}
                  placeholder={t('npm.tokenPlaceholder')}
                  onChange={(e) => setToken(e.target.value)}
                  inputProps={{ autoComplete: 'off', style: { fontFamily: FONT_MONO } }}
                />
                <Button variant="contained" onClick={addToken} disabled={!token.trim() || savingToken}>
                  {t('devtools.save')}
                </Button>
              </Box>
            </Box>
          </Section>

          <Section title={t('npm.scopes')}>
            {info.scopes.map((s) => (
              <Row
                key={s.scope}
                label={<Box component="span" sx={{ fontFamily: FONT_MONO }}>{s.scope}</Box>}
                description={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>{s.registry}</Box>}
                control={
                  <Button size="small" color="error" startIcon={<DeleteOutline />} onClick={() => save(`${s.scope}:registry`)(null)}>
                    {t('devtools.remove')}
                  </Button>
                }
              />
            ))}
            <Box sx={{ px: 2.5, py: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t('npm.scopesHint')}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: 1, alignItems: 'start' }}>
                <TextField value={scope} placeholder="@my-org" onChange={(e) => setScope(e.target.value)} inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }} />
                <TextField value={scopeUrl} placeholder="https://npm.pkg.github.com/" onChange={(e) => setScopeUrl(e.target.value)} inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }} />
                <Button variant="contained" onClick={addScope} disabled={!scopeValid}>
                  {t('devtools.add')}
                </Button>
              </Box>
            </Box>
          </Section>
        </>
      )}
    </DevToolPage>
  )
}

export default NpmPage
