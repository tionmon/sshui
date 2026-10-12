import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button } from '@mui/material'
import { IntegrationInstructionsOutlined, NetworkCheck } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pipInfo, pipSetConfig, testUrl, type UrlTestResult } from '../api/tauri'
import DevToolPage from '../components/devtools/DevToolPage'
import MirrorPicker from '../components/devtools/MirrorPicker'
import ConfigField from '../components/devtools/ConfigField'
import TestResult from '../components/devtools/TestResult'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { useDevTools, PIP_MIRRORS, pipPingUrl, TOOL_INFO_STALE_MS } from '../lib/devtools'
import { FONT_MONO } from '../theme'

const INFO_KEY = ['pipInfo']
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function PipPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: tools } = useDevTools()
  const installed = !!tools?.python.installed
  const { data: info, isLoading, error } = useQuery({
    queryKey: INFO_KEY,
    queryFn: pipInfo,
    enabled: installed,
    staleTime: TOOL_INFO_STALE_MS,
  })
  const [proxyTest, setProxyTest] = useState<UrlTestResult | 'pending' | null>(null)

  const reload = () => queryClient.invalidateQueries({ queryKey: INFO_KEY })
  const write = async (key: string, value: string | null) => {
    try {
      await pipSetConfig(key, value)
      return true
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
      return false
    }
  }
  const save = (key: string) => async (value: string | null) => {
    if (await write(key, value)) {
      toast(value === null ? t('devtools.removed') : t('devtools.saved'))
      await reload()
    }
  }

  // pip refuses plain-HTTP indexes unless their host is trusted
  const saveIndex = async (url: string | null) => {
    if (!(await write('index-url', url))) return
    const host = url?.startsWith('http://') ? hostOf(url) : null
    if (host && info && !info.trusted_hosts.includes(host)) {
      await write('trusted-host', [...info.trusted_hosts, host].join(' '))
    }
    toast(url === null ? t('devtools.removed') : t('devtools.saved'))
    await reload()
  }

  const index = info?.index_url ?? PIP_MIRRORS[0].url
  const testProxy = async (proxy: string) => {
    setProxyTest('pending')
    setProxyTest(
      await testUrl(pipPingUrl(index), proxy || null).catch((e) => ({ ok: false, status: null, elapsed_ms: 0, message: errorMessage(e) })),
    )
  }
  const pipVersion = info?.pip_version?.match(/^pip (\S+)/)?.[1]
  const pythonVersion = info?.pip_version?.match(/\(python ([^)]+)\)/)?.[1]

  return (
    <DevToolPage
      tool="python"
      title="Python"
      description={pipVersion ? `${t('pip.subtitle')} · pip ${pipVersion}` : t('pip.subtitle')}
      icon={<IntegrationInstructionsOutlined />}
      installUrl="https://www.python.org/downloads/"
      infoKey={INFO_KEY}
      configPath={info?.config_path}
      envOverrides={info?.env_overrides}
      loading={isLoading}
      error={error}
    >
      {info && (
        <>
          {!info.pip_version && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('pip.pipMissing')}
            </Alert>
          )}

          <MirrorPicker
            title={t('pip.index')}
            presets={PIP_MIRRORS}
            value={info.index_url}
            pingUrl={pipPingUrl}
            proxy={info.proxy}
            onSave={saveIndex}
            customLabel={t('devtools.customMirror')}
            customDescription={t('pip.customIndexHint')}
          />

          <Section title={t('pip.moreIndexes')}>
            <ConfigField
              label="extra-index-url"
              description={t('pip.extraIndexHint')}
              value={info.extra_index_urls.join(' ') || null}
              placeholder="https://download.pytorch.org/whl/cu121"
              validate={(v) => (v.split(/\s+/).every((u) => /^https?:\/\/\S+$/.test(u)) ? null : t('devtools.invalidUrl'))}
              onSave={save('extra-index-url')}
            />
            <ConfigField
              label="trusted-host"
              description={t('pip.trustedHostHint')}
              value={info.trusted_hosts.join(' ') || null}
              placeholder="mirrors.example.com"
              onSave={save('trusted-host')}
            />
          </Section>

          <Section title={t('devtools.proxy')}>
            <ConfigField
              label="proxy"
              description={t('pip.proxyHint')}
              value={info.proxy}
              placeholder="http://127.0.0.1:7890"
              validate={(v) => (/^(https?|socks5h?):\/\/\S+$/.test(v) ? null : t('devtools.invalidUrl'))}
              onSave={save('proxy')}
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
            <ConfigField
              label="timeout"
              description={t('pip.timeoutHint')}
              value={info.timeout}
              placeholder="15"
              validate={(v) => (/^\d+$/.test(v) ? null : t('devtools.invalidNumber'))}
              onSave={save('timeout')}
            />
          </Section>

          <Section title={t('pip.environment')}>
            <Row
              label={t('pip.interpreter')}
              description={
                <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>
                  {info.python_path}
                  {pythonVersion && ` · Python ${pythonVersion}`}
                </Box>
              }
            />
          </Section>
        </>
      )}
    </DevToolPage>
  )
}

export default PipPage
