import {
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Add,
  ContentCopyOutlined,
  DeleteOutline,
  EditOutlined,
  ErrorOutline,
  InputOutlined,
  LinkOutlined,
  MoreHoriz,
  PlaylistAddOutlined,
  PowerSettingsNewOutlined,
  Search,
  VisibilityOffOutlined,
  VisibilityOutlined,
  CallSplitOutlined,
  HubOutlined,
} from '@mui/icons-material'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { groupsContaining, groupsOf, nodesOf, type NodeRef } from '../../lib/singbox/doc'
import { addressOf, protocolOf } from '../../lib/singbox/protocols'
import { detourUsers } from '../../lib/singbox/refs'
import { deleteDisabled, duplicateNode, enableNodes, hideNodes, setMembership, unhideNodes } from '../../lib/singbox/ops'
import { edit, useSingbox } from '../../lib/singbox/store'
import type { Problem } from '../../lib/singbox/validate'
import { useToast } from '../../contexts/ToastContext'
import { FONT_MONO } from '../../theme'
import EmptyState from '../EmptyState'
import { problemText } from './common'
import NodeDialog from './NodeDialog'
import ImportDialog from './ImportDialog'
import RemoveDialog, { type RemoveRequest } from './RemoveDialog'
import RelayDialog, { type RelayRequest } from './RelayDialog'

const typeLabel = (type: string) => protocolOf(type)?.label ?? type

function GroupChips({ groups }: { groups: string[] }) {
  const shown = groups.slice(0, 3)
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {shown.map((g) => (
        <Chip key={g} label={g} variant="outlined" />
      ))}
      {groups.length > shown.length && (
        <Tooltip title={groups.slice(3).join(', ')}>
          <Chip label={`+${groups.length - shown.length}`} variant="outlined" />
        </Tooltip>
      )}
    </Box>
  )
}

