import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Add, Close } from '@mui/icons-material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { allOutbounds, allRuleSetTags, asList, clone, inboundTagsOf, parseConfig, type Obj } from '../../lib/singbox/doc'
import { matcherKeys } from '../../lib/singbox/refs'
import { ACTIONS, MATCHERS, actionOf, isLogical, matcherDef, type MatcherDef } from '../../lib/singbox/rules'
import { saveRule } from '../../lib/singbox/ops'
import { edit, useSingbox } from '../../lib/singbox/store'
import { useToast, errorMessage } from '../../contexts/ToastContext'
import { FONT_MONO } from '../../theme'
import { FormSection, ListInput, OutboundSelect, mono } from './common'
import JsonEditor from './JsonEditor'

/** Fields that belong to one action; switching actions removes the others. */
const ACTION_FIELDS: Record<string, string[]> = {
  route: ['outbound'],
  reject: ['method', 'no_drop'],
  sniff: ['sniffer', 'timeout'],
  resolve: ['strategy', 'server'],
}
const SNIFFERS = ['http', 'tls', 'quic', 'dns', 'stun', 'bittorrent', 'dtls', 'ssh', 'rdp', 'ntp']

function ConditionEditor({
  def,
  rule,
  onChange,
  ruleSets,
  inbounds,
}: {
  def: MatcherDef
  rule: Obj
  onChange: (value: unknown) => void
  ruleSets: string[]
  inbounds: string[]
}) {
  const { t } = useTranslation()
  const label = def.key
  const value = rule[def.key]
  switch (def.kind) {
    case 'bool':
      return <FormControlLabel sx={{ ml: 0, gap: 1 }} control={<Switch checked={value !== false} onChange={(e) => onChange(e.target.checked)} />} label={t(`singbox.matchers.${def.key}`)} />
    case 'select':
      return (
        <TextField select label={label} value={asList(value)[0] ?? ''} onChange={(e) => onChange(e.target.value)} fullWidth>
          {def.options?.map((o) => (
            <MenuItem key={o} value={o}>
              {o}
            </MenuItem>
          ))}
        </TextField>
      )
    case 'multiselect':
    case 'ruleset':
    case 'inbound': {
      const options = def.kind === 'ruleset' ? ruleSets : def.kind === 'inbound' ? inbounds : (def.options ?? [])
      return (
        <Autocomplete
          multiple
          freeSolo={def.kind !== 'multiselect'}
          options={options}
          value={asList(value)}
          onChange={(_, v) => onChange(v)}
          renderTags={(items, getTagProps) =>
            items.map((item, index) => {
              const { key, ...props } = getTagProps({ index })
              const missing = def.kind === 'ruleset' && !ruleSets.includes(item)
              return <Chip key={key} label={item} color={missing ? 'error' : 'default'} {...props} sx={{ fontFamily: FONT_MONO }} />
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label={label}
              helperText={def.kind === 'ruleset' && ruleSets.length === 0 ? t('singbox.noRuleSetsYet') : undefined}
            />
          )}
        />
      )
    }
    case 'ports':
      return (
        <ListInput
          label={label}
          value={asList(value)}
          placeholder={def.placeholder}
          onChange={(v) => onChange(v.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 65536))}
        />
      )
    default:
      return <ListInput label={label} value={asList(value)} placeholder={def.placeholder} onChange={onChange} />
  }
}

