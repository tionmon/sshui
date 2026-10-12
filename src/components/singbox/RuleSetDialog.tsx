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
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { allOutbounds, clone, ruleSetTags, ruleSetsOf, setIn, type Obj } from '../../lib/singbox/doc'
import {
  RULESET_PRESETS,
  defaultSource,
  detectMirror,
  formatFromName,
  ruleSetTag,
  sharedDownloadDetour,
  templateEntryFor,
  type RuleSetPreset,
  type RuleSetSource,
} from '../../lib/singbox/rules'
import { addPresetRuleSets, saveRule, saveRuleSet } from '../../lib/singbox/ops'
import { edit, useSingbox } from '../../lib/singbox/store'
import { useToast, errorMessage } from '../../contexts/ToastContext'
import { FONT_MONO } from '../../theme'
import { FormSection, ListInput, OutboundSelect, mono } from './common'
import JsonEditor from './JsonEditor'

/** "geosite-netflix" or "geoip:jp" typed by the user → a preset */
const parsePreset = (text: string): RuleSetPreset | null => {
  const m = text.trim().match(/^(geosite|geoip)[-:](.+)$/i)
  return m ? { db: m[1].toLowerCase() as 'geosite' | 'geoip', name: m[2].trim().toLowerCase() } : null
}

