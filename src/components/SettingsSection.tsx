import { Box, Paper, Typography } from '@mui/material'
import { ReactNode } from 'react'

/** A titled card whose children are separated by hairlines (settings-style rows). */
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, px: 0.25, minHeight: 28 }}>
        <Typography variant="subtitle1">{title}</Typography>
        {action}
      </Box>
      <Paper
        variant="outlined"
        sx={(theme) => ({
          overflow: 'hidden',
          boxShadow: `0 1px 2px rgba(0,0,0,.05), ${theme.tokens.edge}`,
          '& > * + *': { borderTop: `1px solid ${theme.tokens.border}` },
        })}
      >
        {children}
      </Paper>
    </Box>
  )
}

/** Label and description on the left, a control on the right. */
export function Row({
  label,
  description,
  control,
  leading,
}: {
  label: ReactNode
  description?: ReactNode
  control?: ReactNode
  leading?: ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, px: 2.5, py: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        {leading}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body1" fontWeight={500} component="div">
            {label}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
              {description}
            </Typography>
          )}
        </Box>
      </Box>
      {control && <Box sx={{ flexShrink: 0, display: 'flex', gap: 1, alignItems: 'center' }}>{control}</Box>}
    </Box>
  )
}
