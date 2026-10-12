import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Skeleton,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { Add, DeleteOutline, DescriptionOutlined, Refresh, SaveOutlined, Undo } from '@mui/icons-material'
import Editor from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ask } from '@tauri-apps/plugin-dialog'
import {
  agentDeleteFile,
  agentInstructionFiles,
  agentReadFile,
  agentWriteFile,
  type AgentId,
  type InstructionGroup,
} from '../../api/tauri'
import { useToast, errorMessage } from '../../contexts/ToastContext'
import { confirmAction } from '../../lib/confirm'
import { editorOptions, editorTheme, setupMonaco } from '../../lib/monaco'
import { FONT_MONO } from '../../theme'

/** Starting content for a new file, by agent and group */
const template = (agent: AgentId, group: string, name: string): string => {
  const front = (fields: Record<string, string>) =>
    `---\n${Object.entries(fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')}\n---\n\n`
  switch (group) {
    case 'agents':
      return `${front({ name, description: 'Use this agent when …', tools: 'Read, Grep, Glob' })}You are a specialist in …\n`
    case 'commands':
      return `${front({ description: 'What this command does', 'argument-hint': '[arguments]' })}Do the following: $ARGUMENTS\n`
    case 'outputStyles':
      return `${front({ name, description: 'How responses should look' })}Respond …\n`
    case 'skills':
      return `${front({ name, description: 'What this skill does and when to use it' })}# ${name}\n\n## Instructions\n\n`
    case 'prompts':
      return `${front({ description: 'What this prompt does', 'argument-hint': '[arguments]' })}${agent === 'codex' ? '$ARGUMENTS' : ''}\n`
    default:
      return ''
  }
}

/** File name part shown in the list: "commands/git/commit.md" → "git/commit" */
const displayName = (group: InstructionGroup, path: string) => {
  if (group.layout === 'single') return path
  const rest = path.slice(group.dir.length + 1)
  return group.layout === 'skill' ? rest.replace(/\/SKILL\.md$/, '') : rest.replace(/\.md$/i, '')
}

const SEGMENT = /^[^\s.<>:"/\\|?*][^<>:"/\\|?*]{0,118}[^\s.<>:"/\\|?*]$|^[^\s.<>:"/\\|?*]$/

/** The relative path for a new file named `name` in `group`, or null if the name is invalid. */
const newPath = (group: InstructionGroup, name: string): string | null => {
  const clean = name.trim().replace(/\s+/g, '-').replace(/\.md$/i, '')
  const parts = clean.split('/')
  if (!parts.every((p) => SEGMENT.test(p))) return null
  if (group.layout === 'skill') return parts.length === 1 ? `${group.dir}/${clean}/SKILL.md` : null
  if (group.layout === 'nested') return parts.length <= 2 ? `${group.dir}/${clean}.md` : null
  return parts.length === 1 ? `${group.dir}/${clean}.md` : null
}

