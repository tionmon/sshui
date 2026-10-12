import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Button, Chip, IconButton, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material'
import { Add, AutoAwesomeOutlined, DeleteOutline } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { claudeInfo, claudeSet, type ClaudeInfo } from '../api/tauri'
import DevToolPage from '../components/devtools/DevToolPage'
import ConfigField from '../components/devtools/ConfigField'
import ChoiceRow, { DEFAULT } from '../components/devtools/ChoiceRow'
import InstructionFilesEditor from '../components/agents/InstructionFilesEditor'
import RawConfigEditor from '../components/agents/RawConfigEditor'
import AgentProfiles from '../components/agents/AgentProfiles'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { useDevTools, TOOL_INFO_STALE_MS } from '../lib/devtools'
import { FONT_MONO } from '../theme'

const INFO_KEY = ['claudeInfo']
/** env keys shown in the "API and models" section */
const API_VARS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
]
const SECRET_VARS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']
const RULE_KINDS = ['allow', 'ask', 'deny'] as const
const mono = { fontFamily: FONT_MONO, fontSize: '0.8125rem' }

function RuleList({
  kind,
  rules,
  onChange,
}: {
  kind: (typeof RULE_KINDS)[number]
  rules: string[]
  onChange: (rules: string[]) => Promise<void>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const add = async () => {
    const rule = draft.trim()
    if (!rule || rules.includes(rule)) return
    await onChange([...rules, rule])
    setDraft('')
  }
  return (
    <Box sx={{ px: 2.5, py: 2 }}>
      <Typography variant="body1" fontWeight={500} sx={mono}>
        {kind}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
        {t(`claude.rules.${kind}`)}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.25 }}>
        {rules.length === 0 && (
          <Typography variant="body2" color="text.disabled">
            {t('agents.none')}
          </Typography>
        )}
        {rules.map((r) => (
          <Chip
            key={r}
            label={r}
            variant="outlined"
            onDelete={() => onChange(rules.filter((x) => x !== r))}
            sx={{ fontFamily: FONT_MONO }}
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
        <TextField
          fullWidth
          value={draft}
          placeholder={kind === 'deny' ? 'Read(./.env)' : 'Bash(npm run test:*)'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
        />
        <Button startIcon={<Add />} onClick={add} disabled={!draft.trim()}>
          {t('devtools.add')}
        </Button>
      </Box>
    </Box>
  )
}

function ClaudeCodePage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: tools } = useDevTools()
  const installed = !!tools?.claude.installed
  const { data: info, isLoading, error } = useQuery({
    queryKey: INFO_KEY,
    queryFn: claudeInfo,
    enabled: installed,
    staleTime: TOOL_INFO_STALE_MS,
  })
  const [tab, setTab] = useState<'settings' | 'instructions' | 'config'>('settings')
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const reload = () => queryClient.invalidateQueries({ queryKey: INFO_KEY })

  const set = async (path: string[], value: unknown) => {
    try {
      await claudeSet(path, value)
      toast(value === null || value === '' ? t('devtools.removed') : t('devtools.saved'))
      await reload()
      queryClient.invalidateQueries({ queryKey: ['agentConfig', 'claude'] })
      queryClient.invalidateQueries({ queryKey: ['agentProfiles', 'claude'] })
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }

  const envVar = (info: ClaudeInfo, name: string) => info.env.find((e) => e.name === name)
  const otherEnv = info?.env.filter((e) => !API_VARS.includes(e.name)) ?? []
  const nameValid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(newName.trim())

  return (
    <DevToolPage
      tool="claude"
      title="Claude Code"
      description={info?.version ? `${t('claude.subtitle')} · ${info.version.replace(/\s*\(Claude Code\)$/, '')}` : t('claude.subtitle')}
      icon={<AutoAwesomeOutlined />}
      installUrl="https://docs.claude.com/en/docs/claude-code/setup"
      infoKey={INFO_KEY}
      configPath={info?.settings_path}
      loading={isLoading}
      error={error}
    >
      {info && (
        <>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5 }}>
            <Tab value="settings" label={t('agents.tabSettings')} />
            <Tab value="instructions" label={t('agents.tabInstructions')} />
            <Tab value="config" label="settings.json" />
          </Tabs>

          {tab === 'settings' && (
            <>
              <AgentProfiles
                agent="claude"
                onApplied={() => {
                  reload()
                  queryClient.invalidateQueries({ queryKey: ['agentConfig', 'claude'] })
                }}
              />
              <Section title={t('claude.api')}>
                {API_VARS.map((name) => {
                  const current = envVar(info, name)
                  const secret = SECRET_VARS.includes(name)
                  return (
                    <ConfigField
                      key={name}
                      label={name}
                      description={
                        secret && current ? (
                          <>
                            {t(`claude.help.${name}`)}{' '}
                            <Box component="span" sx={{ fontFamily: FONT_MONO }}>
                              ({t('claude.current')}: {current.value})
                            </Box>
                          </>
                        ) : (
                          t(`claude.help.${name}`)
                        )
                      }
                      // Secrets are only ever shown masked, so the field starts empty
                      value={secret ? null : (current?.value ?? null)}
                      type={secret ? 'password' : 'text'}
                      placeholder={secret ? (current ? t('claude.replaceSecret') : '') : name === 'ANTHROPIC_BASE_URL' ? 'https://api.anthropic.com' : ''}
                      validate={
                        name === 'ANTHROPIC_BASE_URL'
                          ? (v) => (/^https?:\/\/\S+$/.test(v) ? null : t('devtools.invalidUrl'))
                          : undefined
                      }
                      onSave={(v) => set(['env', name], v)}
                      extra={() =>
                        secret && current ? (
                          <Button variant="text" color="error" onClick={() => set(['env', name], null)}>
                            {t('devtools.clear')}
                          </Button>
                        ) : null
                      }
                    />
                  )
                })}
                <ConfigField
                  label="model"
                  description={t('claude.help.model')}
                  value={info.model}
                  placeholder="opus, sonnet, opusplan…"
                  onSave={(v) => set(['model'], v)}
                />
              </Section>

              <Section title={t('claude.permissions')}>
                <ChoiceRow
                  label={<Box component="span" sx={mono}>defaultMode</Box>}
                  description={t('claude.help.defaultMode')}
                  value={info.default_mode}
                  options={[
                    { value: DEFAULT, label: 'default' },
                    { value: 'acceptEdits', label: 'acceptEdits' },
                    { value: 'plan', label: 'plan' },
                    { value: 'bypassPermissions', label: 'bypassPermissions' },
                  ]}
                  onSave={(v) => set(['permissions', 'defaultMode'], v)}
                />
                {RULE_KINDS.map((kind) => (
                  <RuleList key={kind} kind={kind} rules={info[kind]} onChange={(rules) => set(['permissions', kind], rules)} />
                ))}
              </Section>

              <Section title={t('claude.otherEnv')}>
                {otherEnv.map((e) => (
                  <Row
                    key={e.name}
                    label={<Box component="span" sx={mono}>{e.name}</Box>}
                    description={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', wordBreak: 'break-all' }}>{e.value}</Box>}
                    control={
                      <Tooltip title={t('devtools.remove')}>
                        <IconButton size="small" color="error" onClick={() => set(['env', e.name], null)}>
                          <DeleteOutline />
                        </IconButton>
                      </Tooltip>
                    }
                  />
                ))}
                <Box sx={{ px: 2.5, py: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
                    {t('claude.otherEnvHint')}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 1, alignItems: 'start' }}>
                    <TextField
                      value={newName}
                      placeholder="HTTPS_PROXY"
                      onChange={(e) => setNewName(e.target.value)}
                      error={!!newName.trim() && !nameValid}
                      inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
                    />
                    <TextField
                      value={newValue}
                      placeholder="http://127.0.0.1:7890"
                      onChange={(e) => setNewValue(e.target.value)}
                      inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
                    />
                    <Button
                      variant="contained"
                      disabled={!nameValid || !newValue.trim()}
                      onClick={async () => {
                        await set(['env', newName.trim()], newValue.trim())
                        setNewName('')
                        setNewValue('')
                      }}
                    >
                      {t('devtools.add')}
                    </Button>
                  </Box>
                </Box>
              </Section>
              <Box sx={{ color: 'text.secondary', fontSize: '0.75rem', px: 0.25, mb: 1 }}>{t('claude.moreInSettings')}</Box>
            </>
          )}

          {tab === 'instructions' && <InstructionFilesEditor agent="claude" />}
          {tab === 'config' && <RawConfigEditor agent="claude" onSaved={reload} />}
        </>
      )}
    </DevToolPage>
  )
}

export default ClaudeCodePage
