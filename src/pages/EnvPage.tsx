import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  IconButton,
  Skeleton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Add,
  ArrowDownward,
  ArrowUpward,
  CreateNewFolderOutlined,
  DeleteOutline,
  EditOutlined,
  OpenInNew,
  Refresh,
  TuneOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from '@mui/icons-material'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { envOpenDialog, envSetUserPath, envSetVar, envState, type EnvVar, type PathEntry } from '../api/tauri'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { Section, Row } from '../components/SettingsSection'
import { useToast, errorMessage } from '../contexts/ToastContext'
import { confirmAction } from '../lib/confirm'
import { IS_WINDOWS } from '../lib/devtools'
import { FONT_MONO } from '../theme'

const QUERY_KEY = ['envState']
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL/i
const SUGGESTED_NAMES = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'JAVA_HOME',
  'GOPATH',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'RUSTUP_DIST_SERVER',
  'RUSTUP_UPDATE_ROOT',
  'PUB_HOSTED_URL',
  'FLUTTER_STORAGE_BASE_URL',
  'ANDROID_HOME',
  'PYTHONUTF8',
  'NODE_OPTIONS',
  'EDITOR',
]

const mono = { fontFamily: FONT_MONO, fontSize: '0.75rem', wordBreak: 'break-all' } as const

