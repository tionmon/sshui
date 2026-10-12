import {
  Autocomplete,
  Box,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListSubheader,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { Visibility, VisibilityOff } from '@mui/icons-material'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { clone, getIn, isGroupType, type Obj } from '../../lib/singbox/doc'
import { isValidPort, readField, writeField, type FieldDef } from '../../lib/singbox/protocols'
import type { RefSite } from '../../lib/singbox/refs'
import type { Problem } from '../../lib/singbox/validate'
import { FONT_MONO } from '../../theme'

export const mono = { spellCheck: false, style: { fontFamily: FONT_MONO } }

/** A friendly label for a sing-box field path, falling back to the key itself. */
export const fieldLabel = (t: TFunction, path: string) => {
  const key = path.replace(/^peers\.0\./, 'peer_').replace(/\./g, '_')
  return t(`singbox.fields.${key}`, { defaultValue: path.split('.').pop() })
}

export function siteLabel(t: TFunction, site: RefSite): string {
  switch (site.at) {
    case 'member':
      return t('singbox.site.member', { group: site.group })
    case 'default':
      return t('singbox.site.default', { group: site.group })
    case 'detour':
      return t('singbox.site.detour', { node: site.owner })
    case 'rule':
      return t('singbox.site.rule', { n: site.index + 1 })
    case 'final':
      return t('singbox.site.final')
    case 'download':
      return t('singbox.site.download', { ruleSet: site.ruleSet })
    case 'dnsServer':
      return t('singbox.site.dnsServer', { server: site.server })
    case 'dnsRule':
      return t('singbox.site.dnsRule', { n: site.index + 1 })
    case 'other':
      return site.path
  }
}

export const problemText = (t: TFunction, p: Problem) =>
  t(`singbox.problems.${p.code}`, p.params) + (p.site ? ` (${siteLabel(t, p.site)})` : '')

/** Chips for a list of strings, typed or pasted (comma or newline separated). */
export function ListInput({
  label,
  value,
  onChange,
  placeholder,
  options = [],
  helperText,
  error,
  monospace = true,
}: {
  label: ReactNode
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  options?: string[]
  helperText?: ReactNode
  error?: boolean
  monospace?: boolean
}) {
  const [input, setInput] = useState('')
  const commit = (text: string) => {
    const items = text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (items.length) onChange([...new Set([...value, ...items])])
    setInput('')
  }
  return (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={value}
      inputValue={input}
      onInputChange={(_, v, reason) => {
        if (reason === 'input' && /[\n,]/.test(v)) commit(v)
        else if (reason !== 'reset') setInput(v)
      }}
      onChange={(_, v) => onChange((v as string[]).map((s) => s.trim()).filter(Boolean))}
      onBlur={() => input.trim() && commit(input)}
      renderTags={(items, getTagProps) =>
        items.map((item, index) => {
          const { key, ...props } = getTagProps({ index })
          return <Chip key={key} label={item} {...props} sx={monospace ? { fontFamily: FONT_MONO } : undefined} />
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length ? undefined : placeholder}
          helperText={helperText}
          error={error}
          inputProps={{ ...params.inputProps, spellCheck: false }}
        />
      )}
    />
  )
}

export interface OutboundOption {
  tag: string
  type: string
  disabled?: boolean
  /** Shown after the tag, e.g. why it's disabled */
  note?: string
}

/** Pick an outbound by tag. `emptyLabel` adds a "none" choice. */
export function OutboundSelect({
  label,
  value,
  onChange,
  options,
  emptyLabel,
  helperText,
  error,
}: {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  options: OutboundOption[]
  emptyLabel?: string
  helperText?: ReactNode
  error?: boolean
}) {
  const { t } = useTranslation()
  const groups = options.filter((o) => isGroupType(o.type))
  const nodes = options.filter((o) => !isGroupType(o.type))
  const missing = value && !options.some((o) => o.tag === value)
  const item = (o: OutboundOption) => (
    <MenuItem key={o.tag} value={o.tag} disabled={o.disabled}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, width: '100%' }}>
        <Typography noWrap sx={{ fontSize: '0.875rem' }}>
          {o.tag}
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', flexShrink: 0 }}>{o.note ?? o.type}</Typography>
      </Box>
    </MenuItem>
  )
  return (
    <TextField
      select
      fullWidth
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText={helperText}
      error={error || !!missing}
      SelectProps={{ displayEmpty: emptyLabel !== undefined, MenuProps: { PaperProps: { sx: { maxHeight: 420 } } } }}
    >
      {emptyLabel !== undefined && (
        <MenuItem value="">
          <em>{emptyLabel}</em>
        </MenuItem>
      )}
      {missing && (
        <MenuItem value={value} disabled>
          {value} — {t('singbox.missing')}
        </MenuItem>
      )}
      {groups.length > 0 && <ListSubheader>{t('singbox.tabGroups')}</ListSubheader>}
      {groups.map(item)}
      {nodes.length > 0 && <ListSubheader>{t('singbox.tabNodes')}</ListSubheader>}
      {nodes.map(item)}
    </TextField>
  )
}

