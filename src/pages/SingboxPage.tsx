import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Skeleton,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Close,
  CreateNewFolderOutlined,
  DescriptionOutlined,
  ExpandLess,
  ExpandMore,
  FolderOpenOutlined,
  HubOutlined,
  Redo,
  SaveOutlined,
  Undo,
} from '@mui/icons-material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ask, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { singboxCreate, singboxForget, singboxOpen, singboxRevision, singboxSetBinary, singboxState } from '../api/tauri'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { Section, Row } from '../components/SettingsSection'
import NodesTab from '../components/singbox/NodesTab'
import GroupsTab from '../components/singbox/GroupsTab'
import RulesTab from '../components/singbox/RulesTab'
import JsonTab, { type JsonTabHandle } from '../components/singbox/JsonTab'
import ReviewDialog from '../components/singbox/ReviewDialog'
import { problemText } from '../components/singbox/common'
import { ParseError, STARTER_CONFIG, groupsOf, nodesOf, routeRulesOf, serialize } from '../lib/singbox/doc'
import { closeSession, getSession, isDirty, loadFile, redo, undo, useSingbox } from '../lib/singbox/store'
import { validate, type Problem, type Tab as ProblemTab } from '../lib/singbox/validate'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { FONT_MONO } from '../theme'

type PageTab = ProblemTab | 'json'
const STATE_KEY = ['singboxState']

function ProblemsPanel({ problems, onGo }: { problems: Problem[]; onGo: (tab: ProblemTab) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const errors = problems.filter((p) => p.level === 'error').length
  const warnings = problems.filter((p) => p.level === 'warning').length
  if (problems.length === 0) return null
  const severity = errors ? 'error' : warnings ? 'warning' : 'info'
  return (
    <Alert
      severity={severity}
      sx={{ mb: 2, '& .MuiAlert-message': { flex: 1 } }}
      action={
        <IconButton size="small" color="inherit" onClick={() => setOpen(!open)} aria-label={t('singbox.showProblems')}>
          {open ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      }
    >
      <Box sx={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        {errors || warnings
          ? t(errors ? 'singbox.problemsSummary' : 'singbox.warningsSummary', {
              list: [errors && t('singbox.nErrors', { count: errors }), warnings && t('singbox.nWarnings', { count: warnings })].filter(Boolean).join(', '),
            })
          : problems.length === 1
            ? problemText(t, problems[0])
            : t('singbox.tipsSummary', { count: problems.length })}
      </Box>
      <Collapse in={open}>
        <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.5 }}>
          {problems.map((p, i) => (
            <li key={i}>
              <Box component="span" sx={{ fontWeight: p.level === 'error' ? 500 : 400 }}>
                {problemText(t, p)}
              </Box>
              {p.tab && (
                <Button size="small" color="inherit" sx={{ ml: 1, minWidth: 0, py: 0, height: 22 }} onClick={() => onGo(p.tab!)}>
                  {t('singbox.show')}
                </Button>
              )}
            </li>
          ))}
        </Box>
      </Collapse>
    </Alert>
  )
}

function Welcome({ onOpen, onCreate, opening }: { onOpen: (path?: string) => void; onCreate: () => void; opening: boolean }) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: state, isLoading } = useQuery({ queryKey: STATE_KEY, queryFn: singboxState })
  const reload = () => queryClient.invalidateQueries({ queryKey: STATE_KEY })

  const chooseBinary = async () => {
    const path = await openDialog({ multiple: false, directory: false, title: t('singbox.chooseBinary') })
    if (typeof path !== 'string') return
    try {
      const bin = await singboxSetBinary(path)
      toast(t('singbox.binarySet', { version: bin?.version ?? '' }))
      reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Box sx={{ maxWidth: 820 }}>
      <PageHeader
        title="sing-box"
        description={t('singbox.subtitle')}
        actions={
          <>
            <Button startIcon={<CreateNewFolderOutlined />} onClick={onCreate}>
              {t('singbox.newConfig')}
            </Button>
            <Button variant="contained" startIcon={<FolderOpenOutlined />} onClick={() => onOpen()} disabled={opening}>
              {t('singbox.openConfig')}
            </Button>
          </>
        }
      />
      <Section title={t('singbox.recent')}>
        {isLoading ? (
          <Skeleton variant="rounded" height={64} />
        ) : !state?.recent.length ? (
          <EmptyState
            icon={<HubOutlined />}
            title={t('singbox.noRecent')}
            description={t('singbox.noRecentHint')}
            action={
              <Button variant="contained" startIcon={<FolderOpenOutlined />} onClick={() => onOpen()}>
                {t('singbox.openConfig')}
              </Button>
            }
          />
        ) : (
          state.recent.map((r) => (
            <Row
              key={r.path}
              leading={<DescriptionOutlined color={r.exists ? 'action' : 'disabled'} />}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {r.path.split(/[\\/]/).pop()}
                  {!r.exists && <Chip label={t('singbox.fileMissing')} color="warning" />}
                </Box>
              }
              description={
                <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', wordBreak: 'break-all' }}>
                  {r.path}
                </Box>
              }
              control={
                <>
                  <Tooltip title={t('singbox.forget')}>
                    <IconButton
                      size="small"
                      onClick={async () => {
                        await singboxForget(r.path)
                        reload()
                      }}
                    >
                      <Close />
                    </IconButton>
                  </Tooltip>
                  <Button size="small" variant="contained" disabled={!r.exists || opening} onClick={() => onOpen(r.path)}>
                    {t('singbox.open')}
                  </Button>
                </>
              }
            />
          ))
        )}
      </Section>
      <Section title={t('singbox.binary')}>
        <Row
          label={state?.binary ? `sing-box ${state.binary.version ?? ''}` : t('singbox.binaryMissing')}
          description={
            state?.binary ? (
              <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', wordBreak: 'break-all' }}>
                {state.binary.path}
              </Box>
            ) : (
              t('singbox.binaryMissingHint')
            )
          }
          control={
            <>
              {state?.custom_binary && (
                <Button
                  size="small"
                  onClick={async () => {
                    await singboxSetBinary(null)
                    reload()
                  }}
                >
                  {t('singbox.automatic')}
                </Button>
              )}
              <Button size="small" onClick={chooseBinary}>
                {t('singbox.choose')}
              </Button>
            </>
          }
        />
      </Section>
      <Typography variant="body2" color="text.secondary" sx={{ px: 0.25 }}>
        {t('singbox.welcomeHint')}
      </Typography>
    </Box>
  )
}

function SingboxPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const session = useSingbox()
  const [tab, setTab] = useState<PageTab>('nodes')
  const [reviewing, setReviewing] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  /** The file was changed outside SSHUI while there were unsaved edits */
  const [changedOutside, setChangedOutside] = useState(false)
  const jsonRef = useRef<JsonTabHandle>(null)
  const dirty = isDirty(session)
  const doc = session?.current.doc
  const problems = useMemo(() => (doc ? validate(doc, session?.binary?.version) : []), [doc, session?.binary?.version])

  const confirmDiscard = async () => !isDirty(session) || (await ask(t('singbox.discardConfirm'), { title: 'sing-box', kind: 'warning' }))

  const openFile = async (path?: string) => {
    if (!(await confirmDiscard())) return
    const chosen =
      path ??
      (await openDialog({ multiple: false, directory: false, title: t('singbox.openConfig'), filters: [{ name: 'JSON', extensions: ['json', 'jsonc'] }, { name: '*', extensions: ['*'] }] }))
    if (typeof chosen !== 'string') return
    setOpening(true)
    setOpenError(null)
    try {
      loadFile(await singboxOpen(chosen))
      setTab('nodes')
    } catch (e) {
      setOpenError(e instanceof ParseError && e.line ? t('singbox.jsonErrorAt', { line: e.line, column: e.column, message: e.message }) : errorMessage(e))
    } finally {
      setOpening(false)
      queryClient.invalidateQueries({ queryKey: STATE_KEY })
    }
  }

  const createFile = async () => {
    if (!(await confirmDiscard())) return
    const path = await saveDialog({ title: t('singbox.newConfig'), defaultPath: 'config.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (!path) return
    try {
      loadFile(await singboxCreate(path, serialize(STARTER_CONFIG, '  ', true)))
      setTab('nodes')
      toast(t('singbox.created'))
    } catch (e) {
      setOpenError(errorMessage(e))
    }
  }

  const close = async () => {
    if (!(await confirmDiscard())) return
    closeSession()
  }

  const changeTab = (next: PageTab) => {
    // Unapplied JSON edits are applied when leaving the tab, or keep you there if invalid
    if (tab === 'json' && next !== 'json' && jsonRef.current && !jsonRef.current.commit()) return
    setTab(next)
  }

  const review = () => {
    if (tab === 'json' && jsonRef.current && !jsonRef.current.commit()) return
    setReviewing(true)
  }

  // When the window comes back, pick up edits made elsewhere (e.g. by a sing-box client):
  // reload quietly if nothing is unsaved here, otherwise offer to reload
  useEffect(() => {
    const check = async () => {
      const s = getSession()
      if (!s || document.visibilityState === 'hidden') return
      const current = await singboxRevision(s.path).catch(() => null)
      const latest = getSession()
      if (!current || !latest || latest.path !== s.path || current === latest.revision) return
      if (isDirty(latest)) {
        setChangedOutside(true)
        return
      }
      try {
        loadFile(await singboxOpen(latest.path))
        toast(t('singbox.reloadedOutside'), 'info')
      } catch {
        setChangedOutside(true)
      }
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [t, toast])

  const reloadFromDisk = async () => {
    if (!getSession()) return
    try {
      loadFile(await singboxOpen(getSession()!.path))
      setChangedOutside(false)
      toast(t('singbox.reloaded'))
    } catch (e) {
      setOpenError(errorMessage(e))
    }
  }

  // Ctrl+S to save, Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) for undo/redo outside text fields
  const reviewRef = useRef(review)
  reviewRef.current = review
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !getSession()) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        // Inside a dialog its own edits aren't applied yet, so don't review
        if (!document.querySelector('.MuiDialog-root')) reviewRef.current()
        return
      }
      const target = e.target as HTMLElement | null
      const editing = typeof target?.closest === 'function' && !!target.closest('input, textarea, [contenteditable="true"], .monaco-editor')
      if (editing || document.querySelector('.MuiDialog-root')) return
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!session || !doc) {
    return (
      <>
        {openError && (
          <Alert severity="error" sx={{ mb: 2, maxWidth: 820 }} onClose={() => setOpenError(null)}>
            {t('singbox.openFailed')} {openError}
          </Alert>
        )}
        <Welcome onOpen={openFile} onCreate={createFile} opening={opening} />
      </>
    )
  }

  const nodeCount = nodesOf(doc).length
  const groupCount = groupsOf(doc).length
  const ruleCount = routeRulesOf(doc).length
  const errorsIn = (tab: ProblemTab) => problems.some((p) => p.tab === tab && p.level === 'error')
  const tabLabel = (label: string, count: number, tab: ProblemTab) => (
    <Badge color="error" variant="dot" invisible={!errorsIn(tab)} sx={{ '& .MuiBadge-dot': { right: -6, top: 2 } }}>
      <span>
        {label}
        <Box component="span" sx={{ ml: 0.75, color: 'text.secondary', fontWeight: 400 }}>
          {count}
        </Box>
      </span>
    </Badge>
  )

  return (
    <Box>
      <PageHeader
        title="sing-box"
        meta={session.binary?.version ? <Chip label={session.binary.version} /> : undefined}
        description={
          <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', wordBreak: 'break-all' }}>
              {session.path}
            </Box>
            {dirty && <Chip label={t('singbox.unsaved')} color="warning" />}
          </Box>
        }
        actions={
          <>
            <Tooltip title={`${t('singbox.undo')} (Ctrl+Z)`}>
              <span>
                <IconButton onClick={undo} disabled={session.past.length === 0}>
                  <Undo />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={`${t('singbox.redo')} (Ctrl+Y)`}>
              <span>
                <IconButton onClick={redo} disabled={session.future.length === 0}>
                  <Redo />
                </IconButton>
              </span>
            </Tooltip>
            <Button startIcon={<FolderOpenOutlined />} onClick={() => openFile()}>
              {t('singbox.openOther')}
            </Button>
            <Button onClick={close}>{t('common.close')}</Button>
            <Button variant="contained" startIcon={<SaveOutlined />} onClick={review} disabled={!dirty}>
              {t('singbox.reviewSave')}
            </Button>
          </>
        }
      />

      {openError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setOpenError(null)}>
          {t('singbox.openFailed')} {openError}
        </Alert>
      )}
      {changedOutside && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          onClose={() => setChangedOutside(false)}
          action={
            <Button size="small" color="inherit" onClick={reloadFromDisk}>
              {t('singbox.reloadDiscard')}
            </Button>
          }
        >
          {t('singbox.changedOutside')}
        </Alert>
      )}
      {session.lossy && <Alert severity="warning" sx={{ mb: 2 }}>{t('singbox.lossyWarning')}</Alert>}
      <ProblemsPanel problems={problems} onGo={(p) => changeTab(p)} />

      <Tabs value={tab} onChange={(_, v) => changeTab(v)} sx={{ mb: 2.5 }}>
        <Tab value="nodes" label={tabLabel(t('singbox.tabNodes'), nodeCount, 'nodes')} />
        <Tab value="groups" label={tabLabel(t('singbox.tabGroups'), groupCount, 'groups')} />
        <Tab value="rules" label={tabLabel(t('singbox.tabRules'), ruleCount, 'rules')} />
        <Tab value="json" label="JSON" />
      </Tabs>

      {tab === 'nodes' && <NodesTab problems={problems} />}
      {tab === 'groups' && <GroupsTab problems={problems} />}
      {tab === 'rules' && <RulesTab problems={problems} />}
      {tab === 'json' && <JsonTab ref={jsonRef} />}

      <ReviewDialog open={reviewing} problems={problems} onClose={() => setReviewing(false)} />
    </Box>
  )
}


export default SingboxPage
