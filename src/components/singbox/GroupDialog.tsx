import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { Add, ArrowDownward, ArrowUpward, Close, Search, VerticalAlignTop } from '@mui/icons-material'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { allOutbounds, clone, isGroupType, membersOf, parseConfig, setIn, type Obj } from '../../lib/singbox/doc'
import { addressOf, protocolOf } from '../../lib/singbox/protocols'
import { dependsOn } from '../../lib/singbox/refs'
import { changeGroupType, saveGroup } from '../../lib/singbox/ops'
import { edit, useSingbox } from '../../lib/singbox/store'
import { useToast, errorMessage } from '../../contexts/ToastContext'
import { FONT_MONO } from '../../theme'
import { FormSection, mono } from './common'
import JsonEditor from './JsonEditor'

export const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204'

/** Pick outbounds to add to a group, with search and "select all matching". */
function MemberPicker({
  open,
  candidates,
  onClose,
  onAdd,
}: {
  open: boolean
  candidates: { tag: string; type: string; address: string | null; hidden: boolean; disabled: boolean }[]
  onClose: () => void
  onAdd: (tags: string[]) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (open) {
      setQuery('')
      setPicked(new Set())
    }
  }, [open])
  let matcher: (s: string) => boolean
  try {
    // Plain text, or a regular expression such as "HK|香港"
    const re = new RegExp(query.trim(), 'i')
    matcher = (s) => re.test(s)
  } catch {
    matcher = (s) => s.toLowerCase().includes(query.trim().toLowerCase())
  }
  const visible = candidates.filter((c) => !query.trim() || matcher(c.tag) || matcher(c.address ?? ''))
  const selectable = visible.filter((c) => !c.disabled)
  const allPicked = selectable.length > 0 && selectable.every((c) => picked.has(c.tag))

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('singbox.addMembers')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, mb: 1.5 }}>
          <TextField
            size="small"
            autoFocus
            fullWidth
            placeholder={t('singbox.memberSearch')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ fontSize: 18 }} />
                </InputAdornment>
              ),
            }}
            inputProps={mono}
          />
          <Button
            size="small"
            sx={{ flexShrink: 0 }}
            disabled={selectable.length === 0}
            onClick={() => {
              const next = new Set(picked)
              selectable.forEach((c) => (allPicked ? next.delete(c.tag) : next.add(c.tag)))
              setPicked(next)
            }}
          >
            {allPicked ? t('singbox.selectNone') : t('singbox.selectAll', { count: selectable.length })}
          </Button>
        </Box>
        <Paper variant="outlined" sx={(th) => ({ maxHeight: 360, overflow: 'auto', '& > * + *': { borderTop: `1px solid ${th.tokens.border}` } })}>
          {visible.length === 0 && (
            <Typography sx={{ p: 2, textAlign: 'center', fontSize: '0.875rem', color: 'text.secondary' }}>{t('singbox.noMatches')}</Typography>
          )}
          {visible.map((c) => (
            <Box
              key={c.tag}
              component="label"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, cursor: c.disabled ? 'default' : 'pointer', opacity: c.disabled ? 0.5 : 1 }}
            >
              <Checkbox
                size="small"
                checked={picked.has(c.tag)}
                disabled={c.disabled}
                onChange={(e) => {
                  const next = new Set(picked)
                  if (e.target.checked) next.add(c.tag)
                  else next.delete(c.tag)
                  setPicked(next)
                }}
              />
              <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                {c.tag}
              </Typography>
              <Chip label={protocolOf(c.type)?.label ?? c.type} color={isGroupType(c.type) ? 'info' : 'default'} />
              {c.hidden && <Chip label={t('singbox.hidden')} />}
              <Typography noWrap sx={{ flex: 1, fontSize: '0.75rem', fontFamily: FONT_MONO, color: 'text.secondary', textAlign: 'right' }}>
                {c.disabled ? t('singbox.wouldLoop') : c.address}
              </Typography>
            </Box>
          ))}
        </Paper>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={picked.size === 0}
          onClick={() => {
            // Keep file order rather than click order
            onAdd(candidates.filter((c) => picked.has(c.tag)).map((c) => c.tag))
            onClose()
          }}
        >
          {t('singbox.addCount', { count: picked.size })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function GroupDialog({ open, originalTag, initial, onClose }: { open: boolean; originalTag: string | null; initial: Obj | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc = session?.current.doc ?? {}
  const meta = session?.current.meta
  const [group, setGroup] = useState<Obj>({})
  const [tab, setTab] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (!open) return
    setGroup(initial ? clone(initial) : { type: 'selector', tag: '', outbounds: [] })
    setTab('form')
    setTouched(false)
    setJsonError(null)
  }, [open, initial])

  const tag = typeof group.tag === 'string' ? group.tag.trim() : ''
  const members = membersOf(group)
  const outbounds = allOutbounds(doc).filter((o) => o.tagged)
  const byTag = new Map(outbounds.map((o) => [o.tag, o]))
  const taken = new Set(outbounds.filter((o) => o.tag !== originalTag).map((o) => o.tag))
  const tagError = !tag ? t('singbox.tagRequired') : taken.has(tag) ? t('singbox.tagTaken') : null
  const candidates = useMemo(
    () =>
      outbounds
        .filter((o) => o.tag !== originalTag && !members.includes(o.tag) && !['dns'].includes(o.type))
        .map((o) => ({
          tag: o.tag,
          type: o.type,
          address: addressOf(o.value),
          hidden: !!meta?.hidden[o.tag],
          // A group can't contain something that depends on it
          disabled: !!originalTag && dependsOn(doc, o.tag, originalTag),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, originalTag, members.join('\n'), meta],
  )

  const set = (path: string, value: unknown) => {
    const next = clone(group)
    setIn(next, path, value)
    setGroup(next)
  }
  const setMembers = (list: string[]) => {
    const next = clone(group)
    next.outbounds = list
    if (next.default && !list.includes(next.default)) delete next.default
    setGroup(next)
  }
  const move = (from: number, to: number) => {
    const list = [...members]
    const [m] = list.splice(from, 1)
    list.splice(to, 0, m)
    setMembers(list)
  }

  const switchTab = (next: 'form' | 'json') => {
    if (next === 'json') {
      setJsonText(JSON.stringify(group, null, 2))
      setJsonError(null)
      setTab('json')
      return
    }
    try {
      setGroup(parseConfig(jsonText).doc)
      setTab('form')
    } catch (e) {
      setJsonError(errorMessage(e))
    }
  }

  const save = () => {
    setTouched(true)
    let final = group
    if (tab === 'json') {
      try {
        final = parseConfig(jsonText).doc
      } catch (e) {
        setJsonError(errorMessage(e))
        return
      }
      if (!isGroupType(final.type)) {
        setJsonError(t('singbox.notAGroup'))
        return
      }
    }
    const finalTag = typeof final.tag === 'string' ? final.tag.trim() : ''
    if (!finalTag || taken.has(finalTag) || membersOf(final).length === 0) {
      setGroup(final)
      setTab('form')
      return
    }
    try {
      edit((s) => saveGroup(s, originalTag, { ...final, tag: finalTag }))
      toast(originalTag ? t('singbox.groupSaved', { tag: finalTag }) : t('singbox.groupAdded', { tag: finalTag }))
      onClose()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const isSelector = group.type === 'selector'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{originalTag ? t('singbox.editGroup', { tag: originalTag }) : t('singbox.addGroup')}</DialogTitle>
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
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 2, alignItems: 'start' }}>
              <TextField
                label={t('singbox.groupName')}
                value={group.tag ?? ''}
                autoFocus={!originalTag}
                required
                error={touched && !!tagError}
                helperText={touched && tagError ? tagError : undefined}
                onChange={(e) => set('tag', e.target.value)}
              />
              <ToggleButtonGroup
                exclusive
                size="small"
                value={group.type}
                onChange={(_, v) => v && setGroup(changeGroupType(group, v))}
                sx={{ height: 40 }}
              >
                <ToggleButton value="selector">{t('singbox.selector')}</ToggleButton>
                <ToggleButton value="urltest">{t('singbox.urltest')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: -1.5 }}>
              {isSelector ? t('singbox.selectorHint') : t('singbox.urltestHint')}
            </Typography>

            <FormSection
              title={`${t('singbox.members')} · ${members.length}`}
              action={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {members.length > 0 && (
                    <Button size="small" onClick={() => setMembers([])}>
                      {t('singbox.removeAll')}
                    </Button>
                  )}
                  <Button size="small" startIcon={<Add />} onClick={() => setPicking(true)}>
                    {t('singbox.addMembers')}
                  </Button>
                </Box>
              }
            >
              {members.length === 0 ? (
                <Alert severity={touched ? 'error' : 'info'}>{t('singbox.needsMembers')}</Alert>
              ) : (
                <Paper variant="outlined" sx={(th) => ({ maxHeight: 300, overflow: 'auto', '& > * + *': { borderTop: `1px solid ${th.tokens.border}` } })}>
                  {members.map((m, i) => {
                    const o = byTag.get(m)
                    return (
                      <Box key={`${m}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1.5, pr: 0.5, py: 0.25, minHeight: 38 }}>
                        <Typography sx={{ width: 22, fontSize: '0.75rem', color: 'text.secondary' }}>{i + 1}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                          {m}
                        </Typography>
                        {o ? (
                          <Chip label={protocolOf(o.type)?.label ?? o.type} color={isGroupType(o.type) ? 'info' : 'default'} />
                        ) : (
                          <Chip label={t('singbox.missing')} color="error" />
                        )}
                        {isSelector && group.default === m && <Chip label={t('singbox.default')} color="success" />}
                        <Box sx={{ flex: 1 }} />
                        <Tooltip title={t('singbox.moveTop')}>
                          <span>
                            <IconButton size="small" disabled={i === 0} onClick={() => move(i, 0)}>
                              <VerticalAlignTop />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <IconButton size="small" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={t('singbox.moveUp')}>
                          <ArrowUpward />
                        </IconButton>
                        <IconButton size="small" disabled={i === members.length - 1} onClick={() => move(i, i + 1)} aria-label={t('singbox.moveDown')}>
                          <ArrowDownward />
                        </IconButton>
                        <IconButton size="small" onClick={() => setMembers(members.filter((_, j) => j !== i))} aria-label={t('singbox.removeMember')}>
                          <Close />
                        </IconButton>
                      </Box>
                    )
                  })}
                </Paper>
              )}
            </FormSection>

            <FormSection title={t('singbox.groupOptions')}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                {isSelector ? (
                  <TextField
                    select
                    SelectProps={{ displayEmpty: true }}
                    label={t('singbox.defaultMember')}
                    value={group.default ?? ''}
                    onChange={(e) => set('default', e.target.value)}
                    helperText={t('singbox.defaultMemberHint')}
                  >
                    <MenuItem value="">
                      <em>{members[0] ? t('singbox.firstMember', { tag: members[0] }) : t('singbox.defaultValue')}</em>
                    </MenuItem>
                    {members.map((m) => (
                      <MenuItem key={m} value={m}>
                        {m}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <>
                    <TextField
                      label={t('singbox.fields.url')}
                      value={group.url ?? ''}
                      placeholder={DEFAULT_TEST_URL}
                      onChange={(e) => set('url', e.target.value.trim())}
                      inputProps={mono}
                      sx={{ gridColumn: '1 / -1' }}
                    />
                    <TextField label={t('singbox.fields.interval')} value={group.interval ?? ''} placeholder="3m" onChange={(e) => set('interval', e.target.value.trim())} inputProps={mono} />
                    <TextField
                      label={t('singbox.fields.tolerance')}
                      value={group.tolerance ?? ''}
                      placeholder="50"
                      onChange={(e) => set('tolerance', e.target.value.replace(/[^\d]/g, '') ? Number(e.target.value.replace(/[^\d]/g, '')) : undefined)}
                      inputProps={{ ...mono, inputMode: 'numeric' }}
                      helperText={t('singbox.toleranceHint')}
                    />
                    <TextField label={t('singbox.fields.idle_timeout')} value={group.idle_timeout ?? ''} placeholder="30m" onChange={(e) => set('idle_timeout', e.target.value.trim())} inputProps={mono} />
                  </>
                )}
                <FormControlLabel
                  sx={{ ml: 0, gap: 1, gridColumn: '1 / -1' }}
                  control={<Switch checked={!!group.interrupt_exist_connections} onChange={(e) => set('interrupt_exist_connections', e.target.checked || undefined)} />}
                  label={t('singbox.interruptConnections')}
                />
              </Box>
            </FormSection>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={save}>
          {originalTag ? t('common.save') : t('singbox.add')}
        </Button>
      </DialogActions>
      <MemberPicker open={picking} candidates={candidates} onClose={() => setPicking(false)} onAdd={(tags) => setMembers([...members, ...tags])} />
    </Dialog>
  )
}

export default GroupDialog
