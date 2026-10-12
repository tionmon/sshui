import { MenuItem, Select } from '@mui/material'
import { ReactNode } from 'react'
import { Row } from '../SettingsSection'

/** Option value meaning "not set": the tool's default applies. */
export const DEFAULT = '__default'

/** A setting with a few common values; the saved value is listed even when it isn't one of them. */
function ChoiceRow({
  label,
  description,
  value,
  options,
  onSave,
}: {
  label: ReactNode
  description: ReactNode
  value: string | null
  options: { value: string; label: string }[]
  onSave: (value: string | null) => void
}) {
  const all = value && !options.some((o) => o.value === value) ? [...options, { value, label: value }] : options
  return (
    <Row
      label={label}
      description={description}
      control={
        <Select
          size="small"
          value={value ?? DEFAULT}
          onChange={(e) => onSave(e.target.value === DEFAULT ? null : e.target.value)}
          sx={{ minWidth: 220 }}
        >
          {all.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </Select>
      }
    />
  )
}

export default ChoiceRow
