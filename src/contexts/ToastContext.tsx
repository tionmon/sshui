import { createContext, useCallback, useContext, useState, ReactNode } from 'react'
import { Box, Snackbar, SnackbarContent } from '@mui/material'
import { CheckCircleOutline, ErrorOutline, InfoOutlined, WarningAmber } from '@mui/icons-material'
import { useTheme } from '@mui/material/styles'

type ToastKind = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

type ToastFn = (message: string, kind?: ToastKind) => void

const ToastContext = createContext<ToastFn | undefined>(undefined)

export const useToast = () => {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const icons = {
  success: CheckCircleOutline,
  error: ErrorOutline,
  info: InfoOutlined,
  warning: WarningAmber,
}

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toast, setToast] = useState<Toast | null>(null)
  const [open, setOpen] = useState(false)
  const { tokens } = useTheme()

  const show = useCallback<ToastFn>((message, kind = 'success') => {
    setToast({ id: Date.now(), kind, message })
    setOpen(true)
  }, [])

  const colors = {
    success: tokens.successForeground,
    error: tokens.destructiveForeground,
    info: tokens.infoForeground,
    warning: tokens.warningForeground,
  }
  const Icon = toast ? icons[toast.kind] : null

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar
        key={toast?.id}
        open={open}
        autoHideDuration={toast?.kind === 'error' ? 6000 : 3000}
        onClose={(_, reason) => reason !== 'clickaway' && setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <SnackbarContent
          message={
            toast && Icon && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Icon sx={{ fontSize: 16, color: colors[toast.kind] }} />
                <span>{toast.message}</span>
              </Box>
            )
          }
        />
      </Snackbar>
    </ToastContext.Provider>
  )
}