function NewFileDialog({
  group,
  existing,
  onClose,
  onCreate,
}: {
  group: InstructionGroup | null
  existing: string[]
  onClose: () => void
  onCreate: (path: string, name: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setName(''), [group])
  const path = group ? newPath(group, name) : null
  const error = !name.trim() ? null : !path ? t('agents.nameInvalid') : existing.includes(path) ? t('agents.nameTaken') : null

  const create = async () => {
    if (!path || error) return
    setBusy(true)
    try {
      await onCreate(path, name.trim().split('/').pop()!.replace(/\s+/g, '-').replace(/\.md$/i, ''))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!group} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{group && t('agents.newIn', { group: t(`agents.groups.${group.id}`) })}</DialogTitle>
      <DialogContent>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
          sx={{ mt: 1 }}
        >
          <TextField
            fullWidth
            autoFocus
            label={t('agents.fileName')}
            value={name}
            placeholder={group?.layout === 'nested' ? 'review or git/commit' : 'code-reviewer'}
            onChange={(e) => setName(e.target.value)}
            error={!!error}
            helperText={error ?? (path ? path : group && t(`agents.groupHints.${group.id}`))}
            inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={busy}>
          {t('hostsFile.cancel')}
        </Button>
        <Button variant="contained" onClick={create} disabled={!path || !!error || busy}>
          {t('agents.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** File list of an agent's Markdown instruction files with an editor for the selected one. */
function InstructionFilesEditor({ agent }: { agent: AgentId }) {
  const { t } = useTranslation()
  const toast = useToast()
  const theme = useTheme()
  const queryClient = useQueryClient()
  const listKey = ['agentFiles', agent]
  const { data, isLoading, isFetching, error } = useQuery({ queryKey: listKey, queryFn: () => agentInstructionFiles(agent) })

  const [selected, setSelected] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [draft, setDraft] = useState('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState<InstructionGroup | null>(null)
  const dirty = draft !== saved

  const allFiles = data?.groups.flatMap((g) => g.files) ?? []
  const current = allFiles.find((f) => f.path === selected)

  // Open the global instructions file first
  useEffect(() => {
    if (!selected && data) setSelected(data.groups[0]?.files[0]?.path ?? null)
  }, [data, selected])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setLoadingFile(true)
    agentReadFile(agent, selected)
      .then((text) => {
        if (cancelled) return
        setSaved(text)
        setDraft(text)
      })
      .catch((e) => toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error'))
      .finally(() => !cancelled && setLoadingFile(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, selected])

  const reloadList = () => queryClient.invalidateQueries({ queryKey: listKey })

  const select = async (path: string) => {
    if (path === selected) return
    if (dirty && !(await ask(t('agents.discardChanges'), { title: t('agents.unsaved'), kind: 'warning' }))) return
    setSelected(path)
  }

  const save = async () => {
    if (!selected || saving) return
    setSaving(true)
    try {
      await agentWriteFile(agent, selected, draft)
      setSaved(draft)
      toast(t('devtools.saved'))
      reloadList()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    } finally {
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  const remove = async () => {
    if (!selected || !current?.exists) return
    if (!(await confirmAction(t('agents.deleteConfirm', { path: selected }), t('proxy.delete')))) return
    try {
      await agentDeleteFile(agent, selected)
      toast(t('devtools.removed'))
      setSelected(null)
      setSaved('')
      setDraft('')
      reloadList()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    }
  }

  const create = async (path: string, name: string) => {
    try {
      await agentWriteFile(agent, path, template(agent, creating!.id, name), true)
      await reloadList()
      setSelected(path)
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
      throw e
    }
  }

  if (error) return <Typography color="error">{String(error)}</Typography>

  return (
    <>
      <Paper
        variant="outlined"
        sx={(th) => ({
          display: 'flex',
          height: 560,
          overflow: 'hidden',
          boxShadow: `0 1px 2px rgba(0,0,0,.05), ${th.tokens.edge}`,
        })}
      >
        {/* File list */}
        <Box
          sx={(th) => ({
            width: 230,
            flexShrink: 0,
            borderRight: `1px solid ${th.tokens.border}`,
            overflow: 'auto',
            py: 1,
          })}
        >
          {isLoading
            ? [0, 1, 2].map((i) => <Skeleton key={i} height={28} sx={{ mx: 1.5 }} />)
            : data?.groups.map((group) => (
                <Box key={group.id} sx={{ mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, height: 28 }}>
                    <Tooltip title={t(`agents.groupHints.${group.id}`)} placement="right">
                      <Typography sx={{ flex: 1, fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary' }} noWrap>
                        {t(`agents.groups.${group.id}`)}
                      </Typography>
                    </Tooltip>
                    {group.layout !== 'single' && (
                      <Tooltip title={t('agents.newIn', { group: t(`agents.groups.${group.id}`) })}>
                        <IconButton size="small" onClick={() => setCreating(group)} sx={{ p: 0.25, '& svg': { fontSize: 16 } }}>
                          <Add />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                  {group.layout !== 'single' && group.files.length === 0 && (
                    <Typography sx={{ px: 1.5, fontSize: '0.75rem', color: 'text.disabled' }}>{t('agents.none')}</Typography>
                  )}
                  {group.files.map((file) => {
                    const active = file.path === selected
                    return (
                      <Box
                        key={file.path}
                        onClick={() => select(file.path)}
                        sx={(th) => ({
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                          mx: 0.75,
                          px: 0.75,
                          height: 30,
                          borderRadius: '6px',
                          cursor: 'pointer',
                          bgcolor: active ? th.tokens.muted : 'transparent',
                          '&:hover': { bgcolor: th.tokens.muted },
                        })}
                      >
                        <DescriptionOutlined sx={{ fontSize: 15, color: file.exists ? 'text.secondary' : 'text.disabled' }} />
                        <Typography
                          noWrap
                          sx={{
                            flex: 1,
                            fontSize: '0.8125rem',
                            fontWeight: active ? 500 : 400,
                            color: file.exists ? 'text.primary' : 'text.disabled',
                          }}
                        >
                          {displayName(group, file.path)}
                        </Typography>
                        {!file.exists && <Chip label={t('agents.notCreated')} sx={{ height: 18, fontSize: '0.6875rem' }} />}
                        {file.exists && file.size === 0 && <Chip label={t('agents.empty')} sx={{ height: 18, fontSize: '0.6875rem' }} />}
                      </Box>
                    )
                  })}
                </Box>
              ))}
        </Box>

        {/* Editor */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Box
            sx={(th) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              height: 44,
              borderBottom: `1px solid ${th.tokens.border}`,
            })}
          >
            <Typography noWrap sx={{ flex: 1, fontFamily: FONT_MONO, fontSize: '0.75rem', color: 'text.secondary' }}>
              {selected ?? ''}
              {dirty && ' •'}
            </Typography>
            <Tooltip title={t('hosts.refresh')}>
              <IconButton size="small" onClick={reloadList} disabled={isFetching}>
                <Refresh />
              </IconButton>
            </Tooltip>
            {current?.exists && (
              <Tooltip title={t('proxy.delete')}>
                <IconButton size="small" color="error" onClick={remove}>
                  <DeleteOutline />
                </IconButton>
              </Tooltip>
            )}
            <Button size="small" variant="text" startIcon={<Undo />} onClick={() => setDraft(saved)} disabled={!dirty || saving}>
              {t('agents.revert')}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveOutlined />}
              onClick={save}
              disabled={!selected || saving || (!dirty && !!current?.exists)}
            >
              {current?.exists ? t('devtools.save') : t('agents.create')}
            </Button>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {loadingFile && !draft ? null : selected ? (
              <Editor
                key={selected}
                height="100%"
                language="markdown"
                theme={editorTheme(theme.palette.mode)}
                beforeMount={setupMonaco}
                onMount={(editor, monaco) => {
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
                }}
                value={draft}
                onChange={(v) => setDraft(v ?? '')}
                options={editorOptions}
              />
            ) : null}
          </Box>
        </Box>
      </Paper>
      {data && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1, px: 0.25 }}>
          {t('agents.folder')}: <Box component="span" sx={{ fontFamily: FONT_MONO }}>{data.home}</Box>
        </Typography>
      )}
      <NewFileDialog
        group={creating}
        existing={allFiles.map((f) => f.path)}
        onClose={() => setCreating(null)}
        onCreate={create}
      />
    </>
  )
}

export default InstructionFilesEditor
