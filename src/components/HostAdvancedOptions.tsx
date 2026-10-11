import { Autocomplete, Box, Button, Grid, IconButton, MenuItem, Switch, TextField, Tooltip, Typography } from '@mui/material'
import { Add, ArrowForward, DeleteOutline } from '@mui/icons-material'
import { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostEntry } from '../api/tauri'
import { FONT_MONO } from '../theme'

// ── State model ──────────────────────────────────────────────────────────────

export type ForwardKind = 'local' | 'remote' | 'dynamic'

export interface ForwardRow {
  id: number
  kind: ForwardKind
  listen: string
  dest: string
  /** Converted on load from the invalid `-L 8080:host:80` command-line form */
  converted?: boolean
}

export interface ExtraRow {
  id: number
  key: string
  value: string
}

export interface AdvancedState {
  connectTimeout: string
  connectionAttempts: string
  serverAliveInterval: string
  serverAliveCountMax: string
  compression: boolean
  strictHostKeyChecking: string
  identitiesOnly: boolean
  forwardAgent: boolean
  legacyRsa: boolean
  // Original algorithm values, kept so custom lists survive the legacy-RSA toggle
  hostKeyAlgorithms?: string
  pubkeyAcceptedKeyTypes?: string
  forwards: ForwardRow[]
  extras: ExtraRow[]
}

export type AdvancedErrors = Record<string, string>

let nextId = 1
const newId = () => nextId++

const FORWARD_KEYWORD: Record<ForwardKind, string> = {
  local: 'LocalForward',
  remote: 'RemoteForward',
  dynamic: 'DynamicForward',
}

// Keywords edited elsewhere in the dialog; not allowed as "other options"
const MANAGED_KEYWORDS = new Set(
  [
    'Host', 'Match', 'Include', 'HostName', 'User', 'Port', 'IdentityFile', 'ProxyJump', 'ProxyCommand',
    'ForwardAgent', 'StrictHostKeyChecking', 'ServerAliveInterval', 'ServerAliveCountMax', 'Compression',
    'ConnectionAttempts', 'ConnectTimeout', 'LocalForward', 'RemoteForward', 'DynamicForward',
    'PubkeyAcceptedKeyTypes', 'PubkeyAcceptedAlgorithms', 'HostKeyAlgorithms', 'IdentitiesOnly',
  ].map((k) => k.toLowerCase()),
)

// Common ssh_config keywords offered in the "other options" editor. Connection
// multiplexing (ControlMaster etc.) is left out: Windows OpenSSH doesn't support it.
const SUGGESTED_KEYWORDS = [
  'AddKeysToAgent', 'AddressFamily', 'BatchMode', 'BindAddress', 'CertificateFile', 'CheckHostIP', 'Ciphers',
  'ClearAllForwardings', 'ExitOnForwardFailure', 'ForwardX11', 'ForwardX11Trusted', 'GatewayPorts',
  'HashKnownHosts', 'IPQoS', 'KexAlgorithms', 'LocalCommand', 'LogLevel', 'MACs', 'NumberOfPasswordPrompts',
  'PasswordAuthentication', 'PermitLocalCommand', 'PreferredAuthentications', 'PubkeyAuthentication',
  'RemoteCommand', 'RequestTTY', 'SendEnv', 'SetEnv', 'TCPKeepAlive', 'UpdateHostKeys', 'UserKnownHostsFile',
  'VisualHostKey',
]

const RSA = 'ssh-rsa'

