import { Alert, Box, Button, Chip, Paper, Skeleton } from '@mui/material'
import { Save, Undo } from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Editor from '@monaco-editor/react'
import { useThemeMode } from '../contexts/ThemeContext'
import { useToast } from '../contexts/ToastContext'
import PageHeader from '../components/PageHeader'
import { setupMonaco, editorTheme, editorOptions } from '../lib/monaco'
import { loadSshConfig, serializeSshConfig, parseSshConfig, saveSshConfig } from '../api/tauri'

function ConfigEditorPage() {
  const [content, setContent] = useState('')
  const [hasChanges, setHasChanges] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  const { mode } = useThemeMode()
  const { t } = useTranslation()

  const { data: config, isLoading, error } = useQuery({
    queryKey: ['sshConfig'],
    queryFn: loadSshConfig,
  })

  const serializeMutation = useMutation({
    mutationFn: serializeSshConfig,
    onSuccess: (text) => {
      setContent(text)
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (text: string) => {
      const parsed = await parseSshConfig(text)
      await saveSshConfig(parsed)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sshConfig'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      setHasChanges(false)
      setParseError(null)
      toast(t('config.saved'))
    },
    onError: (err) => {
      setParseError(err instanceof Error ? err.message : String(err))
    },
  })

  useEffect(() => {
    if (config) {
      serializeMutation.mutate(config)
    }
  }, [config])

  const handleSave = () => {
    saveMutation.mutate(content)
  }

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['sshConfig'] })
    setHasChanges(false)
    setParseError(null)
  }

  const handleEditorChange = (value: string | undefined) => {
    setContent(value || '')
    setHasChanges(true)
    setParseError(null)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      <PageHeader
        title={t('config.title')}
        description={t('config.infoMessage')}
        meta={hasChanges && <Chip label={t('config.unsaved')} color="warning" />}
        actions={
          <>
            <Button startIcon={<Undo />} onClick={handleRefresh} disabled={!hasChanges}>
              {t('config.reset')}
            </Button>
            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? t('config.saving') : t('config.save')}
            </Button>
          </>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('config.loadError')}: {(error as Error).message}
        </Alert>
      )}

      {parseError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('config.parseError')}: {parseError}
        </Alert>
      )}

      <Paper
        variant="outlined"
        sx={(theme) => ({
          flex: 1,
          minHeight: 320,
          overflow: 'hidden',
          py: 1.5,
          bgcolor: theme.tokens.card,
          boxShadow: `0 1px 2px rgba(0,0,0,.05), ${theme.tokens.edge}`,
        })}
      >
        {isLoading ? (
          <Box sx={{ px: 3 }}>
            {[220, 160, 260, 140, 200].map((w, i) => (
              <Skeleton key={i} width={w} height={18} sx={{ mb: 1 }} />
            ))}
          </Box>
        ) : (
          <Editor
            height="100%"
            defaultLanguage="ini"
            theme={editorTheme(mode)}
            beforeMount={setupMonaco}
            value={content}
            onChange={handleEditorChange}
            options={editorOptions}
          />
        )}
      </Paper>
    </Box>
  )
}

export default ConfigEditorPage
