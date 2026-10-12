import { Box, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography } from '@mui/material'
import {
  DnsOutlined,
  VpnKeyOutlined,
  HistoryOutlined,
  SettingsOutlined,
  DataObjectOutlined,
  LanOutlined,
  GitHub,
  Inventory2Outlined,
  ViewInArOutlined,
  IntegrationInstructionsOutlined,
  TerminalRounded,
  LightModeOutlined,
  DarkModeOutlined,
  ContrastOutlined,
  RouterOutlined,
  TuneOutlined,
  PrecisionManufacturingOutlined,
  CodeOutlined,
  TerminalOutlined,
} from '@mui/icons-material'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { loadSettings } from '../api/tauri'
import { useThemeMode } from '../contexts/ThemeContext'
import HostsPage from '../pages/HostsPage'
import KeysPage from '../pages/KeysPage'
import BackupsPage from '../pages/BackupsPage'
import SettingsPage from '../pages/SettingsPage'
import ConfigEditorPage from '../pages/ConfigEditorPage'
import HostsFilePage from '../pages/HostsFilePage'
import GithubPage from '../pages/GithubPage'
import NpmPage from '../pages/NpmPage'
import DockerPage from '../pages/DockerPage'
import PipPage from '../pages/PipPage'
import ProxyPage from '../pages/ProxyPage'
import EnvPage from '../pages/EnvPage'
import RustPage from '../pages/RustPage'
import GoPage from '../pages/GoPage'
import WslPage from '../pages/WslPage'
import { IS_WINDOWS } from '../lib/devtools'

const sidebarWidth = 232

interface NavItemProps {
  icon: ReactNode
  label: string
  active: boolean
  onClick: () => void
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <ListItemButton
      selected={active}
      onClick={onClick}
      sx={(theme) => ({
        height: 32,
        px: 1,
        gap: 1,
        mb: 0.25,
        color: active ? theme.tokens.foreground : theme.tokens.sidebarForeground,
        '&:hover': { color: theme.tokens.foreground },
      })}
    >
      <ListItemIcon sx={{ minWidth: 0, color: 'inherit', '& svg': { fontSize: 17 } }}>{icon}</ListItemIcon>
      <ListItemText
        primary={label}
        primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: active ? 500 : 400, noWrap: true }}
      />
    </ListItemButton>
  )
}

function GroupLabel({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Typography
      sx={(theme) => ({
        px: 1,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        fontSize: '0.75rem',
        fontWeight: 500,
        color: theme.tokens.sidebarForeground,
        ...sx,
      })}
    >
      {children}
    </Typography>
  )
}