function parseAlgorithmList(value?: string) {
  const v = (value ?? '').trim()
  const prefix = /^[+\-^]/.test(v) ? v[0] : ''
  const items = (prefix ? v.slice(1) : v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { v, prefix, items }
}

const allowsSshRsa = (value?: string) => {
  const { prefix, items } = parseAlgorithmList(value)
  return prefix !== '-' && items.includes(RSA)
}

/** Add or remove ssh-rsa from an algorithm list, preserving any other entries. */
export function setSshRsa(value: string | undefined, on: boolean): string | undefined {
  const { v, prefix, items } = parseAlgorithmList(value)
  if (on) {
    if (allowsSshRsa(v)) return v
    if (!v || prefix === '-') return `+${RSA}`
    return `${prefix}${[...items, RSA].join(',')}`
  }
  if (prefix === '-') return v || undefined
  const rest = items.filter((i) => i !== RSA)
  return rest.length ? `${prefix}${rest.join(',')}` : undefined
}

// `8080:localhost:80` / `127.0.0.1:8080:db:5432` → listen + destination
const CLI_FORWARD = /^((?:[^:\s[\]]+:)?\d+):(.+:\d+)$/

function parseForward(kind: ForwardKind, value: string): ForwardRow {
  const parts = value.trim().split(/\s+/)
  if (parts.length >= 2) {
    return { id: newId(), kind, listen: parts[0], dest: parts.slice(1).join(' ') }
  }
  const cli = kind !== 'dynamic' ? value.trim().match(CLI_FORWARD) : null
  if (cli) return { id: newId(), kind, listen: cli[1], dest: cli[2], converted: true }
  return { id: newId(), kind, listen: value.trim(), dest: '' }
}

const asList = (value: string[] | string | undefined | null) =>
  value == null ? [] : Array.isArray(value) ? value : [value]

export function advancedFromHost(host?: HostEntry): AdvancedState {
  const extras = Object.entries(host?.extra_options ?? {})
  const identitiesOnly = extras.find(([k]) => k.toLowerCase() === 'identitiesonly')
  return {
    connectTimeout: host?.connect_timeout?.toString() ?? '',
    connectionAttempts: host?.connection_attempts?.toString() ?? '',
    serverAliveInterval: host?.server_alive_interval ? host.server_alive_interval.toString() : '',
    serverAliveCountMax: host?.server_alive_count_max?.toString() ?? '',
    compression: host?.compression === true,
    strictHostKeyChecking: host?.strict_host_key_checking?.toLowerCase() ?? '',
    identitiesOnly: !!identitiesOnly && /^(yes|true)$/i.test(identitiesOnly[1].trim()),
    forwardAgent: host?.forward_agent === true,
    legacyRsa: allowsSshRsa(host?.host_key_algorithms) || allowsSshRsa(host?.pubkey_accepted_key_types),
    hostKeyAlgorithms: host?.host_key_algorithms,
    pubkeyAcceptedKeyTypes: host?.pubkey_accepted_key_types,
    forwards: [
      ...asList(host?.local_forward).map((v) => parseForward('local', v)),
      ...asList(host?.remote_forward).map((v) => parseForward('remote', v)),
      ...asList(host?.dynamic_forward).map((v) => parseForward('dynamic', v)),
    ],
    extras: extras
      .filter(([k]) => k.toLowerCase() !== 'identitiesonly')
      .map(([key, value]) => ({ id: newId(), key, value })),
  }
}

const toInt = (s: string) => (s.trim() === '' ? undefined : parseInt(s, 10))
const isBlankForward = (f: ForwardRow) => !f.listen.trim() && !f.dest.trim()

export function forwardLine(f: ForwardRow) {
  const listen = f.listen.trim()
  const dest = f.dest.trim()
  return f.kind === 'dynamic' || !dest ? listen : `${listen} ${dest}`
}

/** The HostEntry fields owned by the Advanced tab. */
export function advancedToEntry(s: AdvancedState): Partial<HostEntry> {
  const forwards = s.forwards.filter((f) => !isBlankForward(f))
  const extra: Record<string, string> = {}
  for (const row of s.extras) {
    if (row.key.trim()) extra[row.key.trim()] = row.value.trim()
  }
  if (s.identitiesOnly) extra.IdentitiesOnly = 'yes'

  const alive = toInt(s.serverAliveInterval)
  return {
    connect_timeout: toInt(s.connectTimeout),
    connection_attempts: toInt(s.connectionAttempts),
    server_alive_interval: alive ? alive : undefined,
    server_alive_count_max: toInt(s.serverAliveCountMax),
    // "no" is the OpenSSH default for both, so only write explicit "yes"
    compression: s.compression || undefined,
    forward_agent: s.forwardAgent || undefined,
    strict_host_key_checking: s.strictHostKeyChecking || undefined,
    host_key_algorithms: setSshRsa(s.hostKeyAlgorithms, s.legacyRsa),
    pubkey_accepted_key_types: setSshRsa(s.pubkeyAcceptedKeyTypes, s.legacyRsa),
    local_forward: forwards.filter((f) => f.kind === 'local').map(forwardLine),
    remote_forward: forwards.filter((f) => f.kind === 'remote').map(forwardLine),
    dynamic_forward: forwards.filter((f) => f.kind === 'dynamic').map(forwardLine),
    extra_options: extra,
  }
}

// Mirrors validate_forward in src-tauri/src/commands/config.rs
const isPort = (s: string) => /^\d{1,5}$/.test(s) && Number(s) <= 65535
const isPath = (s: string) => s.startsWith('/') || s.startsWith('~')
const hostPort = (s: string) => {
  const i = s.lastIndexOf(':')
  return i > 0 && isPort(s.slice(i + 1))
}
const isListen = (s: string) => isPath(s) || isPort(s) || hostPort(s)
const isDestination = (s: string) => isPath(s) || hostPort(s)

export function validateAdvanced(s: AdvancedState, t: (key: string) => string): AdvancedErrors {
  const errors: AdvancedErrors = {}
  const number = (field: keyof AdvancedState, value: string, min: number) => {
    if (value.trim() && !(/^\d+$/.test(value.trim()) && Number(value) >= min)) {
      errors[field] = min > 0 ? t('hostDialog.adv.errorPositive') : t('hostDialog.adv.errorNumber')
    }
  }
  number('connectTimeout', s.connectTimeout, 1)
  number('connectionAttempts', s.connectionAttempts, 1)
  number('serverAliveInterval', s.serverAliveInterval, 0)
  number('serverAliveCountMax', s.serverAliveCountMax, 1)

  // Local and SOCKS forwards listen on this machine, remote forwards on the server;
  // two listeners on the same side and port can't both bind.
  const listeners = new Set<string>()
  for (const f of s.forwards) {
    if (isBlankForward(f)) continue
    const listen = f.listen.trim()
    const dest = f.dest.trim()
    const side = f.kind === 'remote' ? 'remote' : 'local'
    const port = isPath(listen) ? listen : listen.slice(listen.lastIndexOf(':') + 1)
    if (!isListen(listen) || /\s/.test(listen)) errors[`fwd-${f.id}-listen`] = t('hostDialog.adv.errorListen')
    else if (listeners.has(`${side}:${port}`)) errors[`fwd-${f.id}-listen`] = t('hostDialog.adv.errorListenTaken')
    listeners.add(`${side}:${port}`)
    if (f.kind === 'local' && !dest) errors[`fwd-${f.id}-dest`] = t('hostDialog.adv.errorDestRequired')
    else if (f.kind !== 'dynamic' && dest && (!isDestination(dest) || /\s/.test(dest))) {
      errors[`fwd-${f.id}-dest`] = t('hostDialog.adv.errorDest')
    }
  }

  const seen = new Set<string>()
  for (const row of s.extras) {
    const key = row.key.trim()
    if (!key && !row.value.trim()) continue
    const lower = key.toLowerCase()
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) errors[`extra-${row.id}-key`] = t('hostDialog.adv.errorKeyword')
    else if (MANAGED_KEYWORDS.has(lower)) errors[`extra-${row.id}-key`] = t('hostDialog.adv.errorManaged')
    else if (seen.has(lower)) errors[`extra-${row.id}-key`] = t('hostDialog.adv.errorDuplicate')
    if (!row.value.trim()) errors[`extra-${row.id}-value`] = t('hostDialog.adv.errorValue')
    seen.add(lower)
  }
  return errors
}