function NodesTab({ problems }: { problems: Problem[] }) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc = session?.current.doc ?? {}
  const meta = session?.current.meta
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<{ tag: string | null; node: NodeRef['value'] | null } | null>(null)
  const [importing, setImporting] = useState(false)
  const [remove, setRemove] = useState<RemoveRequest | null>(null)
  const [relay, setRelay] = useState<RelayRequest | null>(null)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; node: NodeRef } | null>(null)
  const [groupMenu, setGroupMenu] = useState<HTMLElement | null>(null)

  const nodes = nodesOf(doc)
  const groups = groupsOf(doc)
  const types = [...new Set(nodes.map((n) => n.type))]
  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      nodes.filter(
        (n) =>
          (!typeFilter || n.type === typeFilter) &&
          (!q || n.tag.toLowerCase().includes(q) || (addressOf(n.value) ?? '').toLowerCase().includes(q) || n.type.includes(q)),
      ),
    [nodes, typeFilter, q],
  )
  const errorsFor = (tag: string) => problems.filter((p) => p.tag === tag && p.tab === 'nodes' && p.level === 'error')
  const chosen = [...selected].filter((tag) => nodes.some((n) => n.tag === tag))
  const allVisibleSelected = visible.length > 0 && visible.every((n) => selected.has(n.tag))

  const toggle = (tag: string) => {
    const next = new Set(selected)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    setSelected(next)
  }
  const clear = () => setSelected(new Set())

  const hide = (tags: string[]) => {
    edit((s) => hideNodes(s, tags))
    toast(t('singbox.hiddenToast', { count: tags.length }))
  }
  const unhide = (tags: string[]) => {
    edit((s) => unhideNodes(s, tags))
    toast(t('singbox.unhiddenToast', { count: tags.length }))
  }
  const addToGroup = (group: string) => {
    edit((s) => chosen.forEach((tag) => setMembership(s, tag, [...new Set([...groupsContaining(s.doc, tag), group])])))
    toast(t('singbox.addedToGroup', { count: chosen.length, group }))
    setGroupMenu(null)
  }

  const menuItem = (icon: ReactNode, label: string, onClick: () => void, color?: string) => (
    <MenuItem
      onClick={() => {
        setMenu(null)
        onClick()
      }}
      sx={color ? { color } : undefined}
    >
      <ListItemIcon sx={color ? { color: 'inherit' } : undefined}>{icon}</ListItemIcon>
      <ListItemText>{label}</ListItemText>
    </MenuItem>
  )

  const toolbar = (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
      {chosen.length > 0 ? (
        <>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, mr: 1 }}>{t('singbox.selected', { count: chosen.length })}</Typography>
          <Button size="small" startIcon={<PlaylistAddOutlined />} onClick={(e) => setGroupMenu(e.currentTarget)} disabled={groups.length === 0}>
            {t('singbox.addToGroup')}
          </Button>
          <Button size="small" startIcon={<CallSplitOutlined />} onClick={() => setRelay({ mode: 'set', tags: chosen })}>
            {t('singbox.setRelay')}
          </Button>
          {chosen.some((tag) => meta?.hidden[tag]) ? (
            <Button size="small" startIcon={<VisibilityOutlined />} onClick={() => unhide(chosen.filter((tag) => meta?.hidden[tag]))}>
              {t('singbox.unhide')}
            </Button>
          ) : (
            <Button size="small" startIcon={<VisibilityOffOutlined />} onClick={() => hide(chosen)}>
              {t('singbox.hide')}
            </Button>
          )}
          <Button size="small" startIcon={<PowerSettingsNewOutlined />} onClick={() => setRemove({ kind: 'outbound', tags: chosen, mode: 'disable' })}>
            {t('singbox.disable')}
          </Button>
          <Button size="small" color="error" startIcon={<DeleteOutline />} onClick={() => setRemove({ kind: 'outbound', tags: chosen, mode: 'delete' })}>
            {t('common.delete')}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={clear}>
            {t('singbox.clearSelection')}
          </Button>
        </>
      ) : (
        <>
          <TextField
            size="small"
            placeholder={t('singbox.searchNodes')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ width: 260 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ fontSize: 18 }} />
                </InputAdornment>
              ),
            }}
          />
          {types.length > 1 && (
            <TextField select size="small" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} sx={{ minWidth: 150 }} SelectProps={{ displayEmpty: true }}>
              <MenuItem value="">{t('singbox.allTypes')}</MenuItem>
              {types.map((ty) => (
                <MenuItem key={ty} value={ty}>
                  {typeLabel(ty)}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<LinkOutlined />} onClick={() => setImporting(true)}>
            {t('singbox.importLinks')}
          </Button>
          <Button variant="contained" startIcon={<Add />} onClick={() => setDialog({ tag: null, node: null })}>
            {t('singbox.addNode')}
          </Button>
        </>
      )}
    </Box>
  )

  return (
    <>
      {toolbar}
      {nodes.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState
            icon={<HubOutlined />}
            title={t('singbox.noNodes')}
            description={t('singbox.noNodesHint')}
            action={
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button startIcon={<LinkOutlined />} onClick={() => setImporting(true)}>
                  {t('singbox.importLinks')}
                </Button>
                <Button variant="contained" startIcon={<Add />} onClick={() => setDialog({ tag: null, node: null })}>
                  {t('singbox.addNode')}
                </Button>
              </Box>
            }
          />
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" sx={{ pl: 1 }}>
                  <Checkbox
                    size="small"
                    checked={allVisibleSelected}
                    indeterminate={!allVisibleSelected && visible.some((n) => selected.has(n.tag))}
                    onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((n) => n.tag)))}
                  />
                </TableCell>
                <TableCell>{t('singbox.tag')}</TableCell>
                <TableCell>{t('singbox.protocol')}</TableCell>
                <TableCell>{t('singbox.address')}</TableCell>
                <TableCell>{t('singbox.groups')}</TableCell>
                <TableCell>{t('singbox.relay')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((n) => {
                const memberOf = groupsContaining(doc, n.tag)
                const hidden = !!meta?.hidden[n.tag]
                const errors = errorsFor(n.tag)
                const users = detourUsers(doc, n.tag)
                return (
                  <TableRow key={`${n.section}-${n.index}`} hover selected={selected.has(n.tag)} sx={{ cursor: 'pointer' }} onClick={() => setDialog({ tag: n.tag, node: n.value })}>
                    <TableCell padding="checkbox" sx={{ pl: 1 }} onClick={(e) => e.stopPropagation()}>
                      <Checkbox size="small" checked={selected.has(n.tag)} onChange={() => toggle(n.tag)} disabled={!n.tagged} />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                        {errors.length > 0 && (
                          <Tooltip title={errors.map((p) => problemText(t, p)).join('\n')}>
                            <ErrorOutline color="error" sx={{ fontSize: 16 }} />
                          </Tooltip>
                        )}
                        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, opacity: hidden ? 0.6 : 1 }}>
                          {n.tagged ? n.tag : t('singbox.untaggedName', { index: n.index })}
                        </Typography>
                        {hidden && (
                          <Tooltip title={t('singbox.hiddenHint')}>
                            <Chip icon={<VisibilityOffOutlined />} label={t('singbox.hidden')} />
                          </Tooltip>
                        )}
                        {users.length > 0 && (
                          <Tooltip title={t('singbox.relayForHint', { nodes: users.join(', ') })}>
                            <Chip label={t('singbox.relayFor', { count: users.length })} color="info" />
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip label={typeLabel(n.type)} />
                    </TableCell>
                    <TableCell sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', color: 'text.secondary', maxWidth: 220 }}>
                      <Typography noWrap sx={{ fontFamily: 'inherit', fontSize: 'inherit' }}>
                        {addressOf(n.value) ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {memberOf.length ? (
                        <GroupChips groups={memberOf} />
                      ) : (
                        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{hidden ? '—' : t('singbox.inNoGroup')}</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.8125rem' }}>
                      {typeof n.value.detour === 'string' ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <CallSplitOutlined sx={{ fontSize: 15, color: 'text.secondary' }} />
                          <Typography noWrap sx={{ fontSize: 'inherit', maxWidth: 140 }}>
                            {n.value.detour}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>—</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', py: 0 }} onClick={(e) => e.stopPropagation()}>
                      <Tooltip title={t('common.edit')}>
                        <IconButton size="small" onClick={() => setDialog({ tag: n.tag, node: n.value })}>
                          <EditOutlined />
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" onClick={(e) => setMenu({ anchor: e.currentTarget, node: n })} aria-label={t('singbox.more')} disabled={!n.tagged}>
                        <MoreHoriz />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                )
              })}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} sx={{ textAlign: 'center', color: 'text.secondary', py: 4 }}>
                    {t('singbox.noMatches')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {meta && meta.disabled.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, px: 0.25 }}>
            {t('singbox.disabledNodes')}
          </Typography>
          <Paper variant="outlined" sx={(th) => ({ '& > * + *': { borderTop: `1px solid ${th.tokens.border}` } })}>
            {meta.disabled.map((d, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1 }}>
                <PowerSettingsNewOutlined sx={{ fontSize: 17, color: 'text.disabled' }} />
                <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, color: 'text.secondary' }}>
                  {String(d.node.tag ?? d.node.type)}
                </Typography>
                <Chip label={typeLabel(String(d.node.type))} />
                <Typography noWrap sx={{ flex: 1, fontSize: '0.75rem', fontFamily: FONT_MONO, color: 'text.secondary' }}>
                  {addressOf(d.node) ?? ''}
                </Typography>
                <Button
                  size="small"
                  onClick={() => {
                    const [tag] = edit((s) => enableNodes(s, [i]))
                    toast(t('singbox.enabledToast', { tag }))
                  }}
                >
                  {t('singbox.enable')}
                </Button>
                <Tooltip title={t('singbox.deleteForever')}>
                  <IconButton size="small" color="error" onClick={() => edit((s) => deleteDisabled(s, [i]))}>
                    <DeleteOutline />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Paper>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1, px: 0.25 }}>
            {t('singbox.disabledHint')}
          </Typography>
        </Box>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu &&
          (() => {
            const n = menu.node
            const hidden = !!meta?.hidden[n.tag]
            return [
              menuItem(<ContentCopyOutlined />, t('singbox.duplicate'), () => {
                const tag = edit((s) => duplicateNode(s, n.tag))
                toast(t('singbox.duplicated', { tag }))
              }),
              menuItem(<CallSplitOutlined />, t('singbox.duplicateVia'), () => setRelay({ mode: 'duplicate', tags: [n.tag] })),
              menuItem(<InputOutlined />, t('singbox.setRelay'), () => setRelay({ mode: 'set', tags: [n.tag] })),
              hidden
                ? menuItem(<VisibilityOutlined />, t('singbox.unhide'), () => unhide([n.tag]))
                : menuItem(<VisibilityOffOutlined />, t('singbox.hide'), () => hide([n.tag])),
              menuItem(<PowerSettingsNewOutlined />, t('singbox.disable'), () => setRemove({ kind: 'outbound', tags: [n.tag], mode: 'disable' })),
              menuItem(<DeleteOutline />, t('common.delete'), () => setRemove({ kind: 'outbound', tags: [n.tag], mode: 'delete' }), 'error.main'),
            ]
          })()}
      </Menu>
      <Menu anchorEl={groupMenu} open={!!groupMenu} onClose={() => setGroupMenu(null)}>
        {groups.map((g) => (
          <MenuItem key={g.tag} onClick={() => addToGroup(g.tag)}>
            {g.tag}
          </MenuItem>
        ))}
      </Menu>

      <NodeDialog open={!!dialog} originalTag={dialog?.tag ?? null} initial={dialog?.node ?? null} onClose={() => setDialog(null)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <RemoveDialog request={remove} onClose={() => setRemove(null)} />
      <RelayDialog request={relay} onClose={() => setRelay(null)} />
    </>
  )
}

export default NodesTab
