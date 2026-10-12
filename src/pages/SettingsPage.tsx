import { Box, Button, Chip, Switch, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { ContrastOutlined, DarkModeOutlined, LightModeOutlined, FolderOpenOutlined } from '@mui/icons-material'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getVersion } from '@tauri-apps/api/app'
import { useThemeMode } from '../contexts/ThemeContext'
import { useToast, errorMessage } from '../contexts/ToastContext'
import PageHeader from '../components/PageHeader'
import { Section, Row } from '../components/SettingsSection'
import { FONT_MONO } from '../theme'
import { useDevTools, IS_WINDOWS } from '../lib/devtools'
import type { DevTools } from '../api/tauri'
import { openConfigDir, loadSettings, saveSettings, type AppSettings } from '../api/tauri'

function SettingsPage() {
  const [autoBackup, setAutoBackup] = useState(true)
  const [backupLimit, setBackupLimit] = useState(10)
  const [confirmDelete, setConfirmDelete] = useState(true)
  const [showGithub, setShowGithub] = useState(true)
  const [devPages, setDevPages] = useState({
    show_npm: false,
    show_docker: false,
    show_pip: false,
    show_rust: false,
    show_go: false,
    show_env: false,
    show_wsl: false,
    show_codex: false,
    show_claude: false,
  })
  const [showProxy, setShowProxy] = useState(true)
  const { data: devTools } = useDevTools()
  const queryClient = useQueryClient()
  const { themeMode, setThemeMode } = useThemeMode()
  const toast = useToast()
  const { t, i18n } = useTranslation()

  const { data: version } = useQuery({ queryKey: ['appVersion'], queryFn: getVersion, staleTime: Infinity })

  useEffect(() => {
    loadSettings()
      .then((settings) => {
        setAutoBackup(settings.auto_backup)
        setBackupLimit(settings.backup_limit)
        setConfirmDelete(settings.confirm_delete)
        setShowGithub(settings.show_github ?? true)
        setShowProxy(settings.show_proxy ?? true)
        setDevPages({
          show_npm: !!settings.show_npm,
          show_docker: !!settings.show_docker,
          show_pip: !!settings.show_pip,
          show_rust: !!settings.show_rust,
          show_go: !!settings.show_go,
          show_env: !!settings.show_env,
          show_wsl: !!settings.show_wsl,
          show_codex: !!settings.show_codex,
          show_claude: !!settings.show_claude,
        })
      })
      .catch((error) => {
        console.error('Failed to load settings:', error)
      })
  }, [])

  const handleSaveSettings = async (updates: Partial<AppSettings>) => {
    const newSettings: AppSettings = {
      auto_backup: autoBackup,
      backup_limit: backupLimit,
      confirm_delete: confirmDelete,
      show_github: showGithub,
      show_proxy: showProxy,
      ...devPages,
      ...updates,
    }

    try {
      await saveSettings(newSettings)
      queryClient.setQueryData(['settings'], newSettings)
    } catch (error) {
      toast(`${t('settings.saveFailed')}: ${errorMessage(error)}`, 'error')
    }
  }

  const handleOpenConfigDir = async () => {
    try {
      await openConfigDir()
    } catch (error) {
      toast(`${t('settings.openDirFailed')}: ${errorMessage(error)}`, 'error')
    }
  }

  return (
    <Box sx={{ maxWidth: 760 }}>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />

      <Section title={t('settings.appearance')}>
        <Row
          label={t('settings.themeMode')}
          description={t('settings.themeModeHelp')}
          control={
            <ToggleButtonGroup
              exclusive
              value={themeMode}
              onChange={(_, value) => value && setThemeMode(value)}
            >
              <ToggleButton value="system">
                <ContrastOutlined />
                {t('settings.themeSystem')}
              </ToggleButton>
              <ToggleButton value="light">
                <LightModeOutlined />
                {t('settings.themeLight')}
              </ToggleButton>
              <ToggleButton value="dark">
                <DarkModeOutlined />
                {t('settings.themeDark')}
              </ToggleButton>
            </ToggleButtonGroup>
          }
        />
        <Row
          label={t('settings.language')}
          description={t('settings.languageHelp')}
          control={
            <ToggleButtonGroup
              exclusive
              value={i18n.language}
              onChange={(_, value) => value && i18n.changeLanguage(value)}
            >
              <ToggleButton value="zh-CN">{t('settings.languageChinese')}</ToggleButton>
              <ToggleButton value="en-US">{t('settings.languageEnglish')}</ToggleButton>
            </ToggleButtonGroup>
          }
        />
      </Section>

      <Section title={t('settings.backupSettings')}>
        <Row
          label={t('settings.autoBackup')}
          description={t('settings.autoBackupHelp')}
          control={
            <Switch
              checked={autoBackup}
              onChange={(e) => {
                const newValue = e.target.checked
                setAutoBackup(newValue)
                handleSaveSettings({ auto_backup: newValue })
              }}
            />
          }
        />
        <Row
          label={t('settings.maxBackups')}
          description={t('settings.maxBackupsHelp')}
          control={
            <TextField
              type="number"
              value={backupLimit}
              onChange={(e) => setBackupLimit(parseInt(e.target.value))}
              onBlur={() => handleSaveSettings({ backup_limit: backupLimit })}
              inputProps={{ min: 1, max: 50 }}
              sx={{ width: 88 }}
            />
          }
        />
      </Section>

      <Section title={t('settings.editorSettings')}>
        <Row
          label={t('settings.confirmDelete')}
          description={t('settings.confirmDeleteHelp')}
          control={
            <Switch
              checked={confirmDelete}
              onChange={(e) => {
                const newValue = e.target.checked
                setConfirmDelete(newValue)
                handleSaveSettings({ confirm_delete: newValue })
              }}
            />
          }
        />
      </Section>

      <Section title={t('settings.advanced')}>
        <Row
          label={t('settings.showGithub')}
          description={t('settings.showGithubHelp')}
          control={
            <Switch
              checked={showGithub}
              onChange={(e) => {
                const newValue = e.target.checked
                setShowGithub(newValue)
                handleSaveSettings({ show_github: newValue })
              }}
            />
          }
        />
        <Row
          label={t('settings.showProxy')}
          description={t('settings.showProxyHelp')}
          control={
            <Switch
              checked={showProxy}
              onChange={(e) => {
                setShowProxy(e.target.checked)
                handleSaveSettings({ show_proxy: e.target.checked })
              }}
            />
          }
        />
        {(
          [
            ['show_env', null, t('menu.env'), true],
            ['show_wsl', 'wsl', 'WSL', true],
            ['show_npm', 'npm', 'npm', false],
            ['show_docker', 'docker', 'Docker', false],
            ['show_pip', 'python', 'Python (pip)', false],
            ['show_rust', 'rust', 'Rust (Cargo, rustup)', false],
            ['show_go', 'go', 'Go', false],
            ['show_codex', 'codex', 'Codex CLI', false],
            ['show_claude', 'claude', 'Claude Code', false],
          ] as [keyof typeof devPages, keyof DevTools | null, string, boolean][]
        )
          .filter(([, , , windowsOnly]) => IS_WINDOWS || !windowsOnly)
          .map(([key, tool, name]) => {
            const installed = tool ? devTools?.[tool].installed : undefined
            return (
              <Row
                key={key}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {t('settings.showTool', { name })}
                    {devTools && tool && (
                      <Chip
                        label={installed ? t('devtools.installed') : t('devtools.notInstalledShort')}
                        color={installed ? 'success' : 'default'}
                      />
                    )}
                  </Box>
                }
                description={t(`settings.${key}Help`)}
                control={
                  <Switch
                    checked={devPages[key]}
                    onChange={(e) => {
                      const next = { ...devPages, [key]: e.target.checked }
                      setDevPages(next)
                      handleSaveSettings(next)
                    }}
                  />
                }
              />
            )
          })}
      </Section>

      <Section title={t('settings.about')}>
        <Row label={t('settings.aboutDescription')} description={`${t('settings.version')} ${version ?? '—'}`} />
        <Row
          label={t('settings.paths')}
          description={
            <Box component="span" sx={{ display: 'block', fontFamily: FONT_MONO, fontSize: '0.75rem', lineHeight: 1.8 }}>
              {t('settings.sshConfigLocation')}: ~/.ssh/config
              <br />
              {t('settings.backupLocation')}: ~/.ssh-at/backups/
            </Box>
          }
          control={
            <Button size="small" startIcon={<FolderOpenOutlined />} onClick={handleOpenConfigDir}>
              {t('settings.openConfigDir')}
            </Button>
          }
        />
      </Section>
    </Box>
  )
}

export default SettingsPage