// ── UI ───────────────────────────────────────────────────────────────────────

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Box
      sx={(theme) => ({
        '& + &': { borderTop: `1px solid ${theme.tokens.border}`, pt: 2.5, mt: 2.5 },
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1.75 }}>
        <Box>
          <Typography variant="subtitle1">{title}</Typography>
          {description && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
              {description}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      {children}
    </Box>
  )
}

function SwitchRow({
  label,
  description,
  warning,
  checked,
  onChange,
}: {
  label: string
  description: string
  warning?: boolean
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, py: 1 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body1" fontWeight={500}>
          {label}
        </Typography>
        <Typography
          variant="caption"
          component="div"
          sx={(theme) => ({ color: warning && checked ? theme.tokens.warningForeground : 'text.secondary' })}
        >
          {description}
        </Typography>
      </Box>
      <Switch checked={checked} onChange={(e) => onChange(e.target.checked)} sx={{ flexShrink: 0, mr: 0 }} />
    </Box>
  )
}

function ColumnLabel({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary', ...sx }}>{children}</Typography>
  )
}

interface HostAdvancedOptionsProps {
  value: AdvancedState
  onChange: (next: AdvancedState) => void
  errors: AdvancedErrors
}

function HostAdvancedOptions({ value: s, onChange, errors }: HostAdvancedOptionsProps) {
  const { t } = useTranslation()
  const set = <K extends keyof AdvancedState>(key: K, v: AdvancedState[K]) => onChange({ ...s, [key]: v })

  const updateForward = (id: number, patch: Partial<ForwardRow>) =>
    set('forwards', s.forwards.map((f) => (f.id === id ? { ...f, ...patch, converted: false } : f)))
  const updateExtra = (id: number, patch: Partial<ExtraRow>) =>
    set('extras', s.extras.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const numberField = (field: 'connectTimeout' | 'connectionAttempts' | 'serverAliveInterval' | 'serverAliveCountMax', label: string, helper: string, placeholder: string) => (
    <Grid item xs={12} sm={6}>
      <TextField
        fullWidth
        label={label}
        value={s[field]}
        placeholder={placeholder}
        onChange={(e) => set(field, e.target.value.replace(/[^\d]/g, ''))}
        error={!!errors[field]}
        helperText={errors[field] ?? helper}
        inputProps={{ inputMode: 'numeric' }}
      />
    </Grid>
  )

  const strictOptions = ['', 'accept-new', 'yes', 'ask', 'no']
  if (s.strictHostKeyChecking && !strictOptions.includes(s.strictHostKeyChecking)) {
    strictOptions.push(s.strictHostKeyChecking) // keep unusual values such as "off"
  }
  const strictInsecure = s.strictHostKeyChecking === 'no' || s.strictHostKeyChecking === 'off'

  const usedKeys = new Set(s.extras.map((r) => r.key.toLowerCase()))
  const suggestions = SUGGESTED_KEYWORDS.filter((k) => !usedKeys.has(k.toLowerCase()))

  return (
    <Box>
      <Section title={t('hostDialog.adv.connection')} description={t('hostDialog.adv.connectionHint')}>
        <Grid container spacing={2}>
          {numberField('connectTimeout', t('hostDialog.adv.connectTimeout'), t('hostDialog.adv.connectTimeoutHelper'), '')}
          {numberField('connectionAttempts', t('hostDialog.adv.connectionAttempts'), t('hostDialog.adv.connectionAttemptsHelper'), '1')}
          {numberField('serverAliveInterval', t('hostDialog.fieldServerAliveInterval'), t('hostDialog.adv.serverAliveIntervalHelper'), '60')}
          {numberField('serverAliveCountMax', t('hostDialog.adv.serverAliveCountMax'), t('hostDialog.adv.serverAliveCountMaxHelper'), '3')}
        </Grid>
        <Box sx={{ mt: 1 }}>
          <SwitchRow
            label={t('hostDialog.adv.compression')}
            description={t('hostDialog.adv.compressionHelper')}
            checked={s.compression}
            onChange={(v) => set('compression', v)}
          />
        </Box>
      </Section>

      <Section title={t('hostDialog.adv.security')}>
        <TextField
          fullWidth
          select
          label={t('hostDialog.fieldStrictHostKeyChecking')}
          value={s.strictHostKeyChecking}
          onChange={(e) => set('strictHostKeyChecking', e.target.value)}
          helperText={t(`hostDialog.adv.strictHelp.${strictOptions.slice(0, 5).includes(s.strictHostKeyChecking) ? s.strictHostKeyChecking || 'default' : 'other'}`)}
          FormHelperTextProps={{ sx: (theme) => (strictInsecure ? { color: theme.tokens.warningForeground } : {}) }}
          SelectProps={{ displayEmpty: true }}
          sx={{ mb: 1 }}
        >
          {strictOptions.map((option) => (
            <MenuItem key={option} value={option}>
              {t(`hostDialog.adv.strict.${option || 'default'}`, { defaultValue: option })}
            </MenuItem>
          ))}
        </TextField>
        <SwitchRow
          label={t('hostDialog.adv.identitiesOnly')}
          description={t('hostDialog.adv.identitiesOnlyHelper')}
          checked={s.identitiesOnly}
          onChange={(v) => set('identitiesOnly', v)}
        />
        <SwitchRow
          label={t('hostDialog.fieldForwardAgent')}
          description={t('hostDialog.adv.forwardAgentHelper')}
          warning
          checked={s.forwardAgent}
          onChange={(v) => set('forwardAgent', v)}
        />
        <SwitchRow
          label={t('hostDialog.adv.legacyRsa')}
          description={t('hostDialog.adv.legacyRsaHelper')}
          warning
          checked={s.legacyRsa}
          onChange={(v) => set('legacyRsa', v)}
        />
      </Section>

      <Section
        title={t('hostDialog.adv.forwarding')}
        description={t('hostDialog.adv.forwardingHint')}
        action={
          <Button
            size="small"
            startIcon={<Add />}
            onClick={() => set('forwards', [...s.forwards, { id: newId(), kind: 'local', listen: '', dest: '' }])}
          >
            {t('hostDialog.adv.addForward')}
          </Button>
        }
      >
        {s.forwards.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('hostDialog.adv.noForwards')}
          </Typography>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: '132px 1fr 20px 1fr 28px', columnGap: 1, rowGap: 0.5, alignItems: 'start' }}>
            <ColumnLabel>{t('hostDialog.adv.forwardType')}</ColumnLabel>
            <ColumnLabel>{t('hostDialog.adv.forwardListen')}</ColumnLabel>
            <span />
            <ColumnLabel>{t('hostDialog.adv.forwardDest')}</ColumnLabel>
            <span />
            {s.forwards.map((f) => {
              const listenError = errors[`fwd-${f.id}-listen`]
              const destError = errors[`fwd-${f.id}-dest`]
              const preview = !isBlankForward(f) && !listenError && !destError
              return (
                <Box key={f.id} sx={{ display: 'contents' }}>
                  <TextField select value={f.kind} onChange={(e) => updateForward(f.id, { kind: e.target.value as ForwardKind })}>
                    <MenuItem value="local">{t('hostDialog.adv.kindLocal')}</MenuItem>
                    <MenuItem value="remote">{t('hostDialog.adv.kindRemote')}</MenuItem>
                    <MenuItem value="dynamic">{t('hostDialog.adv.kindDynamic')}</MenuItem>
                  </TextField>
                  <TextField
                    value={f.listen}
                    placeholder={f.kind === 'dynamic' ? '1080' : '8080'}
                    onChange={(e) => updateForward(f.id, { listen: e.target.value.trim() })}
                    error={!!listenError}
                    helperText={listenError}
                    inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
                  />
                  <ArrowForward sx={{ fontSize: 16, color: 'text.secondary', mt: 1 }} />
                  <TextField
                    value={f.kind === 'dynamic' ? '' : f.dest}
                    disabled={f.kind === 'dynamic'}
                    placeholder={
                      f.kind === 'dynamic'
                        ? t('hostDialog.adv.socksProxy')
                        : f.kind === 'remote'
                          ? t('hostDialog.adv.destRemotePlaceholder')
                          : 'localhost:80'
                    }
                    onChange={(e) => updateForward(f.id, { dest: e.target.value.trim() })}
                    error={!!destError}
                    helperText={destError}
                    inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
                  />
                  <Tooltip title={t('common.delete')}>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => set('forwards', s.forwards.filter((x) => x.id !== f.id))}
                      sx={{ mt: 0.25 }}
                    >
                      <DeleteOutline />
                    </IconButton>
                  </Tooltip>
                  {preview && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      // Full-width row so grid auto-placement doesn't shift the next row; indent under "Listen"
                      sx={{ gridColumn: '1 / -1', pl: 'calc(132px + 8px)', fontFamily: FONT_MONO, mt: -0.25, mb: 0.5 }}
                    >
                      {FORWARD_KEYWORD[f.kind]} {forwardLine(f)}
                      {f.converted && (
                        <Box component="span" sx={(theme) => ({ ml: 1, fontFamily: 'inherit', color: theme.tokens.warningForeground })}>
                          · {t('hostDialog.adv.convertedHint')}
                        </Box>
                      )}
                    </Typography>
                  )}
                </Box>
              )
            })}
          </Box>
        )}
      </Section>

      <Section
        title={t('hostDialog.adv.otherOptions')}
        description={t('hostDialog.adv.otherOptionsHint')}
        action={
          <Button size="small" startIcon={<Add />} onClick={() => set('extras', [...s.extras, { id: newId(), key: '', value: '' }])}>
            {t('hostDialog.adv.addOption')}
          </Button>
        }
      >
        {s.extras.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('hostDialog.adv.noOptions')}
          </Typography>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: '220px 1fr 28px', columnGap: 1, rowGap: 1, alignItems: 'start' }}>
            <ColumnLabel>{t('hostDialog.adv.keyword')}</ColumnLabel>
            <ColumnLabel>{t('hostDialog.adv.value')}</ColumnLabel>
            <span />
            {s.extras.map((row) => (
              <Box key={row.id} sx={{ display: 'contents' }}>
                <Autocomplete
                  freeSolo
                  options={suggestions}
                  inputValue={row.key}
                  onInputChange={(_, v) => updateExtra(row.id, { key: v.trim() })}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder="LogLevel"
                      error={!!errors[`extra-${row.id}-key`]}
                      helperText={errors[`extra-${row.id}-key`]}
                      inputProps={{ ...params.inputProps, spellCheck: false }}
                    />
                  )}
                />
                <TextField
                  value={row.value}
                  placeholder="INFO"
                  onChange={(e) => updateExtra(row.id, { value: e.target.value })}
                  error={!!errors[`extra-${row.id}-value`]}
                  helperText={errors[`extra-${row.id}-value`]}
                  inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
                />
                <Tooltip title={t('common.delete')}>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => set('extras', s.extras.filter((x) => x.id !== row.id))}
                    sx={{ mt: 0.25 }}
                  >
                    <DeleteOutline />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}
      </Section>
    </Box>
  )
}

export default HostAdvancedOptions
