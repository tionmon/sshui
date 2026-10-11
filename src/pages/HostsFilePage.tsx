import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Add,
  Check,
  ContentCopy,
  DeleteOutline,
  DescriptionOutlined,
  DriveFileRenameOutline,
  FolderOpenOutlined,
  MoreHoriz,
  Refresh,
  Save,
  SwapHoriz,
  Undo,
} from '@mui/icons-material'
import { useEffect, useRef, useState, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Editor from '@monaco-editor/react'
import { listen } from '@tauri-apps/api/event'
import { ask } from '@tauri-apps/plugin-dialog'
import {
  applyHostsScheme,
  deleteHostsScheme,
  loadHostsState,
  openHostsBackupDir,
  saveHostsScheme,
  saveSystemHosts,
  HOSTS_STATE_CHANGED_EVENT,
  type HostsScheme,
  type HostsState,
} from '../api/tauri'
import PageHeader from '../components/PageHeader'
import SchemeNameDialog, { type SchemeSource } from '../components/SchemeNameDialog'
import { useThemeMode } from '../contexts/ThemeContext'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { confirmAction } from '../lib/confirm'
import { setupMonaco, editorTheme, editorOptions } from '../lib/monaco'
import { FONT_MONO } from '../theme'

const SYSTEM = '__system__'
const QUERY_KEY = ['hostsState']

const normalize = (text: string) => text.replace(/\r\n?/g, '\n').trimEnd()
const sameContent = (a: string, b: string) => normalize(a) === normalize(b)
const countEntries = (text: string) =>
  text.split('\n').filter((line) => {
    const trimmed = line.trim()
    return trimmed && !trimmed.startsWith('#')
  }).length

interface RowProps {
  icon: ReactNode
  title: string
  subtitle: string
  selected: boolean
  active?: boolean
  onClick: () => void
  trailing?: ReactNode
}

function Row({ icon, title, subtitle, selected, active, onClick, trailing }: RowProps) {
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-current={selected || undefined}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1,
        py: 0.875,
        mb: 0.25,
        borderRadius: '10px',
        cursor: 'pointer',
        outline: 'none',
        bgcolor: selected ? theme.tokens.accent : 'transparent',
        boxShadow: selected ? `inset 0 0 0 1px ${theme.tokens.border}` : 'none',
        transition: 'background-color .1s',
        '&:hover': { bgcolor: theme.tokens.accent },
        '&:focus-visible': { boxShadow: `0 0 0 2px ${theme.tokens.ring}` },
        '& .row-action': { opacity: selected ? 1 : 0, transition: 'opacity .1s' },
        '&:hover .row-action, &:focus-within .row-action': { opacity: 1 },
      })}
    >
      <Box
        sx={(theme) => ({
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${active ? 'transparent' : theme.tokens.border}`,
          bgcolor: active ? theme.tokens.primary : theme.tokens.muted,
          color: active ? theme.tokens.primaryForeground : 'text.secondary',
          '& svg': { fontSize: 15 },
        })}
      >
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" fontWeight={500} noWrap>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {subtitle}
        </Typography>
      </Box>
      {trailing}
    </Box>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      component="div"
      sx={{ px: 1, pt: 1, pb: 0.5, fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.75 }}
    >
      {children}
    </Typography>
  )
}

function HostsFilePage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { mode } = useThemeMode()

  const { data: state, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: loadHostsState,
  })

  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'rename'; scheme: HostsScheme } | null>(null)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; scheme: HostsScheme } | null>(null)

  // Switches made from the tray menu update the page too
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    listen(HOSTS_STATE_CHANGED_EVENT, () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }))
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [queryClient])

  const schemes = state?.schemes ?? []
  const current = schemes.find((s) => s.id === selected) ?? null
  const activeScheme = schemes.find((s) => s.id === state?.active_id) ?? null

  // Default to the active scheme; fall back when the selected scheme disappears
  useEffect(() => {
    if (!state || selected === SYSTEM || (selected && state.schemes.some((s) => s.id === selected))) return
    setSelected(state.active_id && state.schemes.some((s) => s.id === state.active_id) ? state.active_id : SYSTEM)
    setDraft(null)
  }, [state, selected])

  const isSystem = selected === SYSTEM
  const baseline = isSystem ? state?.system_content ?? '' : current?.content ?? ''
  const value = draft ?? baseline
  const dirty = draft !== null && draft !== baseline
  const outOfSync = !!state && !!activeScheme && !sameContent(activeScheme.content, state.system_content)
  const isActive = !!current && current.id === state?.active_id

  const setState = (next: HostsState) => queryClient.setQueryData(QUERY_KEY, next)
  const reload = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  const fail = (e: unknown) => toast(`${t('hostsFile.failed')}: ${errorMessage(e)}`, 'error')

  const confirmDiscard = async () =>
    !dirty || (await ask(t('hostsFile.discardConfirm'), { title: t('hostsFile.discardTitle'), kind: 'warning' }))

  const select = async (id: string) => {
    if (id === selected || !(await confirmDiscard())) return
    setSelected(id)
    setDraft(null)
  }

  const handleSave = async () => {
    if (!dirty || draft === null || saving) return
    setSaving(true)
    try {
      if (isSystem) {
        setState(await saveSystemHosts(draft))
        toast(t('hostsFile.systemSaved'))
      } else if (current) {
        await saveHostsScheme({ id: current.id, name: current.name, content: draft })
        await reload()
        toast(t('hostsFile.saved'))
      }
      setDraft(null)
    } catch (e) {
      fail(e)
    } finally {
      setSaving(false)
    }
  }

  const handleApply = async (scheme: HostsScheme) => {
    if (applyingId) return
    setApplyingId(scheme.id)
    try {
      const editing = scheme.id === selected && dirty && draft !== null
      if (editing) {
        await saveHostsScheme({ id: scheme.id, name: scheme.name, content: draft })
      }
      setState(await applyHostsScheme(scheme.id))
      if (editing) setDraft(null)
      toast(t('hostsFile.switched', { name: scheme.name }))
    } catch (e) {
      fail(e)
      reload()
    } finally {
      setApplyingId(null)
    }
  }

  // Ctrl/Cmd+S in the editor saves the current selection
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave

  const openCreate = async () => {
    if (await confirmDiscard()) setDialog({ mode: 'create' })
  }

  const handleCreate = async (name: string, source: SchemeSource) => {
    const content =
      source === 'current' ? state?.system_content ?? '' : `# ${name}\n127.0.0.1 localhost\n::1 localhost\n`
    try {
      const created = await saveHostsScheme({ name, content })
      await reload()
      setSelected(created.id)
      setDraft(null)
      toast(t('hostsFile.saved'))
    } catch (e) {
      fail(e)
      throw e
    }
  }

  const handleRename = async (scheme: HostsScheme, name: string) => {
    try {
      await saveHostsScheme({ id: scheme.id, name, content: scheme.content })
      await reload()
    } catch (e) {
      fail(e)
      throw e
    }
  }

  const handleDuplicate = async (scheme: HostsScheme) => {
    const taken = new Set(schemes.map((s) => s.name.toLowerCase()))
    let name = `${scheme.name} ${t('hostsFile.copySuffix')}`
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${scheme.name} ${t('hostsFile.copySuffix')} ${i}`
    try {
      await saveHostsScheme({ name, content: scheme.content })
      await reload()
      toast(t('hostsFile.saved'))
    } catch (e) {
      fail(e)
    }
  }

  const handleDelete = async (scheme: HostsScheme) => {
    try {
      const confirmed = await confirmAction(
        t('hostsFile.deleteConfirm', { name: scheme.name }),
        t('hostsFile.deleteConfirmTitle'),
      )
      if (!confirmed) return
      await deleteHostsScheme(scheme.id)
      await reload()
      toast(t('hostsFile.deleted'))
    } catch (e) {
      fail(e)
    }
  }

  const takenNames = schemes
    .filter((s) => dialog?.mode !== 'rename' || s.id !== dialog.scheme.id)
    .map((s) => s.name.toLowerCase())

  const primaryLabel = dirty ? t('hostsFile.saveAndUse') : isActive && outOfSync ? t('hostsFile.reapply') : t('hostsFile.useScheme')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      <PageHeader
        title={t('hostsFile.title')}
        description={t('hostsFile.subtitle')}
        actions={
          <>
            <Button startIcon={<FolderOpenOutlined />} onClick={() => openHostsBackupDir().catch(fail)}>
              {t('hostsFile.backups')}
            </Button>
            <Button startIcon={<Refresh />} onClick={() => refetch()} disabled={isFetching}>
              {t('hosts.refresh')}
            </Button>
            <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
              {t('hostsFile.newScheme')}
            </Button>
          </>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('hostsFile.loadError')}: {errorMessage(error)}
        </Alert>
      )}

      {outOfSync && activeScheme && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button size="small" onClick={() => handleApply(activeScheme)} disabled={!!applyingId}>
              {t('hostsFile.reapply')}
            </Button>
          }
        >
          {t('hostsFile.outOfSync', { name: activeScheme.name })}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 2 }}>
        {/* Scheme list */}
        <Paper
          variant="outlined"
          sx={(theme) => ({
            width: 272,
            flexShrink: 0,
            overflow: 'auto',
            p: 1,
            boxShadow: `0 1px 2px rgba(0,0,0,.05), ${theme.tokens.edge}`,
          })}
        >
          {isLoading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={44} sx={{ mb: 1 }} />)
          ) : (
            <>
              <Row
                icon={<DescriptionOutlined />}
                title={t('hostsFile.system')}
                subtitle={state?.hosts_path ?? ''}
                selected={isSystem}
                onClick={() => select(SYSTEM)}
                trailing={outOfSync && <Chip label={t('hostsFile.modified')} color="warning" />}
              />

              <SectionLabel>
                {t('hostsFile.schemes')}
                <Chip label={schemes.length} sx={{ height: 18 }} />
              </SectionLabel>

              {schemes.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1.5 }}>
                  {t('hostsFile.empty')}
                </Typography>
              )}

              {schemes.map((scheme) => {
                const active = scheme.id === state?.active_id
                return (
                  <Row
                    key={scheme.id}
                    icon={active ? <Check /> : <SwapHoriz />}
                    title={scheme.name}
                    subtitle={t('hostsFile.entries', { count: countEntries(scheme.content) })}
                    selected={scheme.id === selected}
                    active={active}
                    onClick={() => select(scheme.id)}
                    trailing={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }} onClick={(e) => e.stopPropagation()}>
                        {active ? (
                          <Chip label={t('hostsFile.active')} color="success" />
                        ) : (
                          <Button
                            size="small"
                            className="row-action"
                            onClick={() => handleApply(scheme)}
                            disabled={!!applyingId}
                            sx={{ height: 24, px: 1, fontSize: '0.75rem' }}
                          >
                            {applyingId === scheme.id ? t('hostsFile.applying') : t('hostsFile.use')}
                          </Button>
                        )}
                        <Tooltip title={t('hostsFile.more')}>
                          <IconButton
                            size="small"
                            className="row-action"
                            aria-label={t('hostsFile.more')}
                            onClick={(e) => setMenu({ anchor: e.currentTarget, scheme })}
                            sx={{ width: 24, height: 24 }}
                          >
                            <MoreHoriz />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    }
                  />
                )
              })}
            </>
          )}
        </Paper>

        {/* Editor */}
        <Paper
          variant="outlined"
          sx={(theme) => ({
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            bgcolor: theme.tokens.card,
            boxShadow: `0 1px 2px rgba(0,0,0,.05), ${theme.tokens.edge}`,
          })}
        >
          <Box
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 2,
              py: 1.25,
              borderBottom: `1px solid ${theme.tokens.border}`,
            })}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="subtitle1" noWrap>
                  {isSystem ? t('hostsFile.system') : current?.name ?? ''}
                </Typography>
                {isActive && <Chip label={t('hostsFile.active')} color="success" />}
                {dirty && <Chip label={t('hostsFile.unsaved')} color="warning" />}
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                component="div"
                sx={isSystem ? { fontFamily: FONT_MONO } : undefined}
              >
                {isSystem ? `${state?.hosts_path ?? ''} · ${t('hostsFile.systemHint')}` : t('hostsFile.schemeHint')}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
              <Button variant="text" startIcon={<Undo />} onClick={() => setDraft(null)} disabled={!dirty || saving}>
                {t('hostsFile.revert')}
              </Button>
              <Button
                variant={isSystem ? 'contained' : 'outlined'}
                startIcon={<Save />}
                onClick={handleSave}
                disabled={!dirty || saving || !!applyingId}
              >
                {saving ? t('hostsFile.saving') : t('hostsFile.save')}
              </Button>
              {current && (
                <Button
                  variant="contained"
                  startIcon={<SwapHoriz />}
                  onClick={() => handleApply(current)}
                  disabled={!!applyingId || saving || (isActive && !dirty && !outOfSync)}
                >
                  {applyingId === current.id ? t('hostsFile.applying') : primaryLabel}
                </Button>
              )}
            </Box>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, pt: 1 }}>
            {isLoading || selected === null ? (
              <Box sx={{ px: 3 }}>
                {[220, 160, 260, 140].map((w, i) => (
                  <Skeleton key={i} width={w} height={18} sx={{ mb: 1 }} />
                ))}
              </Box>
            ) : (
              <Editor
                key={selected}
                height="100%"
                language="hosts"
                theme={editorTheme(mode)}
                beforeMount={setupMonaco}
                onMount={(editor, monaco) => {
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
                }}
                value={value}
                onChange={(v) => setDraft(v ?? '')}
                options={editorOptions}
              />
            )}
          </Box>
        </Paper>
      </Box>

      <Menu
        anchorEl={menu?.anchor}
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            if (menu) setDialog({ mode: 'rename', scheme: menu.scheme })
            setMenu(null)
          }}
        >
          <ListItemIcon>
            <DriveFileRenameOutline fontSize="small" />
          </ListItemIcon>
          {t('hostsFile.rename')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) handleDuplicate(menu.scheme)
            setMenu(null)
          }}
        >
          <ListItemIcon>
            <ContentCopy fontSize="small" />
          </ListItemIcon>
          {t('hostsFile.duplicate')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) handleDelete(menu.scheme)
            setMenu(null)
          }}
          sx={(theme) => ({ color: theme.tokens.destructiveForeground })}
        >
          <ListItemIcon sx={{ color: 'inherit' }}>
            <DeleteOutline fontSize="small" />
          </ListItemIcon>
          {t('hostsFile.delete')}
        </MenuItem>
      </Menu>

      <SchemeNameDialog
        open={!!dialog}
        mode={dialog?.mode ?? 'create'}
        initialName={dialog?.mode === 'rename' ? dialog.scheme.name : ''}
        takenNames={takenNames}
        onClose={() => setDialog(null)}
        onSubmit={(name, source) =>
          dialog?.mode === 'rename' ? handleRename(dialog.scheme, name) : handleCreate(name, source)
        }
      />
    </Box>
  )
}

export default HostsFilePage
