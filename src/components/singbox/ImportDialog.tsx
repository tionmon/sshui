import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { ErrorOutline } from '@mui/icons-material'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { groupsOf, membersOf, nodesOf } from '../../lib/singbox/doc'
import { parseImport } from '../../lib/singbox/links'
import { addressOf, nodeFingerprint, protocolOf } from '../../lib/singbox/protocols'
import { addNodes } from '../../lib/singbox/ops'
import { edit, useSingbox } from '../../lib/singbox/store'
import { useToast } from '../../contexts/ToastContext'
import { FONT_MONO } from '../../theme'

/** Paste share links, base64 subscription content or outbound JSON to add nodes. */
function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc = session?.current.doc ?? {}
  const [text, setText] = useState('')
  const [groups, setGroups] = useState<string[]>([])
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [excluded, setExcluded] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!open) return
    setText('')
    setExcluded(new Set())
    // Default to the manual group that lists the most nodes (rather than other groups):
    // usually the "pick a node" list
    const nodeTags = new Set(nodesOf(doc).map((n) => n.tag))
    const best = groupsOf(doc)
      .filter((g) => g.type === 'selector')
      .map((g) => ({ tag: g.tag, nodes: membersOf(g.value).filter((m) => nodeTags.has(m)).length }))
      .filter((g) => g.nodes > 0)
      .sort((a, b) => b.nodes - a.nodes)[0]
    setGroups(best ? [best.tag] : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const results = useMemo(() => parseImport(text), [text])
  const existing = useMemo(() => new Set(nodesOf(doc).map((n) => nodeFingerprint(n.value))), [doc])
  const rows = results.map((r, i) => ({
    ...r,
    index: i,
    duplicate: r.ok && existing.has(nodeFingerprint(r.node)),
  }))
  const chosen = rows.filter((r) => r.ok && !excluded.has(r.index) && !(skipDuplicates && r.duplicate))
  const failed = rows.filter((r) => !r.ok)
  const duplicates = rows.filter((r) => r.duplicate).length

  const submit = () => {
    const nodes = chosen.flatMap((r) => (r.ok ? [r.node] : []))
    if (nodes.length === 0) return
    const tags = edit((s) => addNodes(s, nodes, groups))
    toast(t('singbox.imported', { count: tags.length }))
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('singbox.importTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label={t('singbox.importLabel')}
            placeholder={'vless://…\nhysteria2://…\nss://…'}
            multiline
            minRows={4}
            maxRows={10}
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setExcluded(new Set())
            }}
            helperText={t('singbox.importHint')}
            inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO, fontSize: '0.75rem' } }}
          />

          {rows.length > 0 && (
            <Paper variant="outlined" sx={(th) => ({ maxHeight: 280, overflow: 'auto', '& > * + *': { borderTop: `1px solid ${th.tokens.border}` } })}>
              {rows.map((r) => (
                <Box key={r.index} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, minHeight: 40 }}>
                  {r.ok ? (
                    <Checkbox
                      size="small"
                      checked={!excluded.has(r.index) && !(skipDuplicates && r.duplicate)}
                      disabled={skipDuplicates && r.duplicate}
                      onChange={(e) => {
                        const next = new Set(excluded)
                        if (e.target.checked) next.delete(r.index)
                        else next.add(r.index)
                        setExcluded(next)
                      }}
                      sx={{ p: 0.5 }}
                    />
                  ) : (
                    <ErrorOutline color="error" sx={{ fontSize: 18, mx: 0.75 }} />
                  )}
                  {r.ok ? (
                    <>
                      <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, minWidth: 0 }}>
                        {r.node.tag || t('singbox.untitled')}
                      </Typography>
                      <Chip label={protocolOf(r.node.type)?.label ?? r.node.type} />
                      <Typography noWrap sx={{ fontSize: '0.75rem', fontFamily: FONT_MONO, color: 'text.secondary', flex: 1, minWidth: 0 }}>
                        {addressOf(r.node)}
                      </Typography>
                      {r.duplicate && <Chip label={t('singbox.alreadyAdded')} color="warning" />}
                    </>
                  ) : (
                    <>
                      <Typography noWrap sx={{ fontSize: '0.75rem', fontFamily: FONT_MONO, color: 'text.secondary', flex: 1, minWidth: 0 }}>
                        {r.source}
                      </Typography>
                      <Typography sx={{ fontSize: '0.75rem', color: 'error.main', flexShrink: 0 }}>
                        {t(`singbox.linkErrors.${r.error}`, { detail: r.detail ?? '' })}
                      </Typography>
                    </>
                  )}
                </Box>
              ))}
            </Paper>
          )}

          {failed.length > 0 && rows.length === failed.length && (
            <Alert severity="warning">{t('singbox.nothingToImport')}</Alert>
          )}

          <Autocomplete
            multiple
            options={groupsOf(doc).map((g) => g.tag)}
            value={groups}
            onChange={(_, v) => setGroups(v)}
            renderInput={(params) => <TextField {...params} label={t('singbox.addToGroups')} />}
          />
          {duplicates > 0 && (
            <FormControlLabel
              control={<Checkbox checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />}
              label={t('singbox.skipDuplicates', { count: duplicates })}
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={chosen.length === 0}>
          {t('singbox.importCount', { count: chosen.length })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default ImportDialog
