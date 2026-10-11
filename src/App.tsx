import { CssBaseline } from '@mui/material'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { isTauri } from '@tauri-apps/api/core'
import { ThemeContextProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
import Layout from './components/Layout'
import BrowserNotice from './components/BrowserNotice'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeContextProvider>
        <CssBaseline />
        <ToastProvider>
          {isTauri() ? (
            <BrowserRouter>
              <Layout />
            </BrowserRouter>
          ) : (
            <BrowserNotice />
          )}
        </ToastProvider>
      </ThemeContextProvider>
    </QueryClientProvider>
  )
}

export default App