function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { themeMode, toggleTheme } = useThemeMode()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: loadSettings })
  const showGithub = settings?.show_github ?? true

  const devItems = [
    { text: 'GitHub', icon: <GitHub />, path: '/github', show: showGithub },
    { text: 'npm', icon: <Inventory2Outlined />, path: '/npm', show: !!settings?.show_npm },
    { text: 'Docker', icon: <ViewInArOutlined />, path: '/docker', show: !!settings?.show_docker },
    { text: 'Python', icon: <IntegrationInstructionsOutlined />, path: '/pip', show: !!settings?.show_pip },
    { text: 'Rust', icon: <PrecisionManufacturingOutlined />, path: '/rust', show: !!settings?.show_rust },
    { text: 'Go', icon: <CodeOutlined />, path: '/go', show: !!settings?.show_go },
  ].filter((item) => item.show)

  const systemItems = [
    { text: t('menu.proxy'), icon: <RouterOutlined />, path: '/proxy', show: settings?.show_proxy ?? true },
    { text: t('menu.env'), icon: <TuneOutlined />, path: '/env', show: IS_WINDOWS && !!settings?.show_env },
    { text: 'WSL', icon: <TerminalOutlined />, path: '/wsl', show: IS_WINDOWS && !!settings?.show_wsl },
  ].filter((item) => item.show)

  const menuItems = [
    { text: t('menu.hosts'), icon: <DnsOutlined />, path: '/' },
    { text: t('menu.sshKeys'), icon: <VpnKeyOutlined />, path: '/keys' },
    { text: t('menu.configEditor'), icon: <DataObjectOutlined />, path: '/editor' },
    { text: t('menu.hostsFile'), icon: <LanOutlined />, path: '/hosts-file' },
    { text: t('menu.backups'), icon: <HistoryOutlined />, path: '/backups' },
  ]

  const themeIcon =
    themeMode === 'light' ? <LightModeOutlined /> : themeMode === 'dark' ? <DarkModeOutlined /> : <ContrastOutlined />
  const themeLabel =
    themeMode === 'light' ? t('common.themeLight') : themeMode === 'dark' ? t('common.themeDark') : t('common.themeSystem')

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="nav"
        sx={(theme) => ({
          width: sidebarWidth,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: theme.tokens.sidebar,
          borderRight: `1px solid ${theme.tokens.sidebarBorder}`,
          px: 1,
          py: 1.5,
        })}
      >
        {/* Brand */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 32, px: 1, mb: 2 }}>
          <Box
            sx={(theme) => ({
              width: 24,
              height: 24,
              borderRadius: '7px',
              bgcolor: theme.tokens.primary,
              color: theme.tokens.primaryForeground,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)',
            })}
          >
            <TerminalRounded sx={{ fontSize: 16 }} />
          </Box>
          <Typography sx={{ fontWeight: 600, fontSize: '0.9375rem', letterSpacing: '-0.01em' }}>
            {t('common.appName')}
          </Typography>
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <GroupLabel>{t('menu.groupManage')}</GroupLabel>
          <List disablePadding>
            {menuItems.map((item) => (
              <NavItem
                key={item.path}
                icon={item.icon}
                label={item.text}
                active={location.pathname === item.path}
                onClick={() => navigate(item.path)}
              />
            ))}
          </List>
          {(
            [
              [t('menu.groupSystem'), systemItems],
              [t('menu.groupDeveloper'), devItems],
            ] as const
          ).map(
            ([label, items]) =>
              items.length > 0 && (
                <Box key={label}>
                  <GroupLabel sx={{ mt: 1.5 }}>{label}</GroupLabel>
                  <List disablePadding>
                    {items.map((item) => (
                      <NavItem
                        key={item.path}
                        icon={item.icon}
                        label={item.text}
                        active={location.pathname === item.path}
                        onClick={() => navigate(item.path)}
                      />
                    ))}
                  </List>
                </Box>
              ),
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <NavItem
              icon={<SettingsOutlined />}
              label={t('menu.settings')}
              active={location.pathname === '/settings'}
              onClick={() => navigate('/settings')}
            />
          </Box>
          <Tooltip title={`${t('common.toggleTheme')} · ${themeLabel}`} placement="top">
            <IconButton size="small" onClick={toggleTheme} aria-label={t('common.toggleTheme')} sx={{ mb: 0.25 }}>
              {themeIcon}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, overflow: 'auto' }}>
        <Box sx={{ maxWidth: 1120, mx: 'auto', px: 4, py: 3.5 }}>
          <Routes>
            <Route path="/" element={<HostsPage />} />
            <Route path="/keys" element={<KeysPage />} />
            <Route path="/editor" element={<ConfigEditorPage />} />
            <Route path="/hosts-file" element={<HostsFilePage />} />
            <Route path="/github" element={<GithubPage />} />
            <Route path="/npm" element={<NpmPage />} />
            <Route path="/docker" element={<DockerPage />} />
            <Route path="/pip" element={<PipPage />} />
            <Route path="/rust" element={<RustPage />} />
            <Route path="/go" element={<GoPage />} />
            <Route path="/proxy" element={<ProxyPage />} />
            <Route path="/env" element={<EnvPage />} />
            <Route path="/wsl" element={<WslPage />} />
            <Route path="/backups" element={<BackupsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  )
}

export default Layout
