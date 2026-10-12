import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, Switch } from '@mui/material'
import { DeleteOutline, NetworkCheck, PrecisionManufacturingOutlined } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  rustInfo,
  rustSetConfig,
  rustSetMirror,
  rustSetRustupMirror,
  rustSetToken,
  testUrl,
  type UrlTestResult,
} from '../api/tauri'
import DevToolPage from '../components/devtools/DevToolPage'
import MirrorPicker from '../components/devtools/MirrorPicker'
import ConfigField from '../components/devtools/ConfigField'
import TestResult from '../components/devtools/TestResult'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { confirmAction } from '../lib/confirm'
import {
  useDevTools,
  CARGO_MIRRORS,
  RUSTUP_MIRRORS,
  IS_WINDOWS,
  cargoPingUrl,
  rustupPingUrl,
  sameUrl,
  TOOL_INFO_STALE_MS,
} from '../lib/devtools'
import { FONT_MONO } from '../theme'

const INFO_KEY = ['rustInfo']

function RustPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: tools } = useDevTools()
  const installed = !!tools?.rust.installed
  const { data: info, isLoading, error } = useQuery({
    queryKey: INFO_KEY,
    queryFn: rustInfo,
    enabled: installed,
    staleTime: TOOL_INFO_STALE_MS,
  })
  const [proxyTest, setProxyTest] = useState<UrlTestResult | 'pending' | null>(null)

  const reload = () => queryClient.invalidateQueries({ queryKey: INFO_KEY })
  const run = async (action: Promise<void>, removed = false) => {
    try {
      await action
      toast(removed ? t('devtools.removed') : t('devtools.saved'))
      await reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }
  const save = (key: string) => (value: string | null) => run(rustSetConfig(key, value), value === null)

  const saveRustup = (url: string | null) => {
    const preset = RUSTUP_MIRRORS.find((m) => sameUrl(m.url, url))
    const root = url === null ? null : (preset?.updateRoot ?? `${url.replace(/\/+$/, '')}/rustup`)
    return run(rustSetRustupMirror(url, root), url === null)
  }

  const removeToken = async () => {
    if (!(await confirmAction(t('rust.removeTokenConfirm'), t('rust.token')))) return
    await run(rustSetToken(null), true)
  }

  const index = info?.registry_mirror ?? CARGO_MIRRORS[0].url
  const testProxy = async (proxy: string) => {
    setProxyTest('pending')
    setProxyTest(
      await testUrl(cargoPingUrl(index), proxy || null).catch((e) => ({ ok: false, status: null, elapsed_ms: 0, message: errorMessage(e) })),
    )
  }
  const version = info?.cargo_version?.match(/^cargo (\S+)/)?.[1]

  return (
    <DevToolPage
      tool="rust"
      title="Rust"
      description={version ? `${t('rust.subtitle')} · cargo ${version}` : t('rust.subtitle')}
      icon={<PrecisionManufacturingOutlined />}
      installUrl="https://rustup.rs/"
      infoKey={INFO_KEY}
      configPath={info?.config_path}
      envOverrides={info?.env_overrides}
      loading={isLoading}
      error={error}
    >
      {info && (
        <>
          <MirrorPicker
            title={t('rust.cratesMirror')}
            presets={CARGO_MIRRORS}
            value={info.registry_mirror}
            pingUrl={cargoPingUrl}
            proxy={info.http_proxy}
            onSave={(url) => run(rustSetMirror(url), url === null)}
            customLabel={t('devtools.customMirror')}
            customDescription={t('rust.customMirrorHint')}
            customPlaceholder="sparse+https://"
            validate={(v) => (/^(sparse\+)?https?:\/\/\S+$/.test(v) ? null : t('devtools.invalidUrl'))}
            notice={
              info.replaced_with && (
                <Alert severity="info" sx={{ borderRadius: 0 }}>
                  {t('rust.replacedWith', { name: info.replaced_with })}
                </Alert>
              )
            }
          />

          {info.rustup_version && (
            <MirrorPicker
              title={t('rust.rustupMirror')}
              presets={RUSTUP_MIRRORS}
              value={info.rustup_dist_server}
              pingUrl={rustupPingUrl}
              proxy={info.http_proxy}
              onSave={saveRustup}
              customLabel={t('devtools.customMirror')}
              customDescription={t('rust.customRustupHint')}
              notice={
                <Alert severity="info" sx={{ borderRadius: 0 }}>
                  {IS_WINDOWS ? t('rust.rustupEnvNote') : t('rust.rustupEnvNoteUnix')}
                </Alert>
              }
            />
          )}

          <Section title={t('rust.network')}>
            <ConfigField
              label="http.proxy"
              description={t('rust.proxyHint')}
              value={info.http_proxy}
              placeholder="http://127.0.0.1:7890"
              validate={(v) => (/^((https?|socks5h?):\/\/)?[^\s/]+:\d+\/?$/.test(v) ? null : t('devtools.invalidUrl'))}
              onSave={save('http.proxy')}
              extra={(draft) => (
                <Button startIcon={<NetworkCheck />} onClick={() => testProxy(draft)} disabled={proxyTest === 'pending'}>
                  {t('devtools.test')}
                </Button>
              )}
              footer={
                proxyTest && (
                  <Box sx={{ mt: 1 }}>
                    <TestResult result={proxyTest === 'pending' ? null : proxyTest} pending={proxyTest === 'pending'} />
                  </Box>
                )
              }
            />
            {IS_WINDOWS && (
              <Row
                label="http.check-revoke"
                description={info.check_revoke === false ? t('rust.checkRevokeOff') : t('rust.checkRevokeHint')}
                control={
                  <Switch
                    checked={info.check_revoke !== false}
                    onChange={(e) => save('http.check-revoke')(e.target.checked ? null : 'false')}
                  />
                }
              />
            )}
            <Row
              label="net.git-fetch-with-cli"
              description={t('rust.gitFetchHint')}
              control={
                <Switch
                  checked={info.git_fetch_with_cli === true}
                  onChange={(e) => save('net.git-fetch-with-cli')(e.target.checked ? 'true' : null)}
                />
              }
            />
          </Section>

          <Section title={t('rust.token')}>
            {info.token && (
              <Row
                label="crates.io"
                description={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>{info.token}</Box>}
                control={
                  <Button size="small" color="error" startIcon={<DeleteOutline />} onClick={removeToken}>
                    {t('devtools.remove')}
                  </Button>
                }
              />
            )}
            <ConfigField
              label={info.token ? t('rust.replaceToken') : t('rust.addToken')}
              description={t('rust.tokenHint')}
              value={null}
              type="password"
              placeholder="cio…"
              onSave={(v) => run(rustSetToken(v))}
            />
          </Section>

          {(info.toolchains.length > 0 || info.rustup_version) && (
            <Section title={t('rust.toolchains')}>
              {info.rustup_version && (
                <Row label="rustup" description={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>{info.rustup_version}</Box>} />
              )}
              {info.toolchains.map((tc) => (
                <Row
                  key={tc.name}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>{tc.name}</Box>
                      {tc.default && <Chip label={t('rust.default')} color="success" />}
                    </Box>
                  }
                />
              ))}
            </Section>
          )}
        </>
      )}
    </DevToolPage>
  )
}

export default RustPage
