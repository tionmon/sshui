import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip } from '@mui/material'
import { PowerSettingsNew, TerminalOutlined } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ask } from '@tauri-apps/plugin-dialog'
import { wslInfo, wslSetConfig, wslSetDefault, wslShutdown } from '../api/tauri'
import DevToolPage from '../components/devtools/DevToolPage'
import ConfigField from '../components/devtools/ConfigField'
import ChoiceRow, { DEFAULT } from '../components/devtools/ChoiceRow'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { useDevTools, TOOL_INFO_STALE_MS } from '../lib/devtools'
import { FONT_MONO } from '../theme'

const INFO_KEY = ['wslInfo']
const SIZE = /^\d+(\.\d+)?(B|KB|MB|GB|TB)?$/i

/** Boolean settings: [section, key, default value] */
const NETWORK_BOOLS: [string, string, boolean][] = [
  ['wsl2', 'dnsTunneling', true],
  ['wsl2', 'firewall', true],
  ['wsl2', 'autoProxy', true],
  ['wsl2', 'localhostForwarding', true],
  ['experimental', 'hostAddressLoopback', false],
]
const FEATURE_BOOLS: [string, string, boolean][] = [
  ['wsl2', 'guiApplications', true],
  ['wsl2', 'nestedVirtualization', true],
  ['experimental', 'sparseVhd', false],
]

function WslPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: tools } = useDevTools()
  const installed = !!tools?.wsl.installed
  const { data: info, isLoading, error } = useQuery({
    queryKey: INFO_KEY,
    queryFn: wslInfo,
    enabled: installed,
    staleTime: TOOL_INFO_STALE_MS,
  })
  const [needsRestart, setNeedsRestart] = useState(false)
  const [shuttingDown, setShuttingDown] = useState(false)
  const reload = () => queryClient.invalidateQueries({ queryKey: INFO_KEY })

  const save = (section: string, key: string) => async (value: string | null) => {
    try {
      await wslSetConfig(section, key, value)
      toast(value === null ? t('devtools.removed') : t('devtools.saved'))
      setNeedsRestart(true)
      await reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }
  const get = (section: string, key: string) => info?.settings[`${section}.${key}`] ?? null

  const shutdown = async () => {
    if (!(await ask(t('wsl.shutdownConfirm'), { title: t('wsl.shutdown'), kind: 'warning' }))) return
    setShuttingDown(true)
    try {
      await wslShutdown()
      setNeedsRestart(false)
      toast(t('wsl.shutdownDone'))
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    } finally {
      setShuttingDown(false)
    }
  }
  const setDefault = async (name: string) => {
    try {
      await wslSetDefault(name)
      toast(t('wsl.defaultSet', { name }))
      await reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }

  const boolRow = ([section, key, def]: [string, string, boolean]) => (
    <ChoiceRow
      key={key}
      label={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>{key}</Box>}
      description={t(`wsl.help.${key}`)}
      value={get(section, key)}
      options={[
        { value: DEFAULT, label: t('wsl.defaultValue', { value: def ? t('wsl.on') : t('wsl.off') }) },
        { value: 'true', label: t('wsl.on') },
        { value: 'false', label: t('wsl.off') },
      ]}
      onSave={save(section, key)}
    />
  )
  const field = (key: string, placeholder: string, validate?: (v: string) => string | null) => (
    <ConfigField
      label={key}
      description={t(`wsl.help.${key}`)}
      value={get('wsl2', key)}
      placeholder={placeholder}
      validate={validate}
      onSave={save('wsl2', key)}
    />
  )
  const sizeError = (v: string) => (SIZE.test(v) ? null : t('wsl.sizeInvalid'))
  const countError = (v: string) => (/^\d+$/.test(v) ? null : t('devtools.invalidNumber'))

  return (
    <DevToolPage
      tool="wsl"
      title="WSL"
      description={info?.version ? `${t('wsl.subtitle')} · ${info.version}` : t('wsl.subtitle')}
      icon={<TerminalOutlined />}
      installUrl="https://learn.microsoft.com/windows/wsl/install"
      infoKey={INFO_KEY}
      configPath={info?.config_path}
      loading={isLoading}
      error={error}
      notInstalledHint={t('wsl.notInstalledHint')}
    >
      {info && (
        <>
          <Alert
            severity={needsRestart ? 'warning' : 'info'}
            sx={{ mb: 3 }}
            action={
              <Button
                size="small"
                color="inherit"
                startIcon={<PowerSettingsNew />}
                onClick={shutdown}
                disabled={shuttingDown}
              >
                {shuttingDown ? t('wsl.shuttingDown') : t('wsl.shutdown')}
              </Button>
            }
          >
            {needsRestart ? t('wsl.restartNeeded') : t('wsl.restartHint')}
          </Alert>

          <Section title={t('wsl.distros')}>
            {info.distros.length === 0 ? (
              <Row label={t('wsl.noDistros')} description={t('wsl.noDistrosHint')} />
            ) : (
              info.distros.map((d) => (
                <Row
                  key={d.name}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      {d.name}
                      <Chip label={`WSL ${d.version}`} variant="outlined" />
                      {d.default && <Chip label={t('wsl.default')} color="success" />}
                    </Box>
                  }
                  description={
                    d.base_path && <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>{d.base_path}</Box>
                  }
                  control={
                    !d.default && (
                      <Button size="small" onClick={() => setDefault(d.name)}>
                        {t('wsl.setDefault')}
                      </Button>
                    )
                  }
                />
              ))
            )}
          </Section>

          <Section title={t('wsl.resources')}>
            {field('memory', '8GB', sizeError)}
            {field('processors', '4', countError)}
            {field('swap', '2GB', sizeError)}
            {field('vmIdleTimeout', '60000', countError)}
          </Section>

          <Section title={t('wsl.networking')}>
            <ChoiceRow
              label={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>networkingMode</Box>}
              description={t('wsl.help.networkingMode')}
              value={get('wsl2', 'networkingMode')}
              options={[
                { value: DEFAULT, label: t('wsl.defaultValue', { value: 'NAT' }) },
                { value: 'NAT', label: 'NAT' },
                { value: 'mirrored', label: t('wsl.mirrored') },
              ]}
              onSave={save('wsl2', 'networkingMode')}
            />
            {NETWORK_BOOLS.map(boolRow)}
          </Section>

          <Section title={t('wsl.features')}>
            <ChoiceRow
              label={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>autoMemoryReclaim</Box>}
              description={t('wsl.help.autoMemoryReclaim')}
              value={get('experimental', 'autoMemoryReclaim')}
              options={[
                { value: DEFAULT, label: t('wsl.defaultValue', { value: 'dropCache' }) },
                { value: 'gradual', label: 'gradual' },
                { value: 'dropCache', label: 'dropCache' },
                { value: 'disabled', label: t('wsl.off') },
              ]}
              onSave={save('experimental', 'autoMemoryReclaim')}
            />
            {FEATURE_BOOLS.map(boolRow)}
          </Section>
        </>
      )}
    </DevToolPage>
  )
}

export default WslPage
