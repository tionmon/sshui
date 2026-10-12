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
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { ArrowForward } from '@mui/icons-material'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { allOutbounds, clone, groupsContaining, groupsOf, isObj, parseConfig, type Obj } from '../../lib/singbox/doc'
import {
  ADDABLE,
  REALITY_FIELDS,
  TLS_FIELDS,
  TRANSPORTS,
  TRANSPORT_FIELDS,
  UTLS_FINGERPRINTS,
  isValidPort,
  missingFields,
  protocolOf,
  securityOf,
  setFingerprint,
  setSecurity,
  setTransport,
  type Security,
} from '../../lib/singbox/protocols'
import { dependsOn, detourChain } from '../../lib/singbox/refs'
import { edit, useSingbox } from '../../lib/singbox/store'
import { saveNode } from '../../lib/singbox/ops'
import { useToast, errorMessage } from '../../contexts/ToastContext'
import { FieldGrid, FormSection, OutboundSelect, type OutboundOption } from './common'
import JsonEditor from './JsonEditor'

const newNode = (type: string, keep: Obj = {}): Obj => {
  const def = protocolOf(type)
  const node: Obj = { type, tag: keep.tag ?? '', ...clone(def?.template ?? {}) }
  if (keep.server && def?.fields.some((f) => f.path === 'server')) node.server = keep.server
  if (keep.server_port && def?.fields.some((f) => f.path === 'server_port')) node.server_port = keep.server_port
  return node
}

/** Outbounds a node may connect through: not itself, nothing that depends on it, no block/dns. */
export function relayOptions(doc: Obj, tag: string | null): OutboundOption[] {
  return allOutbounds(doc)
    .filter((o) => o.tagged && o.tag !== tag && !['block', 'dns'].includes(o.type))
    .map((o) => {
      // Connecting through something that itself goes through this node would loop
      return { tag: o.tag, type: o.type, disabled: !!tag && dependsOn(doc, o.tag, tag) }
    })
}