function RuleSetDialog({ open, index, initial, onClose }: { open: boolean; index: number | null; initial: Obj | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc = session?.current.doc ?? {}
  const existing = ruleSetsOf(doc)
  const mirror = detectMirror(existing)
  const [mode, setMode] = useState<'preset' | 'custom'>('preset')
  const [presets, setPresets] = useState<RuleSetPreset[]>([])
  const [source, setSource] = useState<RuleSetSource>('github')
  const [download, setDownload] = useState('')
  const [routeTo, setRouteTo] = useState('')
  const [rs, setRs] = useState<Obj>({})
  const [inlineText, setInlineText] = useState('[]')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMode(index !== null ? 'custom' : 'preset')
    setPresets([])
    setSource(defaultSource(existing))
    setDownload(sharedDownloadDetour(existing) ?? '')
    setRouteTo('')
    setRs(initial ? clone(initial) : { type: 'remote', tag: '', format: 'binary', url: '' })
    setInlineText(JSON.stringify(initial?.rules ?? [], null, 2))
    setTouched(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, index])

  const editing = index !== null
  const originalTags = initial ? ruleSetTags(initial) : []
  const takenTags = new Set(existing.flatMap(ruleSetTags).filter((tag) => !originalTags.includes(tag)))
  // Entries that define several tags at once keep doing so
  const multi = Array.isArray(rs.tag)
  const entryName = (tags: string[]) =>
    tags.length > 1 ? t('singbox.ruleSetGroup', { first: tags[0], count: tags.length - 1 }) : (tags[0] ?? '')
  const outbounds = allOutbounds(doc)
    .filter((o) => o.tagged && !['block', 'dns'].includes(o.type))
    .map((o) => ({ tag: o.tag, type: o.type }))
  const set = (path: string, value: unknown) => {
    const next = clone(rs)
    setIn(next, path, value)
    setRs(next)
  }

  const savePresets = () => {
    setTouched(true)
    const fresh = presets.filter((p) => !takenTags.has(ruleSetTag(p)))
    const tags = presets.map(ruleSetTag)
    if (tags.length === 0) return
    const added = edit((s) => {
      const added = addPresetRuleSets(s, fresh, source, download || undefined)
      if (routeTo) saveRule(s, null, { rule_set: tags, outbound: routeTo })
      return added
    })
    toast(t('singbox.ruleSetsAdded', { count: added.length }))
    onClose()
  }

  const saveCustom = () => {
    setTouched(true)
    const final = clone(rs)
    final.tag = multi ? ruleSetTags(final).map((x) => x.trim()).filter(Boolean) : String(final.tag ?? '').trim()
    const finalTags = ruleSetTags(final)
    if (finalTags.length === 0 || finalTags.some((x) => takenTags.has(x))) return
    if (final.type === 'remote' && !/^https?:\/\/\S+$/.test(String(final.url ?? ''))) return
    if (final.type === 'local' && !final.path) return
    if (final.type === 'inline') {
      try {
        const rules = JSON.parse(inlineText)
        if (!Array.isArray(rules)) throw new Error(t('singbox.inlineNeedsArray'))
        final.rules = rules
      } catch (e) {
        setError(errorMessage(e))
        return
      }
      delete final.format
    }
    // Fields of the other types would make sing-box reject the definition
    if (final.type !== 'remote') ['url', 'download_detour', 'update_interval'].forEach((k) => delete final[k])
    if (final.type !== 'local') delete final.path
    if (final.type !== 'inline') delete final.rules
    try {
      edit((s) => saveRuleSet(s, index, final))
      toast(editing ? t('singbox.ruleSetSaved', { tag: entryName(finalTags) }) : t('singbox.ruleSetAdded', { tag: entryName(finalTags) }))
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const tagValues = ruleSetTags(rs).map((x) => x.trim()).filter(Boolean)
  const tagError = tagValues.length === 0 ? t('singbox.tagRequired') : tagValues.some((x) => takenTags.has(x)) ? t('singbox.tagTaken') : null
  const urlError = rs.type === 'remote' && !/^https?:\/\/\S+$/.test(String(rs.url ?? '')) ? t('devtools.invalidUrl') : null

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? t('singbox.editRuleSet', { tag: entryName(originalTags) }) : t('singbox.addRuleSet')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, mt: 1 }}>
          {!editing && (
            <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, v) => v && setMode(v)}>
              <ToggleButton value="preset">{t('singbox.fromPresets')}</ToggleButton>
              <ToggleButton value="custom">{t('singbox.custom')}</ToggleButton>
            </ToggleButtonGroup>
          )}
          {error && <Alert severity="error">{error}</Alert>}

          {mode === 'preset' ? (
            <>
              <Autocomplete
                multiple
                freeSolo
                options={RULESET_PRESETS}
                value={presets}
                getOptionLabel={(o) => (typeof o === 'string' ? o : ruleSetTag(o))}
                isOptionEqualToValue={(a, b) => ruleSetTag(a) === ruleSetTag(b)}
                onChange={(_, v) => {
                  const next = v.map((x) => (typeof x === 'string' ? parsePreset(x) : x)).filter((x): x is RuleSetPreset => !!x)
                  setPresets(next.filter((p, i) => next.findIndex((q) => ruleSetTag(q) === ruleSetTag(p)) === i))
                }}
                renderOption={(props, o) => {
                  const { key, ...rest } = props as typeof props & { key: string }
                  return (
                    <li key={key} {...rest}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                        <Typography sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>{ruleSetTag(o)}</Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                          {takenTags.has(ruleSetTag(o)) ? t('singbox.alreadyAdded') : t(`singbox.presets.${o.db}-${o.name}`, { defaultValue: '' })}
                        </Typography>
                      </Box>
                    </li>
                  )
                }}
                renderTags={(items, getTagProps) =>
                  items.map((item, index) => {
                    const { key, ...props } = getTagProps({ index })
                    return <Chip key={key} label={ruleSetTag(item)} {...props} sx={{ fontFamily: FONT_MONO }} />
                  })
                }
                renderInput={(params) => (
                  <TextField {...params} label={t('singbox.ruleSets')} placeholder={presets.length ? undefined : 'geosite-cn'} helperText={t('singbox.presetHint')} error={touched && presets.length === 0} />
                )}
              />
              <TextField select label={t('singbox.downloadFrom')} value={source} onChange={(e) => setSource(e.target.value as RuleSetSource)} helperText={t('singbox.downloadFromHint')}>
                {mirror && <MenuItem value={mirror}>{t('singbox.sameMirror', { host: mirror.replace(/^https?:\/\//, '').replace(/\/$/, '') })}</MenuItem>}
                <MenuItem value="github">GitHub (raw.githubusercontent.com)</MenuItem>
                <MenuItem value="jsdelivr">jsDelivr CDN</MenuItem>
              </TextField>
              {presets.some((p) => !takenTags.has(ruleSetTag(p)) && templateEntryFor(existing, p)) && (
                <Alert severity="info">{t('singbox.joinsTemplate')}</Alert>
              )}
              <OutboundSelect label={t('singbox.downloadVia')} value={download} onChange={setDownload} options={outbounds} emptyLabel={t('singbox.downloadDirect')} helperText={t('singbox.downloadViaHint')} />
              <FormSection title={t('singbox.alsoRoute')}>
                <OutboundSelect label={t('singbox.routeTo')} value={routeTo} onChange={setRouteTo} options={outbounds} emptyLabel={t('singbox.noRule')} helperText={t('singbox.alsoRouteHint')} />
              </FormSection>
            </>
          ) : (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 2, alignItems: 'start' }}>
                {multi ? (
                  <ListInput
                    label={t('singbox.tags')}
                    value={ruleSetTags(rs)}
                    onChange={(v) => set('tag', v.length ? v : [''])}
                    error={touched && !!tagError}
                    helperText={touched && tagError ? tagError : t('singbox.multiTagHint')}
                  />
                ) : (
                  <TextField label={t('singbox.tag')} value={rs.tag ?? ''} onChange={(e) => set('tag', e.target.value)} error={touched && !!tagError} helperText={touched && tagError} required inputProps={mono} />
                )}
                <ToggleButtonGroup exclusive size="small" value={rs.type} onChange={(_, v) => v && set('type', v)} sx={{ height: 40 }}>
                  <ToggleButton value="remote">{t('singbox.remote')}</ToggleButton>
                  <ToggleButton value="local">{t('singbox.local')}</ToggleButton>
                  <ToggleButton value="inline">{t('singbox.inline')}</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              {rs.type === 'remote' && (
                <>
                  <TextField
                    label="URL"
                    value={rs.url ?? ''}
                    onChange={(e) => {
                      const next = clone(rs)
                      next.url = e.target.value.trim()
                      next.format = formatFromName(next.url)
                      setRs(next)
                    }}
                    error={touched && !!urlError}
                    helperText={touched && urlError}
                    inputProps={mono}
                    placeholder="https://…/geosite-cn.srs"
                  />
                  <OutboundSelect label={t('singbox.downloadVia')} value={rs.download_detour ?? ''} onChange={(v) => set('download_detour', v)} options={outbounds} emptyLabel={t('singbox.downloadDirect')} helperText={t('singbox.downloadViaHint')} />
                  <TextField label={t('singbox.fields.update_interval')} value={rs.update_interval ?? ''} placeholder="1d" onChange={(e) => set('update_interval', e.target.value.trim())} inputProps={mono} />
                </>
              )}
              {rs.type === 'local' && (
                <TextField
                  label={t('singbox.fields.path')}
                  value={rs.path ?? ''}
                  onChange={(e) => {
                    const next = clone(rs)
                    next.path = e.target.value
                    next.format = formatFromName(next.path)
                    setRs(next)
                  }}
                  error={touched && !rs.path}
                  inputProps={mono}
                  helperText={t('singbox.localPathHint')}
                />
              )}
              {rs.type !== 'inline' && (
                <TextField select label={t('singbox.format')} value={rs.format ?? 'binary'} onChange={(e) => set('format', e.target.value)}>
                  <MenuItem value="binary">{t('singbox.formatBinary')}</MenuItem>
                  <MenuItem value="source">{t('singbox.formatSource')}</MenuItem>
                </TextField>
              )}
              {rs.type === 'inline' && (
                <>
                  <JsonEditor value={inlineText} onChange={setInlineText} height={220} />
                  <Typography variant="caption" color="text.secondary">
                    {t('singbox.inlineHint')}
                  </Typography>
                </>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={mode === 'preset' ? savePresets : saveCustom} disabled={mode === 'preset' && presets.length === 0}>
          {editing ? t('common.save') : t('singbox.add')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default RuleSetDialog
