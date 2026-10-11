import { Box, Typography } from '@mui/material'
import { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        py: 8,
        px: 4,
        textAlign: 'center',
      }}
    >
      <Box
        sx={(theme) => ({
          width: 48,
          height: 48,
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: theme.tokens.muted,
          color: 'text.secondary',
          '& svg': { fontSize: 24 },
        })}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="subtitle1" sx={{ fontSize: '1rem' }}>
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 380 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  )
}

export default EmptyState
