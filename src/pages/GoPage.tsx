import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Box } from '@mui/material'
import { CodeOutlined } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { goInfo, goSetEnv } from '../api/tauri'
import DevToolPage from '../components/devtools/DevToolPage'
import MirrorPicker from '../components/devtools/MirrorPicker'
import ConfigField from '../components/devtools/ConfigField'
import ChoiceRow, { DEFAULT } from '../components/devtools/ChoiceRow'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { useDevTools, GO_PROXIES, goPingUrl, TOOL_INFO_STALE_MS } from '../lib/devtools'
import { FONT_MONO } from '../theme'

const INFO_KEY = ['goInfo']
function GoPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: tools } = useDevTools()
  const installed = !!tools?.go.installed
  const { data: info, isLoading, error } = useQuery({
    queryKey: INFO_KEY,
    queryFn: goInfo,
    enabled: installed,
    staleTime: TOOL_INFO_STALE_MS,
  })

  const save = (key: string) => async (value: string | null) => {
    try {
      await goSetEnv(key, value)
      toast(value === null ? t('devtools.removed') : t('devtools.saved'))
      await queryClient.invalidateQueries({ queryKey: INFO_KEY })
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }

  const pathRow = (label: string, value: string | null) =>
    value && (
      <Row label={label} description={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>{value}</Box>} />
    )

  return (
    <DevToolPage
      tool="go"
      title="Go"
      description={info?.version ? `${t('go.subtitle')} · ${info.version}` : t('go.subtitle')}
      icon={<CodeOutlined />}
      installUrl="https://go.dev/dl/"
      infoKey={INFO_KEY}
      configPath={info?.config_path}
      envOverrides={info?.env_overrides}
      loading={isLoading}
      error={error}
    >
      {info && (
        <>
          <MirrorPicker
            title={t('go.proxy')}
            presets={GO_PROXIES}
            value={info.goproxy}
            pingUrl={goPingUrl}
            onSave={save('GOPROXY')}
            customLabel={t('devtools.customMirror')}
            customDescription={t('go.customProxyHint')}
            customPlaceholder="https://goproxy.example.com,direct"
            validate={(v) =>
              v.split(/[,|]/).every((p) => p === 'direct' || p === 'off' || /^(https?|file):\/\/\S+$/.test(p))
                ? null
                : t('go.proxyInvalid')
            }
          />

          <Section title={t('go.modules')}>
            <ChoiceRow
              label="GOSUMDB"
              description={t('go.sumdbHint')}
              value={info.gosumdb}
              options={[
                { value: DEFAULT, label: t('go.default', { value: 'sum.golang.org' }) },
                { value: 'sum.golang.google.cn', label: 'sum.golang.google.cn' },
                { value: 'off', label: t('go.sumdbOff') },
              ]}
              onSave={save('GOSUMDB')}
            />
            <ConfigField
              label="GOPRIVATE"
              description={t('go.privateHint')}
              value={info.goprivate}
              placeholder="github.com/my-org/*,*.corp.example.com"
              validate={(v) => (/\s/.test(v) ? t('go.noSpaces') : null)}
              onSave={save('GOPRIVATE')}
            />
            <ChoiceRow
              label="GOTOOLCHAIN"
              description={t('go.toolchainHint')}
              value={info.gotoolchain}
              options={[
                { value: DEFAULT, label: t('go.default', { value: 'auto' }) },
                { value: 'local', label: t('go.toolchainLocal') },
                { value: 'auto', label: 'auto' },
              ]}
              onSave={save('GOTOOLCHAIN')}
            />
          </Section>

          <Section title={t('go.paths')}>
            {pathRow('GOROOT', info.goroot)}
            {pathRow('GOPATH', info.gopath)}
            {pathRow('GOMODCACHE', info.gomodcache)}
          </Section>
        </>
      )}
    </DevToolPage>
  )
}

export default GoPage
