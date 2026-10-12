import { Box, Button, Chip, IconButton, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import {
  Add,
  ArrowDownward,
  ArrowUpward,
  AutoFixHighOutlined,
  ContentCopyOutlined,
  DeleteOutline,
  EditOutlined,
  ErrorOutline,
  RuleOutlined,
  WarningAmberOutlined,
  FolderZipOutlined,
} from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { allOutbounds, clone, defaultOutbound, isObj, routeRulesOf, ruleSetTags, ruleSetsOf, type Obj } from '../../lib/singbox/doc'
import { refsTo } from '../../lib/singbox/refs'
import { QUICK_RULES, ruleSetSource, summarizeRule, type QuickRule } from '../../lib/singbox/rules'
import { addQuickRule, deleteRule, insertRuleAfter, moveRule, setFinal } from '../../lib/singbox/ops'
import { edit, useSingbox } from '../../lib/singbox/store'
import type { Problem } from '../../lib/singbox/validate'
import { useToast } from '../../contexts/ToastContext'
import { FONT_MONO } from '../../theme'
import EmptyState from '../EmptyState'
import { Section, Row } from '../SettingsSection'
import { OutboundSelect, problemText } from './common'
import RuleDialog from './RuleDialog'
import RuleSetDialog from './RuleSetDialog'
import RemoveDialog, { type RemoveRequest } from './RemoveDialog'

const MAX_VALUES = 3

function RuleSummaryView({ rule }: { rule: Obj }) {
  const { t } = useTranslation()
  const s = summarizeRule(rule)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}>
      {s.invert && <Chip label={t('singbox.not')} color="warning" />}
      {s.logical && <Chip label={t('singbox.logicalSummary', { mode: s.logical.mode.toUpperCase(), count: s.logical.count })} variant="outlined" />}
      {s.conditions.length === 0 && !s.logical && (
        <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>{t('singbox.everything')}</Typography>
      )}
      {s.conditions.map((c) => (
        <Box key={c.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', fontFamily: FONT_MONO }}>{c.key}</Typography>
          {c.values.slice(0, MAX_VALUES).map((v, i) => (
            <Chip key={`${v}-${i}`} label={v} variant="outlined" sx={{ fontFamily: FONT_MONO, maxWidth: 220 }} />
          ))}
          {c.values.length > MAX_VALUES && (
            <Tooltip title={c.values.slice(MAX_VALUES).join(', ')}>
              <Chip label={`+${c.values.length - MAX_VALUES}`} variant="outlined" />
            </Tooltip>
          )}
        </Box>
      ))}
    </Box>
  )
}

function ActionChip({ rule }: { rule: Obj }) {
  const { t } = useTranslation()
  const s = summarizeRule(rule)
  if (s.action === 'route') return <Chip label={`→ ${s.outbound ?? '?'}`} color={s.outbound ? 'info' : 'error'} />
  return <Chip label={t(`singbox.actions.${s.action}`, { defaultValue: s.action })} color={s.action === 'reject' ? 'error' : 'default'} />
}