function SecretField({ label, value, onChange, required, error, placeholder }: {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  required?: boolean
  error?: boolean
  placeholder?: string
}) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  return (
    <TextField
      label={label}
      value={value}
      required={required}
      error={error}
      placeholder={placeholder}
      type={show ? 'text' : 'password'}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      inputProps={mono}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton size="small" onClick={() => setShow(!show)} aria-label={show ? t('singbox.hideSecret') : t('singbox.showSecret')} edge="end">
              {show ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  )
}

/** Form fields bound to paths in `value`; `onChange` gets an updated copy. */
export function FieldGrid({
  fields,
  value,
  onChange,
  touched,
}: {
  fields: FieldDef[]
  value: Obj
  onChange: (next: Obj) => void
  touched?: boolean
}) {
  const { t } = useTranslation()
  const set = (field: FieldDef, v: unknown) => {
    const next = clone(value)
    writeField(next, field, v)
    onChange(next)
  }
  if (fields.length === 0) return null
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, '& .MuiFormControl-root': { width: '100%' } }}>
      {fields.map((f) => {
        const raw = readField(value, f)
        const label = fieldLabel(t, f.path)
        const empty = raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)
        const requiredError = !!touched && !!f.required && empty
        const sx = { gridColumn: f.full || f.kind === 'list' ? '1 / -1' : undefined, minWidth: 0 }
        let control: ReactNode
        switch (f.kind) {
          case 'bool':
            control = (
              <FormControlLabel
                control={<Switch checked={!!raw} onChange={(e) => set(f, e.target.checked)} />}
                label={label}
                sx={{ ml: 0, gap: 1 }}
              />
            )
            break
          case 'select':
            control = (
              <TextField select label={label} value={raw ?? ''} required={f.required} error={requiredError} onChange={(e) => set(f, e.target.value)} SelectProps={{ displayEmpty: !f.required }}>
                {!f.required && (
                  <MenuItem value="">
                    <em>{t('singbox.defaultValue')}</em>
                  </MenuItem>
                )}
                {raw !== undefined && raw !== '' && !f.options?.includes(String(raw)) && <MenuItem value={String(raw)}>{String(raw)}</MenuItem>}
                {f.options?.map((o) => (
                  <MenuItem key={o} value={o}>
                    {o}
                  </MenuItem>
                ))}
              </TextField>
            )
            break
          case 'list':
            control = (
              <ListInput
                label={label}
                value={Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : []}
                onChange={(v) => set(f, v)}
                placeholder={f.placeholder}
                error={requiredError}
              />
            )
            break
          case 'secret':
            control = (
              <SecretField
                label={label}
                value={raw === undefined ? '' : String(raw)}
                onChange={(v) => set(f, v)}
                required={f.required}
                error={requiredError}
                placeholder={f.placeholder}
              />
            )
            break
          default: {
            const numeric = f.kind === 'number' || f.kind === 'port'
            const portError = f.kind === 'port' && !empty && !isValidPort(raw)
            control = (
              <TextField
                label={label}
                value={raw === undefined ? '' : String(raw)}
                required={f.required}
                error={requiredError || portError}
                helperText={portError ? t('singbox.badPort') : undefined}
                placeholder={f.placeholder}
                onChange={(e) => set(f, numeric ? e.target.value.replace(/[^\d]/g, '') : e.target.value)}
                inputProps={{ ...mono, inputMode: numeric ? 'numeric' : undefined }}
              />
            )
          }
        }
        return (
          <Box key={f.path} sx={sx}>
            {control}
          </Box>
        )
      })}
    </Box>
  )
}

/** A small titled block inside a dialog. */
export function FormSection({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25, minHeight: 28 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  )
}

export const hasValue = (obj: Obj, path: string) => getIn(obj, path) !== undefined
