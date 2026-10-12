import { Box, Button, Chip, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import { Add, DeleteOutline, EditOutlined, ErrorOutline, SpeedOutlined, TouchAppOutlined, VisibilityOffOutlined, VisibilityOutlined, WorkspacesOutlined } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultOutbound, groupsOf, membersOf, type Obj } from '../../lib/singbox/doc'
import { refsTo } from '../../lib/singbox/refs'
import { edit, useSingbox } from '../../lib/singbox/store'
import { hideNodes, unhideNodes } from '../../lib/singbox/ops'
import { useToast } from '../../contexts/ToastContext'
import type { Problem } from '../../lib/singbox/validate'
import EmptyState from '../EmptyState'
import { Section, Row } from '../SettingsSection'
import { problemText, siteLabel } from './common'
import GroupDialog from './GroupDialog'
import RemoveDialog, { type RemoveRequest } from './RemoveDialog'

const PREVIEW_MEMBERS = 8

function GroupsTab({ problems }: { problems: Problem[] }) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc = session?.current.doc ?? {}
  const hiddenNotes = session?.current.meta.hidden ?? {}
  const [dialog, setDialog] = useState<{ tag: string | null; group: Obj | null } | null>(null)
  const [remove, setRemove] = useState<RemoveRequest | null>(null)
  const groups = groupsOf(doc)
  const fallback = defaultOutbound(doc)

  const addButton = (
    <Button size="small" startIcon={<Add />} onClick={() => setDialog({ tag: null, group: null })}>
      {t('singbox.addGroup')}
    </Button>
  )

  return (
    <>
      <Section title={t('singbox.groupsTitle')} action={groups.length > 0 ? addButton : undefined}>
        {groups.length === 0 ? (
          <EmptyState
            icon={<WorkspacesOutlined />}
            title={t('singbox.noGroups')}
            description={t('singbox.noGroupsHint')}
            action={
              <Button variant="contained" startIcon={<Add />} onClick={() => setDialog({ tag: null, group: null })}>
                {t('singbox.addGroup')}
              </Button>
            }
          />
        ) : (
          groups.map((g) => {
            const members = membersOf(g.value)
            const errors = problems.filter((p) => p.tag === g.tag && p.tab === 'groups' && p.level === 'error')
            const usedBy = refsTo(doc, 'outbound', g.tag)
            const isDefault = fallback.tag === g.tag
            const hidden = !!hiddenNotes[g.tag]
            const parents = usedBy.filter((r) => r.site.at === 'member').length
            return (
              <Row
                key={g.tag}
                leading={g.type === 'urltest' ? <SpeedOutlined color="action" /> : <TouchAppOutlined color="action" />}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    {g.tag}
                    <Chip label={g.type === 'urltest' ? t('singbox.urltest') : t('singbox.selector')} />
                    {hidden && (
                      <Tooltip title={t('singbox.groupHiddenHint', { groups: hiddenNotes[g.tag].join(', ') || '—' })}>
                        <Chip icon={<VisibilityOffOutlined />} label={t('singbox.hidden')} />
                      </Tooltip>
                    )}
                    {isDefault && (
                      <Tooltip title={fallback.explicit ? t('singbox.finalHint') : t('singbox.implicitFinalHint')}>
                        <Chip label={t('singbox.defaultRoute')} color="success" />
                      </Tooltip>
                    )}
                    {errors.length > 0 && (
                      <Tooltip title={errors.map((p) => problemText(t, p)).join('\n')}>
                        <ErrorOutline color="error" sx={{ fontSize: 16 }} />
                      </Tooltip>
                    )}
                  </Box>
                }
                description={
                  <>
                    <Box component="span" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                      {members.slice(0, PREVIEW_MEMBERS).map((m, i) => (
                        <Chip key={`${m}-${i}`} label={m} {...(g.value.default === m ? { color: 'success' as const } : { variant: 'outlined' as const })} />
                      ))}
                      {members.length > PREVIEW_MEMBERS && <Chip label={t('singbox.moreCount', { count: members.length - PREVIEW_MEMBERS })} variant="outlined" />}
                      {members.length === 0 && (
                        <Typography component="span" variant="body2" color="error">
                          {t('singbox.problems.emptyGroup', { group: g.tag })}
                        </Typography>
                      )}
                    </Box>
                    {usedBy.length > 0 && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                        {t('singbox.usedBy', { list: [...new Set(usedBy.map((r) => siteLabel(t, r.site)))].slice(0, 4).join(' · ') })}
                        {usedBy.length > 4 && ' …'}
                      </Typography>
                    )}
                  </>
                }
                control={
                  <>
                    {hidden ? (
                      <Tooltip title={t('singbox.unhide')}>
                        <IconButton
                          size="small"
                          onClick={() => {
                            edit((s) => unhideNodes(s, [g.tag]))
                            toast(t('singbox.groupUnhidden', { tag: g.tag }))
                          }}
                        >
                          <VisibilityOutlined />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title={parents ? t('singbox.hideGroup') : t('singbox.hideGroupNone')}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={!parents}
                            onClick={() => {
                              edit((s) => hideNodes(s, [g.tag]))
                              toast(t('singbox.groupHidden', { tag: g.tag }))
                            }}
                          >
                            <VisibilityOffOutlined />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip title={t('common.edit')}>
                      <IconButton size="small" onClick={() => setDialog({ tag: g.tag, group: g.value })}>
                        <EditOutlined />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('common.delete')}>
                      <IconButton size="small" color="error" onClick={() => setRemove({ kind: 'outbound', tags: [g.tag], mode: 'delete' })}>
                        <DeleteOutline />
                      </IconButton>
                    </Tooltip>
                  </>
                }
              />
            )
          })
        )}
      </Section>
      {groups.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">
            {t('singbox.groupsExplain')}
          </Typography>
        </Paper>
      )}
      <GroupDialog open={!!dialog} originalTag={dialog?.tag ?? null} initial={dialog?.group ?? null} onClose={() => setDialog(null)} />
      <RemoveDialog request={remove} onClose={() => setRemove(null)} />
    </>
  )
}

export default GroupsTab