function RuleDialog({ open, index, initial, onClose }: { open: boolean; index: number | null; initial: Obj | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc = session?.current.doc ?? {}
  const [rule, setRule] = useState<Obj>({})
  const [tab, setTab] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    setRule(initial ? clone(initial) : { domain_suffix: [] })
    setTab('form')
    setTouched(false)
    setJsonError(null)
  }, [open, initial])

  const action = actionOf(rule)
  const logical = isLogical(rule)
  const keys = matcherKeys(rule)
  const known = keys.filter((k) => matcherDef(k))
  const unknown = keys.filter((k) => !matcherDef(k))
  const ruleSets = allRuleSetTags(doc)
  const inbounds = inboundTagsOf(doc)
  const outbounds = allOutbounds(doc)
    .filter((o) => o.tagged && !['dns'].includes(o.type))
    .map((o) => ({ tag: o.tag, type: o.type }))

  const update = (fn: (r: Obj) => void) => {
    const next = clone(rule)
    fn(next)
    setRule(next)
  }
  const setAction = (next: string) =>
    update((r) => {
      for (const [a, fields] of Object.entries(ACTION_FIELDS)) if (a !== next) fields.forEach((f) => delete r[f])
      // Routing is the default action; leaving it out keeps the rule valid for sing-box < 1.11
      if (next === 'route' && !initial?.action) delete r.action
      else r.action = next
    })
  const setCondition = (key: string, value: unknown) => update((r) => (r[key] = value))
  const removeCondition = (key: string) => update((r) => delete r[key])

  const switchTab = (next: 'form' | 'json') => {
    if (next === 'json') {
      setJsonText(JSON.stringify(rule, null, 2))
      setJsonError(null)
      setTab('json')
      return
    }
    try {
      setRule(parseConfig(jsonText).doc)
      setTab('form')
    } catch (e) {
      setJsonError(errorMessage(e))
    }
  }

  /** Empty condition lists would make sing-box reject the rule (or match everything) */
  const cleaned = (r: Obj) => {
    const out = clone(r)
    for (const key of matcherKeys(out)) {
      const v = out[key]
      if (Array.isArray(v) && v.length === 0) delete out[key]
      if (v === '' || v === undefined) delete out[key]
    }
    return out
  }

  const save = () => {
    setTouched(true)
    let final = rule
    if (tab === 'json') {
      try {
        final = parseConfig(jsonText).doc
      } catch (e) {
        setJsonError(errorMessage(e))
        return
      }
    }
    final = cleaned(final)
    if (actionOf(final) === 'route' && !final.outbound) {
      setRule(final)
      setTab('form')
      return
    }
    try {
      edit((s) => saveRule(s, index, final))
      toast(index === null ? t('singbox.ruleAdded') : t('singbox.ruleSaved'))
      onClose()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const matchesEverything = !logical && keys.every((k) => {
    const v = rule[k]
    return v === undefined || (Array.isArray(v) && v.length === 0) || v === ''
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{index === null ? t('singbox.addRule') : t('singbox.editRule', { n: index + 1 })}</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v) => switchTab(v)} sx={{ mb: 2 }}>
          <Tab value="form" label={t('singbox.form')} />
          <Tab value="json" label="JSON" />
        </Tabs>
        {tab === 'json' ? (
          <>
            {jsonError && (
              <Alert severity="error" sx={{ mb: 1.5 }}>
                {jsonError}
              </Alert>
            )}
            <JsonEditor value={jsonText} onChange={setJsonText} height={420} />
          </>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <FormSection
              title={t('singbox.when')}
              action={
                !logical && (
                  <Button size="small" startIcon={<Add />} onClick={(e) => setAddMenu(e.currentTarget)}>
                    {t('singbox.addCondition')}
                  </Button>
                )
              }
            >
              {logical ? (
                <Alert severity="info">{t('singbox.logicalRule', { mode: String(rule.mode ?? 'and').toUpperCase(), count: Array.isArray(rule.rules) ? rule.rules.length : 0 })}</Alert>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {known.map((key) => (
                    <Box key={key} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <ConditionEditor def={matcherDef(key)!} rule={rule} onChange={(v) => setCondition(key, v)} ruleSets={ruleSets} inbounds={inbounds} />
                        {matcherDef(key)!.kind !== 'bool' && (
                          <Typography variant="caption" color="text.secondary" sx={{ px: 0.25 }}>
                            {t(`singbox.matchers.${key}`)}
                          </Typography>
                        )}
                      </Box>
                      <Tooltip title={t('singbox.removeCondition')}>
                        <IconButton size="small" onClick={() => removeCondition(key)} sx={{ mt: 1 }}>
                          <Close />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ))}
                  {unknown.length > 0 && (
                    <Alert severity="info">
                      {t('singbox.otherConditions')}{' '}
                      {unknown.map((k) => (
                        <Chip key={k} label={k} sx={{ ml: 0.5, fontFamily: FONT_MONO }} />
                      ))}
                    </Alert>
                  )}
                  {matchesEverything && <Alert severity={touched ? 'warning' : 'info'}>{t('singbox.noConditions')}</Alert>}
                  <FormControlLabel
                    sx={{ ml: 0, gap: 1 }}
                    control={<Switch checked={!!rule.invert} onChange={(e) => update((r) => (e.target.checked ? (r.invert = true) : delete r.invert))} />}
                    label={t('singbox.invert')}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {t('singbox.matchLogic')}
                  </Typography>
                </Box>
              )}
            </FormSection>

            <FormSection title={t('singbox.then')}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <TextField select label={t('singbox.action')} value={action} onChange={(e) => setAction(e.target.value)} helperText={t(`singbox.actions.${action}Hint`, { defaultValue: '' })}>
                  {[...ACTIONS, ...(ACTIONS.includes(action) ? [] : [action])].map((a) => (
                    <MenuItem key={a} value={a}>
                      {t(`singbox.actions.${a}`, { defaultValue: a })}
                    </MenuItem>
                  ))}
                </TextField>
                {action === 'route' && (
                  <OutboundSelect
                    label={t('singbox.routeTo')}
                    value={typeof rule.outbound === 'string' ? rule.outbound : ''}
                    onChange={(v) => update((r) => (r.outbound = v))}
                    options={outbounds}
                    error={touched && !rule.outbound}
                    helperText={touched && !rule.outbound ? t('singbox.outboundRequired') : undefined}
                  />
                )}
                {action === 'reject' && (
                  <TextField select SelectProps={{ displayEmpty: true }} label="method" value={rule.method ?? ''} onChange={(e) => update((r) => (e.target.value ? (r.method = e.target.value) : delete r.method))} helperText={t('singbox.rejectMethodHint')}>
                    <MenuItem value="">
                      <em>default</em>
                    </MenuItem>
                    <MenuItem value="drop">drop</MenuItem>
                  </TextField>
                )}
                {action === 'sniff' && (
                  <Autocomplete
                    multiple
                    options={SNIFFERS}
                    value={asList(rule.sniffer)}
                    onChange={(_, v) => update((r) => (v.length ? (r.sniffer = v) : delete r.sniffer))}
                    renderInput={(params) => <TextField {...params} label="sniffer" helperText={t('singbox.snifferHint')} />}
                  />
                )}
                {action === 'resolve' && (
                  <TextField select SelectProps={{ displayEmpty: true }} label="strategy" value={rule.strategy ?? ''} onChange={(e) => update((r) => (e.target.value ? (r.strategy = e.target.value) : delete r.strategy))}>
                    <MenuItem value="">
                      <em>{t('singbox.defaultValue')}</em>
                    </MenuItem>
                    {['prefer_ipv4', 'prefer_ipv6', 'ipv4_only', 'ipv6_only'].map((s) => (
                      <MenuItem key={s} value={s}>
                        {s}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                {action === 'resolve' && (
                  <TextField label="server" value={rule.server ?? ''} onChange={(e) => update((r) => (e.target.value ? (r.server = e.target.value) : delete r.server))} inputProps={mono} helperText={t('singbox.resolveServerHint')} />
                )}
              </Box>
            </FormSection>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={save}>
          {index === null ? t('singbox.add') : t('common.save')}
        </Button>
      </DialogActions>
      <Menu anchorEl={addMenu} open={!!addMenu} onClose={() => setAddMenu(null)}>
        {MATCHERS.filter((m) => !keys.includes(m.key)).map((m) => (
          <MenuItem
            key={m.key}
            onClick={() => {
              setCondition(m.key, m.kind === 'bool' ? true : m.kind === 'select' ? m.options?.[0] : [])
              setAddMenu(null)
            }}
          >
            <Box>
              <Typography sx={{ fontSize: '0.875rem', fontFamily: FONT_MONO }}>{m.key}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{t(`singbox.matchers.${m.key}`)}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </Dialog>
  )
}

export default RuleDialog