function RulesTab({ problems }: { problems: Problem[] }) {
  const { t } = useTranslation()
  const toast = useToast()
  const session = useSingbox()
  const doc = session?.current.doc ?? {}
  const [ruleDialog, setRuleDialog] = useState<{ index: number | null; rule: Obj | null } | null>(null)
  const [setDialog, setSetDialog] = useState<{ index: number | null; rs: Obj | null } | null>(null)
  const [remove, setRemove] = useState<RemoveRequest | null>(null)
  const [quickMenu, setQuickMenu] = useState<HTMLElement | null>(null)

  const rules = routeRulesOf(doc)
  const ruleSets = ruleSetsOf(doc)
  const fallback = defaultOutbound(doc)
  const outbounds = allOutbounds(doc)
    .filter((o) => o.tagged && !['dns', 'block'].includes(o.type))
    .map((o) => ({ tag: o.tag, type: o.type }))
  const ruleProblems = (index: number) => problems.filter((p) => p.tab === 'rules' && p.params.index === index + 1)

  const quick = (kind: QuickRule) => {
    setQuickMenu(null)
    const added = edit((s) => addQuickRule(s, kind))
    toast(added ? t('singbox.quickAdded', { name: t(`singbox.quick.${kind}`) }) : t('singbox.quickExists'), added ? 'success' : 'info')
  }

  return (
    <>
      <Section title={t('singbox.defaultRoute')}>
        <Row
          label={t('singbox.final')}
          description={fallback.explicit ? t('singbox.finalHint') : t('singbox.implicitFinal', { tag: fallback.tag ?? '—' })}
          control={
            <Box sx={{ width: 260 }}>
              <OutboundSelect
                label={t('singbox.routeTo')}
                value={fallback.explicit ? (fallback.tag ?? '') : ''}
                onChange={(v) => edit((s) => setFinal(s, v || null))}
                options={outbounds}
                emptyLabel={t('singbox.firstOutbound', { tag: allOutbounds(doc).find((o) => o.section === 'outbounds')?.tag ?? '—' })}
              />
            </Box>
          }
        />
      </Section>

      <Section
        title={t('singbox.rules')}
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" startIcon={<AutoFixHighOutlined />} onClick={(e) => setQuickMenu(e.currentTarget)}>
              {t('singbox.quickAdd')}
            </Button>
            <Button size="small" startIcon={<Add />} onClick={() => setRuleDialog({ index: null, rule: null })}>
              {t('singbox.addRule')}
            </Button>
          </Box>
        }
      >
        {rules.length === 0 ? (
          <EmptyState icon={<RuleOutlined />} title={t('singbox.noRules')} description={t('singbox.noRulesHint')} />
        ) : (
          rules.map((rule, i) => {
            if (!isObj(rule)) return null
            const issues = ruleProblems(i)
            const worst = issues.find((p) => p.level === 'error') ?? issues.find((p) => p.level === 'warning')
            return (
              <Box
                key={i}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pl: 2, pr: 1, py: 1, minHeight: 52, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                onClick={() => setRuleDialog({ index: i, rule })}
              >
                <Typography sx={{ width: 20, fontSize: '0.75rem', color: 'text.secondary', flexShrink: 0 }}>{i + 1}</Typography>
                {worst && (
                  <Tooltip title={issues.map((p) => problemText(t, p)).join('\n')}>
                    {worst.level === 'error' ? <ErrorOutline color="error" sx={{ fontSize: 16 }} /> : <WarningAmberOutlined color="warning" sx={{ fontSize: 16 }} />}
                  </Tooltip>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <RuleSummaryView rule={rule} />
                </Box>
                <ActionChip rule={rule} />
                <Box sx={{ display: 'flex', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                  <IconButton size="small" disabled={i === 0} onClick={() => edit((s) => moveRule(s, i, i - 1))} aria-label={t('singbox.moveUp')}>
                    <ArrowUpward />
                  </IconButton>
                  <IconButton size="small" disabled={i === rules.length - 1} onClick={() => edit((s) => moveRule(s, i, i + 1))} aria-label={t('singbox.moveDown')}>
                    <ArrowDownward />
                  </IconButton>
                  <Tooltip title={t('singbox.duplicate')}>
                    <IconButton size="small" onClick={() => edit((s) => insertRuleAfter(s, i, clone(rule)))}>
                      <ContentCopyOutlined />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('common.edit')}>
                    <IconButton size="small" onClick={() => setRuleDialog({ index: i, rule })}>
                      <EditOutlined />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('common.delete')}>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        edit((s) => deleteRule(s, i))
                        toast(t('singbox.ruleDeleted', { n: i + 1 }))
                      }}
                    >
                      <DeleteOutline />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            )
          })
        )}
      </Section>
      {rules.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: -2, mb: 3, px: 0.25 }}>
          {t('singbox.rulesOrderHint')}
        </Typography>
      )}

      <Section
        title={t('singbox.ruleSets')}
        action={
          <Button size="small" startIcon={<Add />} onClick={() => setSetDialog({ index: null, rs: null })}>
            {t('singbox.addRuleSet')}
          </Button>
        }
      >
        {ruleSets.length === 0 ? (
          <EmptyState icon={<FolderZipOutlined />} title={t('singbox.noRuleSets')} description={t('singbox.noRuleSetsHint')} />
        ) : (
          ruleSets.map((rs, i) => {
            const tags = ruleSetTags(rs)
            const used = tags.reduce((n, tag) => n + refsTo(doc, 'ruleset', tag).length, 0)
            const issues = problems.filter((p) => p.tab === 'rules' && !!p.tag && tags.includes(p.tag))
            return (
              <Row
                key={`${tags.join(',')}-${i}`}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.875rem' }}>
                      {tags.length > 1 ? t('singbox.ruleSetGroup', { first: tags[0], count: tags.length - 1 }) : tags[0] || '—'}
                    </Box>
                    <Chip label={t(`singbox.${rs.type === 'local' ? 'local' : rs.type === 'inline' ? 'inline' : 'remote'}`)} />
                    {rs.type !== 'inline' && <Chip label={rs.format === 'source' ? 'JSON' : 'SRS'} variant="outlined" />}
                    {used === 0 ? <Chip label={t('singbox.unused')} color="warning" /> : <Chip label={t('singbox.usedInRules', { count: used })} variant="outlined" />}
                    {issues.length > 0 && (
                      <Tooltip title={issues.map((p) => problemText(t, p)).join('\n')}>
                        <ErrorOutline color="error" sx={{ fontSize: 16 }} />
                      </Tooltip>
                    )}
                  </Box>
                }
                description={
                  <>
                    <Box component="span" sx={{ display: 'block', fontFamily: FONT_MONO, fontSize: '0.75rem', wordBreak: 'break-all' }}>
                      {ruleSetSource(rs)}
                    </Box>
                    {tags.length > 1 && (
                      <Box component="span" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', my: 0.5 }}>
                        {tags.map((tag) => (
                          <Chip key={tag} label={tag} variant="outlined" sx={{ fontFamily: FONT_MONO }} />
                        ))}
                      </Box>
                    )}
                    {rs.type === 'remote' && (
                      <Box component="span" sx={{ display: 'block', fontSize: '0.75rem' }}>
                        {rs.download_detour ? t('singbox.downloadsVia', { tag: rs.download_detour }) : t('singbox.downloadsDirect')}
                        {rs.update_interval ? ` · ${t('singbox.updatesEvery', { interval: rs.update_interval })}` : ''}
                      </Box>
                    )}
                  </>
                }
                control={
                  <>
                    <Tooltip title={t('common.edit')}>
                      <IconButton size="small" onClick={() => setSetDialog({ index: i, rs })}>
                        <EditOutlined />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('common.delete')}>
                      <IconButton size="small" color="error" onClick={() => setRemove({ kind: 'ruleset', tags, mode: 'delete' })}>
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

      <Menu anchorEl={quickMenu} open={!!quickMenu} onClose={() => setQuickMenu(null)}>
        {QUICK_RULES.map((kind) => (
          <MenuItem key={kind} onClick={() => quick(kind)} sx={{ maxWidth: 380, whiteSpace: 'normal' }}>
            <ListItemText primary={t(`singbox.quick.${kind}`)} secondary={t(`singbox.quick.${kind}Hint`)} />
          </MenuItem>
        ))}
      </Menu>
      <RuleDialog open={!!ruleDialog} index={ruleDialog?.index ?? null} initial={ruleDialog?.rule ?? null} onClose={() => setRuleDialog(null)} />
      <RuleSetDialog open={!!setDialog} index={setDialog?.index ?? null} initial={setDialog?.rs ?? null} onClose={() => setSetDialog(null)} />
      <RemoveDialog request={remove} onClose={() => setRemove(null)} />
    </>
  )
}

export default RulesTab
