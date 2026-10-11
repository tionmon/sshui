import { Box, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography } from '@mui/material'
import {
  DnsOutlined,
  VpnKeyOutlined,
  HistoryOutlined,
  SettingsOutlined,
  DataObjectOutlined,
  LanOutlined,
  GitHub,
  TerminalRounded,
  LightModeOutlined,
  DarkModeOutlined,
  ContrastOutlined,
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

function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { themeMode, toggleTheme } = useThemeMode()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: loadSettings })
  const showGithub = settings?.show_github ?? true

  const menuItems = [
    { text: t('menu.hosts'), icon: <DnsOutlined />, path: '/' },
    { text: t('menu.sshKeys'), icon: <VpnKeyOutlined />, path: '/keys' },
    { text: t('menu.configEditor'), icon: <DataObjectOutlined />, path: '/editor' },
    { text: t('menu.hostsFile'), icon: <LanOutlined />, path: '/hosts-file' },
    ...(showGithub ? [{ text: 'GitHub', icon: <GitHub />, path: '/github' }] : []),
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

        <Typography
          sx={(theme) => ({
            px: 1,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: theme.tokens.sidebarForeground,
          })}
        >
          {t('menu.groupManage')}
        </Typography>
        <List disablePadding sx={{ flex: 1, overflow: 'auto' }}>
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
            <Route path="/backups" element={<BackupsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  )
}

export default Layout
