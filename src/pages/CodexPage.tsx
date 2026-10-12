import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Chip, Tab, Tabs } from '@mui/material'
import { SmartToyOutlined } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { codexInfo, codexSet } from '../api/tauri'
import DevToolPage from '../components/devtools/DevToolPage'
import ConfigField from '../components/devtools/ConfigField'
import ChoiceRow, { DEFAULT } from '../components/devtools/ChoiceRow'
import InstructionFilesEditor from '../components/agents/InstructionFilesEditor'
import RawConfigEditor from '../components/agents/RawConfigEditor'
import AgentProfiles from '../components/agents/AgentProfiles'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { useDevTools, TOOL_INFO_STALE_MS } from '../lib/devtools'

const INFO_KEY = ['codexInfo']

function CodexPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: tools } = useDevTools()
  const installed = !!tools?.codex.installed
  const { data: info, isLoading, error } = useQuery({
    queryKey: INFO_KEY,
    queryFn: codexInfo,
    enabled: installed,
    staleTime: TOOL_INFO_STALE_MS,
  })
  const [tab, setTab] = useState<'settings' | 'instructions' | 'config'>('settings')
  const reload = () => queryClient.invalidateQueries({ queryKey: INFO_KEY })

  const save = (key: string) => async (value: string | null) => {
    try {
      await codexSet(key, value)
      toast(value === null ? t('devtools.removed') : t('devtools.saved'))
      await reload()
      queryClient.invalidateQueries({ queryKey: ['agentConfig', 'codex'] })
      queryClient.invalidateQueries({ queryKey: ['agentProfiles', 'codex'] })
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }
  const choice = (key: string, def: string, values: string[]) => (
    <ChoiceRow
      label={key}
      description={t(`codex.help.${key}`)}
      value={(info as unknown as Record<string, string | null>)?.[key] ?? null}
      options={[{ value: DEFAULT, label: t('go.default', { value: def }) }, ...values.map((v) => ({ value: v, label: v }))]}
      onSave={save(key)}
    />
  )
  const version = info?.version?.replace(/^codex-cli\s*/, '')

  return (
    <DevToolPage
      tool="codex"
      title="Codex CLI"
      description={version ? `${t('codex.subtitle')} · ${version}` : t('codex.subtitle')}
      icon={<SmartToyOutlined />}
      installUrl="https://github.com/openai/codex"
      infoKey={INFO_KEY}
      configPath={info?.config_path}
      envOverrides={info?.env_overrides}
      loading={isLoading}
      error={error}
    >
      {info && (
        <>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5 }}>
            <Tab value="settings" label={t('agents.tabSettings')} />
            <Tab value="instructions" label={t('agents.tabInstructions')} />
            <Tab value="config" label="config.toml" />
          </Tabs>

          {tab === 'settings' && (
            <>
              <AgentProfiles
                agent="codex"
                onApplied={() => {
                  reload()
                  queryClient.invalidateQueries({ queryKey: ['agentConfig', 'codex'] })
                }}
              />
              <Section title={t('codex.model')}>
                <ConfigField
                  label="model"
                  description={t('codex.help.model')}
                  value={info.model}
                  placeholder="gpt-5-codex"
                  validate={(v) => (/\s/.test(v) ? t('go.noSpaces') : null)}
                  onSave={save('model')}
                />
                {choice('model_reasoning_effort', 'medium', ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])}
                {choice('model_provider', 'openai', ['openai', 'oss', ...info.providers.filter((p) => p !== 'openai' && p !== 'oss')])}
              </Section>

              <Section title={t('codex.permissions')}>
                {choice('approval_policy', 'on-request', ['untrusted', 'on-failure', 'on-request', 'never'])}
                {choice('sandbox_mode', 'read-only', ['read-only', 'workspace-write', 'danger-full-access'])}
              </Section>

              <Section title={t('codex.account')}>
                <Row
                  label={t('codex.auth')}
                  description={
                    info.auth_mode === 'chatgpt'
                      ? t('codex.authChatgpt')
                      : info.auth_mode === 'apikey'
                        ? t('codex.authApiKey')
                        : t('codex.authNone')
                  }
                />
                <Row
                  label={t('codex.mcpServers')}
                  description={
                    info.mcp_servers.length ? (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                        {info.mcp_servers.map((s) => (
                          <Chip key={s} label={s} variant="outlined" />
                        ))}
                      </Box>
                    ) : (
                      t('codex.noneConfigured')
                    )
                  }
                />
                <Row
                  label={t('codex.providers')}
                  description={info.providers.length ? info.providers.join(', ') : t('codex.noneConfigured')}
                />
              </Section>
              <Box sx={{ color: 'text.secondary', fontSize: '0.75rem', px: 0.25, mb: 1 }}>{t('codex.moreInConfig')}</Box>
            </>
          )}

          {tab === 'instructions' && <InstructionFilesEditor agent="codex" />}
          {tab === 'config' && <RawConfigEditor agent="codex" onSaved={reload} />}
        </>
      )}
    </DevToolPage>
  )
}

export default CodexPage
