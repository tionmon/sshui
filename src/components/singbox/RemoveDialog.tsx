import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { allOutbounds, defaultOutbound, groupsContaining, type Obj } from '../../lib/singbox/doc'
import { refsTo, type RefKind, type RefSite } from '../../lib/singbox/refs'
import { deleteOutbounds, deleteRuleSet, disableNodes } from '../../lib/singbox/ops'
import { edit, useSingbox } from '../../lib/singbox/store'
import { useToast } from '../../contexts/ToastContext'
import { OutboundSelect, siteLabel } from './common'

export interface RemoveRequest {
  kind: RefKind
  tags: string[]
  /** "disable" keeps nodes in SSHUI's notes so they can come back */
  mode: 'delete' | 'disable'
}

/** References that go away anyway because their owner is being removed too. */
const ownedBy = (site: RefSite, tags: string[]) =>
  (site.at === 'member' || site.at === 'default' ? tags.includes(site.group) : false) ||
  (site.at === 'detour' ? tags.includes(site.owner) : false)

const isMembership = (site: RefSite) => site.at === 'member' || site.at === 'default'

function whatHappens(site: RefSite, replace: boolean, mode: RemoveRequest['mode']): 'remove' | 'drop' | 'replace' | 'direct' | 'condition' | 'restored' | 'fallback' {
  if (mode === 'disable' && isMembership(site)) return 'restored'
  if (replace) return 'replace'
  if (site.kind === 'ruleset' || site.at === 'dnsRule') return 'condition'
  if (site.at === 'rule') return 'drop'
  if (site.at === 'final') return 'fallback'
  if (site.at === 'detour' || site.at === 'download' || site.at === 'dnsServer' || site.at === 'other') return 'direct'
  return 'remove'
}

/** Confirms deleting or disabling outbounds / rule sets and shows what references to them become. */
function RemoveDialog({ request, onClose }: { request: RemoveRequest | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc: Obj = session?.current.doc ?? {}
  const [replace, setReplace] = useState(false)
  const [target, setTarget] = useState('')

  // Disabling is meant to be undone, so rules and relays are redirected rather than deleted by default
  useEffect(() => {
    setReplace(request?.mode === 'disable')
    setTarget('')
  }, [request])

  const refs = useMemo(
    () =>
      request
        ? request.tags.flatMap((tag) => refsTo(doc, request.kind, tag).filter((r) => !ownedBy(r.site, request.tags)))
        : [],
    [doc, request],
  )
  if (!request) return null
  const { kind, tags, mode } = request
  const canReplace =
    kind === 'outbound' && (mode === 'delete' ? refs.length > 0 : refs.some((r) => !isMembership(r.site)))
  const replacing = canReplace && replace && !!target
  const implicitDefault = kind === 'outbound' ? defaultOutbound(doc) : null
  const losesDefault = implicitDefault && !implicitDefault.explicit && implicitDefault.tag && tags.includes(implicitDefault.tag)
  const nextDefault = losesDefault
    ? allOutbounds(doc).find((o) => o.section === 'outbounds' && !tags.includes(o.tag))?.tag
    : undefined
  const hiddenGroups = mode === 'disable' ? tags.flatMap((tag) => groupsContaining(doc, tag)) : []

  const name = tags.length === 1 ? tags[0] : t('singbox.nItems', { count: tags.length })
  const title =
    mode === 'disable'
      ? t('singbox.disableTitle', { name })
      : kind === 'ruleset'
        ? t('singbox.deleteRuleSetTitle', { name })
        : t('singbox.deleteTitle', { name })

  const confirm = () => {
    edit((s) => {
      if (kind === 'ruleset') tags.forEach((tag) => deleteRuleSet(s, tag))
      else if (mode === 'disable') disableNodes(s, tags, replacing ? target : undefined)
      else deleteOutbounds(s, tags, replacing ? target : undefined)
    })
    toast(mode === 'disable' ? t('singbox.disabledToast', { name }) : t('singbox.deletedToast', { name }))
    onClose()
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {mode === 'disable' ? t('singbox.disableExplain') : refs.length ? t('singbox.refsExplain') : t('singbox.noRefs')}
          </Typography>

          {refs.length > 0 && (
            <Paper variant="outlined" sx={(th) => ({ maxHeight: 220, overflow: 'auto', '& > * + *': { borderTop: `1px solid ${th.tokens.border}` } })}>
              {refs.map((r, i) => (
                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, px: 1.5, py: 0.75 }}>
                  <Typography sx={{ fontSize: '0.8125rem' }}>
                    {tags.length > 1 && <b>{r.tag}: </b>}
                    {siteLabel(t, r.site)}
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', flexShrink: 0 }}>
                    {t(`singbox.becomes.${whatHappens(r.site, canReplace && replace, mode)}`, { target: target || '…' })}
                  </Typography>
                </Box>
              ))}
            </Paper>
          )}

          {canReplace && (
            <RadioGroup value={replace ? 'replace' : 'remove'} onChange={(e) => setReplace(e.target.value === 'replace')}>
              <FormControlLabel value="remove" control={<Radio />} label={t('singbox.removeRefs')} />
              <FormControlLabel value="replace" control={<Radio />} label={t('singbox.replaceRefs')} />
            </RadioGroup>
          )}
          {canReplace && replace && (
            <OutboundSelect
              label={t('singbox.replaceWith')}
              value={target}
              onChange={setTarget}
              options={allOutbounds(doc)
                .filter((o) => o.tagged && !tags.includes(o.tag))
                .map((o) => ({ tag: o.tag, type: o.type }))}
            />
          )}

          {mode === 'disable' && hiddenGroups.length > 0 && (
            <Alert severity="info">{t('singbox.disableGroups', { groups: [...new Set(hiddenGroups)].join(', ') })}</Alert>
          )}
          {losesDefault && (
            <Alert severity="warning">
              {nextDefault ? t('singbox.defaultMoves', { tag: nextDefault }) : t('singbox.defaultGone')}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color={mode === 'delete' ? 'error' : 'primary'}
          onClick={confirm}
          disabled={canReplace && replace && !target}
        >
          {mode === 'disable' ? t('singbox.disable') : t('common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default RemoveDialog
