import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react'
import { ThemeProvider } from '@mui/material/styles'
import { buildTheme } from '../theme'
import { PaletteMode } from '@mui/material'

type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeContextType {
  mode: PaletteMode
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const useThemeMode = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useThemeMode must be used within ThemeContextProvider')
  }
  return context
}

interface ThemeContextProviderProps {
  children: ReactNode
}

export const ThemeContextProvider = ({ children }: ThemeContextProviderProps) => {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('themeMode')
    return (saved as ThemeMode) || 'system'
  })

  const [mode, setMode] = useState<PaletteMode>(() => {
    if (themeMode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return themeMode as PaletteMode
  })

  useEffect(() => {
    localStorage.setItem('themeMode', themeMode)

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const updateMode = (e: MediaQueryListEvent) => {
        setMode(e.matches ? 'dark' : 'light')
      }

      setMode(mediaQuery.matches ? 'dark' : 'light')
      mediaQuery.addEventListener('change', updateMode)

      return () => mediaQuery.removeEventListener('change', updateMode)
    } else {
      setMode(themeMode as PaletteMode)
    }
  }, [themeMode])

  const toggleTheme = () => {
    if (themeMode === 'system') {
      setThemeMode('light')
    } else if (themeMode === 'light') {
      setThemeMode('dark')
    } else {
      setThemeMode('system')
    }
  }

  const theme = useMemo(() => buildTheme(mode), [mode])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = mode
    root.style.colorScheme = mode
  }, [mode])

  return (
    <ThemeContext.Provider value={{ mode, themeMode, setThemeMode, toggleTheme }}>
      <ThemeProvider theme={theme}>
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  )
}