/** "You → relay 2 → relay 1 → this node → Internet" */
export function ChainPreview({ doc, tag, via }: { doc: Obj; tag: string; via: string }) {
  const { t } = useTranslation()
  if (!via) return null
  const hops = [...[via, ...detourChain(doc, via)].reverse(), tag || t('singbox.thisNode')]
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, mt: 1.25 }}>
      <Typography variant="caption" color="text.secondary">
        {t('singbox.you')}
      </Typography>
      {hops.map((h, i) => (
        <Box key={`${h}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <ArrowForward sx={{ fontSize: 13, color: 'text.secondary' }} />
          <Chip label={h} color={i === hops.length - 1 ? 'info' : 'default'} />
        </Box>
      ))}
      <ArrowForward sx={{ fontSize: 13, color: 'text.secondary' }} />
      <Typography variant="caption" color="text.secondary">
        {t('singbox.internet')}
      </Typography>
    </Box>
  )
}

function NodeDialog({
  open,
  originalTag,
  initial,
  onClose,
}: {
  open: boolean
  /** null when adding */
  originalTag: string | null
  initial: Obj | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc = session?.current.doc ?? {}
  const [node, setNode] = useState<Obj>({})
  const [groups, setGroups] = useState<string[]>([])
  const [tab, setTab] = useState<'form' | 'json'>('form')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open || !session) return
    const start = initial ? clone(initial) : newNode('shadowsocks')
    setNode(start)
    setGroups(originalTag ? groupsContaining(session.current.doc, originalTag) : [])
    setTab('form')
    setJsonError(null)
    setTouched(false)
    // Only when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, originalTag, initial])

  const def = protocolOf(String(node.type))
  const tag = typeof node.tag === 'string' ? node.tag.trim() : ''
  const taken = useMemo(() => new Set(allOutbounds(doc).filter((o) => o.tagged && o.tag !== originalTag).map((o) => o.tag)), [doc, originalTag])
  const tagError = !tag ? t('singbox.tagRequired') : taken.has(tag) ? t('singbox.tagTaken') : null
  const missing = missingFields(node)
  const portBad = ['server_port', 'peers.0.port'].some((p) => {
    const v = p === 'server_port' ? node.server_port : isObj(node.peers?.[0]) ? node.peers[0].port : undefined
    return v !== undefined && !isValidPort(v)
  })
  const security = securityOf(node)
  const transportType = isObj(node.transport) ? String(node.transport.type ?? '') : ''
  const hidden = originalTag && session?.current.meta.hidden[originalTag]
  const groupOptions = groupsOf(doc)
    .map((g) => g.tag)
    // A node can't join a group it connects through
    .filter((g) => !(originalTag && dependsOn(doc, originalTag, g)) && g !== node.detour)
  const relays = relayOptions(doc, originalTag)

  const switchTab = (next: 'form' | 'json') => {
    if (next === 'json') {
      setJsonText(JSON.stringify(node, null, 2))
      setJsonError(null)
      setTab('json')
      return
    }
    if (applyJson(jsonText)) setTab('form')
  }

  const applyJson = (text: string) => {
    try {
      const parsed = parseConfig(text).doc
      if (typeof parsed.type !== 'string') throw new Error(t('singbox.jsonNeedsType'))
      setNode(parsed)
      setJsonError(null)
      return true
    } catch (e) {
      setJsonError(errorMessage(e))
      return false
    }
  }

  const save = () => {
    setTouched(true)
    let final = node
    if (tab === 'json') {
      try {
        final = parseConfig(jsonText).doc
      } catch (e) {
        setJsonError(errorMessage(e))
        return
      }
    }
    const finalTag = typeof final.tag === 'string' ? final.tag.trim() : ''
    if (!finalTag || taken.has(finalTag) || missingFields(final).length || portBad) {
      if (tab === 'json') setNode(final)
      setTab('form')
      return
    }
    try {
      edit((s) => saveNode(s, originalTag, { ...final, tag: finalTag }, groups))
      toast(originalTag ? t('singbox.nodeSaved', { tag: finalTag }) : t('singbox.nodeAdded', { tag: finalTag }))
      onClose()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const set = (fn: (n: Obj) => void) => {
    const next = clone(node)
    fn(next)
    setNode(next)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{originalTag ? t('singbox.editNode', { tag: originalTag }) : t('singbox.addNode')}</DialogTitle>
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
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
              {t('singbox.nodeJsonHint')}
            </Typography>
          </>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {hidden && <Alert severity="info">{t('singbox.hiddenInDialog')}</Alert>}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                label={t('singbox.tag')}
                value={node.tag ?? ''}
                autoFocus={!originalTag}
                required
                error={touched && !!tagError}
                helperText={touched && tagError ? tagError : t('singbox.tagHint')}
                onChange={(e) => set((n) => (n.tag = e.target.value))}
              />
              <TextField
                select
                label={t('singbox.protocol')}
                value={String(node.type ?? '')}
                disabled={!!originalTag}
                onChange={(e) => setNode(newNode(e.target.value, node))}
              >
                {!protocolOf(String(node.type)) && <MenuItem value={String(node.type)}>{String(node.type)}</MenuItem>}
                {(originalTag ? [def ?? { type: node.type, label: node.type }] : ADDABLE).map((p) => (
                  <MenuItem key={p.type} value={p.type}>
                    {p.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>

            {!def && <Alert severity="info">{t('singbox.noForm', { type: node.type })}</Alert>}

            {def && def.fields.length > 0 && (
              <FormSection title={t('singbox.server')}>
                <FieldGrid fields={def.fields} value={node} onChange={setNode} touched={touched} />
                {node.type === 'wireguard' && Array.isArray(node.peers) && node.peers.length > 1 && (
                  <Alert severity="info" sx={{ mt: 1.5 }}>
                    {t('singbox.morePeers', { count: node.peers.length - 1 })}
                  </Alert>
                )}
              </FormSection>
            )}

            {def && def.tls !== 'none' && (
              <FormSection
                title="TLS"
                action={
                  def.tls === 'optional' ? (
                    <TextField
                      select
                      size="small"
                      value={security}
                      onChange={(e) => set((n) => setSecurity(n, e.target.value as Security))}
                      sx={{ minWidth: 140 }}
                    >
                      <MenuItem value="none">{t('singbox.securityNone')}</MenuItem>
                      <MenuItem value="tls">TLS</MenuItem>
                      {def.reality && <MenuItem value="reality">Reality</MenuItem>}
                    </TextField>
                  ) : undefined
                }
              >
                {security !== 'none' || def.tls === 'required' ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {security === 'reality' && <FieldGrid fields={REALITY_FIELDS} value={node} onChange={setNode} touched={touched} />}
                    <FieldGrid fields={TLS_FIELDS.slice(0, 1)} value={node} onChange={setNode} />
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                      <TextField
                        select
                        label={t('singbox.fields.tls_utls_fingerprint')}
                        SelectProps={{ displayEmpty: true }}
                        value={isObj(node.tls?.utls) && node.tls.utls.enabled ? String(node.tls.utls.fingerprint ?? 'chrome') : ''}
                        onChange={(e) => set((n) => setFingerprint(n, e.target.value))}
                      >
                        {security !== 'reality' && (
                          <MenuItem value="">
                            <em>{t('singbox.defaultValue')}</em>
                          </MenuItem>
                        )}
                        {UTLS_FINGERPRINTS.map((f) => (
                          <MenuItem key={f} value={f}>
                            {f}
                          </MenuItem>
                        ))}
                      </TextField>
                      <FieldGrid fields={TLS_FIELDS.slice(2)} value={node} onChange={setNode} />
                    </Box>
                    <FieldGrid fields={TLS_FIELDS.slice(1, 2)} value={node} onChange={setNode} />
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('singbox.noTls')}
                  </Typography>
                )}
              </FormSection>
            )}

            {def?.transport && (
              <FormSection
                title={t('singbox.transport')}
                action={
                  <TextField
                    select
                    size="small"
                    value={transportType}
                    onChange={(e) => set((n) => setTransport(n, e.target.value))}
                    SelectProps={{ displayEmpty: true }}
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="">TCP</MenuItem>
                    {TRANSPORTS.map((tr) => (
                      <MenuItem key={tr} value={tr}>
                        {t(`singbox.transports.${tr}`)}
                      </MenuItem>
                    ))}
                    {transportType && !TRANSPORTS.includes(transportType) && <MenuItem value={transportType}>{transportType}</MenuItem>}
                  </TextField>
                }
              >
                {transportType && TRANSPORT_FIELDS[transportType]?.length ? (
                  <FieldGrid fields={TRANSPORT_FIELDS[transportType]} value={node} onChange={setNode} />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {transportType ? t('singbox.noTransportFields') : t('singbox.plainTcp')}
                  </Typography>
                )}
              </FormSection>
            )}

            {!['block', 'dns'].includes(String(node.type)) && (
              <FormSection title={t('singbox.relay')}>
                <OutboundSelect
                  label={t('singbox.connectVia')}
                  value={typeof node.detour === 'string' ? node.detour : ''}
                  onChange={(v) => set((n) => (v ? (n.detour = v) : delete n.detour))}
                  options={relays}
                  emptyLabel={t('singbox.noRelay')}
                  helperText={t('singbox.relayHint')}
                />
                <ChainPreview doc={doc} tag={tag} via={typeof node.detour === 'string' ? node.detour : ''} />
              </FormSection>
            )}

            <FormSection title={t('singbox.groups')}>
              <Autocomplete
                multiple
                options={groupOptions}
                value={groups}
                onChange={(_, v) => setGroups(v)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('singbox.memberOf')}
                    placeholder={groups.length ? undefined : t('singbox.noGroups')}
                    helperText={groupOptions.length === 0 ? t('singbox.noGroupsYet') : groups.length === 0 ? t('singbox.noGroupWarning') : undefined}
                  />
                )}
              />
            </FormSection>

            {touched && missing.length > 0 && (
              <Alert severity="error">{t('singbox.problems.missingFields', { tag: tag || '?', fields: missing.join(', ') })}</Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={save}>
          {originalTag ? t('common.save') : t('singbox.add')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default NodeDialog
