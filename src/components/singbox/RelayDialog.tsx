import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { allOutbounds, findOutbound } from '../../lib/singbox/doc'
import { dependsOn } from '../../lib/singbox/refs'
import { duplicateNode, setDetour } from '../../lib/singbox/ops'
import { edit, useSingbox } from '../../lib/singbox/store'
import { useToast } from '../../contexts/ToastContext'
import { OutboundSelect } from './common'
import { ChainPreview } from './NodeDialog'

export interface RelayRequest {
  /** "set" changes the nodes' relay; "duplicate" adds a chained copy of one node */
  mode: 'set' | 'duplicate'
  tags: string[]
}

/** Choose the outbound that nodes connect through (sing-box `detour`). */
function RelayDialog({ request, onClose }: { request: RelayRequest | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc = session?.current.doc ?? {}
  const [via, setVia] = useState('')

  useEffect(() => {
    if (!request) return
    const current = request.mode === 'set' ? findOutbound(doc, request.tags[0])?.value.detour : undefined
    const same = request.tags.every((tag) => findOutbound(doc, tag)?.value.detour === current)
    setVia(same && typeof current === 'string' ? current : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  if (!request) return null
  const { mode, tags } = request
  const options = allOutbounds(doc)
    .filter((o) => o.tagged && !tags.includes(o.tag) && !['block', 'dns'].includes(o.type))
    .map((o) => ({
      tag: o.tag,
      type: o.type,
      // A relay that itself goes through one of these nodes would loop
      disabled: mode === 'set' && tags.some((tag) => dependsOn(doc, o.tag, tag)),
    }))
  const single = tags.length === 1 ? tags[0] : null

  const apply = () => {
    if (mode === 'duplicate') {
      if (!via || !single) return
      const tag = edit((s) => duplicateNode(s, single, via))
      toast(t('singbox.chainedAdded', { tag }))
    } else {
      edit((s) => tags.forEach((tag) => setDetour(s, tag, via || null)))
      toast(via ? t('singbox.relaySet', { count: tags.length, via }) : t('singbox.relayCleared', { count: tags.length }))
    }
    onClose()
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {mode === 'duplicate'
          ? t('singbox.duplicateViaTitle', { tag: single })
          : t('singbox.setRelayTitle', { name: single ?? t('singbox.nItems', { count: tags.length }) })}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {mode === 'duplicate' ? t('singbox.duplicateViaExplain') : t('singbox.relayExplain')}
          </Typography>
          <OutboundSelect
            label={t('singbox.connectVia')}
            value={via}
            onChange={setVia}
            options={options}
            emptyLabel={mode === 'set' ? t('singbox.noRelay') : undefined}
          />
          {single && <ChainPreview doc={doc} tag={mode === 'duplicate' ? `${single} via ${via}` : single} via={via} />}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={apply} disabled={mode === 'duplicate' && !via}>
          {mode === 'duplicate' ? t('singbox.createChained') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default RelayDialog