function SecretValue({ name, value }: { name: string; value: string }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  const secret = SECRET_NAME.test(name)
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, maxWidth: '100%' }}>
      <Box component="span" sx={mono}>
        {secret && !shown ? '••••••••' : value || '""'}
      </Box>
      {secret && (
        <Tooltip title={shown ? t('env.hide') : t('env.show')}>
          <IconButton size="small" onClick={() => setShown(!shown)} sx={{ p: 0.25, '& svg': { fontSize: 14 } }}>
            {shown ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}

function VarDialog({
  open,
  initial,
  existing,
  onClose,
  onSave,
}: {
  open: boolean
  initial: EnvVar | null
  existing: string[]
  onClose: () => void
  onSave: (name: string, value: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setValue(initial?.value ?? '')
    }
  }, [open, initial])

  const trimmed = name.trim()
  const nameError = !trimmed
    ? null
    : /[=\s]/.test(trimmed)
      ? t('env.nameInvalid')
      : trimmed.toLowerCase() === 'path'
        ? t('env.usePathEditor')
        : !initial && existing.includes(trimmed.toLowerCase())
          ? t('env.nameTaken')
          : null

  const save = async () => {
    if (!trimmed || nameError) return
    setSaving(true)
    try {
      await onSave(trimmed, value)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? t('env.editTitle') : t('env.newTitle')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, mt: 1 }}>
          <Autocomplete
            freeSolo
            disabled={!!initial}
            options={SUGGESTED_NAMES.filter((n) => !existing.includes(n.toLowerCase()))}
            inputValue={name}
            onInputChange={(_, v) => setName(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('env.name')}
                autoFocus={!initial}
                error={!!nameError}
                helperText={nameError}
                inputProps={{ ...params.inputProps, spellCheck: false, style: { fontFamily: FONT_MONO } }}
              />
            )}
          />
          <TextField
            label={t('env.value')}
            value={value}
            autoFocus={!!initial}
            multiline
            maxRows={6}
            onChange={(e) => setValue(e.target.value)}
            helperText={t('env.valueHint')}
            inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={saving}>
          {t('hostsFile.cancel')}
        </Button>
        <Button variant="contained" onClick={save} disabled={!trimmed || !!nameError || saving}>
          {t('devtools.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function PathEditor({ entries, systemEntries, onSaved }: { entries: PathEntry[]; systemEntries: PathEntry[]; onSaved: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [draft, setDraft] = useState<string[]>([])
  const [newEntry, setNewEntry] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(entries.map((e) => e.value)), [entries])

  const info = useMemo(() => new Map(entries.map((e) => [e.value, e])), [entries])
  const systemSet = useMemo(() => new Set(systemEntries.map((e) => e.expanded.toLowerCase().replace(/\\+$/, ''))), [systemEntries])
  const dirty = JSON.stringify(draft) !== JSON.stringify(entries.map((e) => e.value))
  const missing = draft.filter((v) => info.get(v)?.exists === false)

  const move = (i: number, by: number) => {
    const next = [...draft]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    setDraft(next)
  }
  const add = (value: string) => {
    const v = value.trim()
    if (v && !draft.some((d) => d.toLowerCase() === v.toLowerCase())) setDraft([...draft, v])
    setNewEntry('')
  }
  const browse = async () => {
    const dir = await openDialog({ directory: true, multiple: false }).catch(() => null)
    if (typeof dir === 'string') add(dir)
  }
  const save = async () => {
    setSaving(true)
    try {
      await envSetUserPath(draft)
      toast(t('env.pathSaved'))
      onSaved()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title={t('env.userPath')}
      action={
        <Box sx={{ display: 'flex', gap: 1 }}>
          {missing.length > 0 && (
            <Button size="small" color="warning" onClick={() => setDraft(draft.filter((v) => !missing.includes(v)))}>
              {t('env.removeMissing', { count: missing.length })}
            </Button>
          )}
          {dirty && (
            <Button size="small" variant="text" onClick={() => setDraft(entries.map((e) => e.value))} disabled={saving}>
              {t('env.discard')}
            </Button>
          )}
          <Button size="small" variant="contained" onClick={save} disabled={!dirty || saving}>
            {t('devtools.save')}
          </Button>
        </Box>
      }
    >
      {draft.length === 0 && <Row label={t('env.pathEmpty')} />}
      {draft.map((value, i) => {
        const entry = info.get(value)
        const expanded = entry?.expanded ?? value
        const inSystem = systemSet.has(expanded.toLowerCase().replace(/\\+$/, ''))
        return (
          <Box key={`${value}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1 }}>
            <Typography sx={{ width: 22, color: 'text.secondary', fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
              {i + 1}
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ ...mono, fontSize: '0.8125rem' }}>{value}</Box>
              {expanded !== value && <Box sx={{ ...mono, color: 'text.secondary' }}>{expanded}</Box>}
            </Box>
            {!entry && <Chip label={t('env.unsaved')} color="info" />}
            {entry?.exists === false && <Chip label={t('env.missing')} color="warning" />}
            {inSystem && <Chip label={t('env.alsoInSystem')} />}
            {draft.findIndex((d) => d.toLowerCase() === value.toLowerCase()) !== i && (
              <Chip label={t('env.duplicate')} color="warning" />
            )}
            <IconButton size="small" onClick={() => move(i, -1)} disabled={i === 0}>
              <ArrowUpward />
            </IconButton>
            <IconButton size="small" onClick={() => move(i, 1)} disabled={i === draft.length - 1}>
              <ArrowDownward />
            </IconButton>
            <IconButton size="small" color="error" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
              <DeleteOutline />
            </IconButton>
          </Box>
        )
      })}
      <Box sx={{ display: 'flex', gap: 1, px: 2.5, py: 1.5 }}>
        <TextField
          fullWidth
          value={newEntry}
          placeholder={t('env.pathPlaceholder')}
          onChange={(e) => setNewEntry(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add(newEntry)}
          inputProps={{ spellCheck: false, style: { fontFamily: FONT_MONO } }}
        />
        <Button startIcon={<Add />} onClick={() => add(newEntry)} disabled={!newEntry.trim()}>
          {t('devtools.add')}
        </Button>
        <Button startIcon={<CreateNewFolderOutlined />} onClick={browse}>
          {t('env.browse')}
        </Button>
      </Box>
    </Section>
  )
}

function EnvPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching, error } = useQuery({ queryKey: QUERY_KEY, queryFn: envState, enabled: IS_WINDOWS })
  const reload = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  const [dialog, setDialog] = useState<{ open: boolean; initial: EnvVar | null }>({ open: false, initial: null })
  const [showSystem, setShowSystem] = useState(false)

  const saveVar = async (name: string, value: string | null) => {
    try {
      await envSetVar(name, value)
      toast(value === null ? t('devtools.removed') : t('devtools.saved'))
      reload()
    } catch (e) {
      toast(`${t('devtools.failed')}: ${errorMessage(e)}`, 'error')
      throw e
    }
  }
  const remove = async (v: EnvVar) => {
    if (!(await confirmAction(t('env.deleteConfirm', { name: v.name }), t('devtools.remove')))) return
    await saveVar(v.name, null).catch(() => {})
  }
  const openWindowsDialog = () => envOpenDialog().catch((e) => toast(errorMessage(e), 'error'))

  if (!IS_WINDOWS) {
    return (
      <Box sx={{ maxWidth: 820 }}>
        <PageHeader title={t('env.title')} description={t('env.subtitle')} />
        <EmptyState icon={<TuneOutlined />} title={t('env.windowsOnly')} description={t('env.windowsOnlyHint')} />
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 900 }}>
      <PageHeader
        title={t('env.title')}
        description={t('env.subtitle')}
        actions={
          <>
            <Button startIcon={<Refresh />} onClick={reload} disabled={isFetching}>
              {t('hosts.refresh')}
            </Button>
            <Button startIcon={<OpenInNew />} onClick={openWindowsDialog}>
              {t('env.openWindows')}
            </Button>
          </>
        }
      />
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {String(error)}
        </Alert>
      ) : null}
      {isLoading || !data ? (
        [0, 1].map((i) => <Skeleton key={i} variant="rounded" height={180} sx={{ mb: 3 }} />)
      ) : (
        <>
          <PathEditor entries={data.user_path} systemEntries={data.system_path} onSaved={reload} />

          <Section
            title={t('env.userVars')}
            action={
              <Button size="small" startIcon={<Add />} onClick={() => setDialog({ open: true, initial: null })}>
                {t('env.newVar')}
              </Button>
            }
          >
            {data.user.length === 0 && <Row label={t('env.noVars')} />}
            {data.user.map((v) => (
              <Row
                key={v.name}
                label={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>{v.name}</Box>}
                description={<SecretValue name={v.name} value={v.value} />}
                control={
                  <>
                    <Tooltip title={t('proxy.edit')}>
                      <IconButton size="small" onClick={() => setDialog({ open: true, initial: v })}>
                        <EditOutlined />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('devtools.remove')}>
                      <IconButton size="small" color="error" onClick={() => remove(v)}>
                        <DeleteOutline />
                      </IconButton>
                    </Tooltip>
                  </>
                }
              />
            ))}
          </Section>

          <Section
            title={t('env.systemVars')}
            action={
              <Button size="small" onClick={() => setShowSystem(!showSystem)}>
                {showSystem ? t('env.hide') : t('env.show')}
              </Button>
            }
          >
            <Row label={t('env.systemReadOnly')} description={t('env.systemReadOnlyHint')} />
            {showSystem && (
              <>
                {data.system.map((v) => (
                  <Row
                    key={v.name}
                    label={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem' }}>{v.name}</Box>}
                    description={<SecretValue name={v.name} value={v.value} />}
                  />
                ))}
                <Box sx={{ px: 2.5, py: 2 }}>
                  <Typography variant="body1" fontWeight={500}>
                    Path
                  </Typography>
                  {data.system_path.map((p, i) => (
                    <Box key={`${p.value}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      <Box sx={{ ...mono, flex: 1 }}>{p.value}</Box>
                      {!p.exists && <Chip label={t('env.missing')} color="warning" />}
                    </Box>
                  ))}
                </Box>
              </>
            )}
          </Section>

          <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 0.25 }}>
            {t('env.restartNote')}
            <br />
            {t('env.backups')}: <Box component="span" sx={{ fontFamily: FONT_MONO }}>{data.backup_dir}</Box>
          </Typography>
        </>
      )}

      <VarDialog
        open={dialog.open}
        initial={dialog.initial}
        existing={(data?.user ?? []).map((v) => v.name.toLowerCase())}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onSave={(name, value) => saveVar(name, value)}
      />
    </Box>
  )
}

export default EnvPage
