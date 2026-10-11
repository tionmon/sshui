import { alpha, createTheme, type PaletteMode, type Theme } from '@mui/material/styles'

// Design tokens modelled on the storageui palette: an achromatic neutral scale,
// hairline alpha borders and soft-tinted status colours.
export interface Tokens {
  background: string
  foreground: string
  card: string
  popover: string
  primary: string
  primaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  border: string
  input: string
  ring: string
  sidebar: string
  sidebarForeground: string
  sidebarAccent: string
  sidebarBorder: string
  surface: string
  codeHighlight: string
  selection: string
  selectionForeground: string
  destructive: string
  destructiveForeground: string
  info: string
  infoForeground: string
  success: string
  successForeground: string
  warning: string
  warningForeground: string
  // Inner 1px highlight drawn on raised surfaces (cards, dialogs, buttons)
  edge: string
}

export const lightTokens: Tokens = {
  background: '#ffffff',
  foreground: '#262626',
  card: '#ffffff',
  popover: '#ffffff',
  primary: '#262626',
  primaryForeground: '#fafafa',
  muted: 'rgba(0, 0, 0, 0.04)',
  mutedForeground: '#686868',
  accent: 'rgba(0, 0, 0, 0.04)',
  border: 'rgba(0, 0, 0, 0.08)',
  input: 'rgba(0, 0, 0, 0.10)',
  ring: '#a1a1a1',
  sidebar: '#fafafa',
  sidebarForeground: '#727272',
  sidebarAccent: 'rgba(0, 0, 0, 0.04)',
  sidebarBorder: 'rgba(0, 0, 0, 0.06)',
  surface: '#fafafa',
  codeHighlight: '#f5f5f5',
  selection: '#0a0a0a',
  selectionForeground: '#ffffff',
  destructive: '#fb2c36',
  destructiveForeground: '#c10007',
  info: '#2b7fff',
  infoForeground: '#1447e6',
  success: '#00bc7d',
  successForeground: '#007a55',
  warning: '#fe9a00',
  warningForeground: '#bb4d00',
  edge: '0 1px 0 rgba(0, 0, 0, 0.04)',
}

export const darkTokens: Tokens = {
  background: '#0a0a0a',
  foreground: '#f5f5f5',
  card: '#0f0f0f',
  popover: '#0f0f0f',
  primary: '#f5f5f5',
  primaryForeground: '#262626',
  muted: 'rgba(255, 255, 255, 0.04)',
  mutedForeground: '#818181',
  accent: 'rgba(255, 255, 255, 0.04)',
  border: 'rgba(255, 255, 255, 0.06)',
  input: 'rgba(255, 255, 255, 0.08)',
  ring: '#737373',
  sidebar: '#111111',
  sidebarForeground: '#a3a3a3',
  sidebarAccent: 'rgba(255, 255, 255, 0.04)',
  sidebarBorder: 'rgba(255, 255, 255, 0.05)',
  surface: '#171717',
  codeHighlight: '#262626',
  selection: '#e5e5e5',
  selectionForeground: '#171717',
  destructive: '#fc4149',
  destructiveForeground: '#ff6467',
  info: '#2b7fff',
  infoForeground: '#51a2ff',
  success: '#00bc7d',
  successForeground: '#00d492',
  warning: '#fe9a00',
  warningForeground: '#ffb900',
  edge: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
}

declare module '@mui/material/styles' {
  interface Theme {
    tokens: Tokens
  }
  interface ThemeOptions {
    tokens?: Tokens
  }
}

export const getTokens = (mode: PaletteMode): Tokens => (mode === 'dark' ? darkTokens : lightTokens)

const RADIUS = 10 // --radius: 0.625rem
export const radius = {
  sm: 6,
  md: 8,
  lg: RADIUS,
  xl: 14,
  '2xl': 18,
}

const FONT_SANS =
  '"Geist Variable", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
export const FONT_MONO =
  '"Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Consolas, monospace'

const shadowXs = '0 1px 2px rgba(0, 0, 0, 0.05)'
const shadowLg = '0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.05)'

// Soft-tinted badge styles (bg 8% light / 16% dark, coloured foreground)
export const softTint = (mode: PaletteMode, color: string, fg: string) => ({
  backgroundColor: alpha(color, mode === 'dark' ? 0.16 : 0.08),
  color: fg,
})

export function buildTheme(mode: PaletteMode): Theme {
  const t = getTokens(mode)
  const dark = mode === 'dark'
  const surfaceShadow = `${shadowXs}, ${t.edge}`
  const inputBg = dark ? alpha('#ffffff', 0.0256) : t.popover

  return createTheme({
    tokens: t,
    palette: {
      mode,
      primary: { main: t.primary, contrastText: t.primaryForeground },
      secondary: { main: t.mutedForeground, contrastText: t.background },
      error: { main: t.destructive, dark: t.destructiveForeground, contrastText: '#ffffff' },
      warning: { main: t.warning, dark: t.warningForeground, contrastText: '#ffffff' },
      info: { main: t.info, dark: t.infoForeground, contrastText: '#ffffff' },
      success: { main: t.success, dark: t.successForeground, contrastText: '#ffffff' },
      background: { default: t.background, paper: t.card },
      text: { primary: t.foreground, secondary: t.mutedForeground, disabled: alpha(t.foreground, 0.4) },
      divider: t.border,
      action: {
        hover: t.accent,
        selected: t.accent,
        active: t.mutedForeground,
        focus: t.accent,
      },
    },
    shape: { borderRadius: RADIUS },
    typography: {
      fontFamily: FONT_SANS,
      fontSize: 14,
      h4: { fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3 },
      h5: { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.01em' },
      h6: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.4 },
      subtitle1: { fontSize: '0.875rem', fontWeight: 600 },
      subtitle2: { fontSize: '0.8125rem', fontWeight: 500 },
      body1: { fontSize: '0.875rem', lineHeight: 1.5 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
      caption: { fontSize: '0.75rem', lineHeight: 1.4 },
      button: { fontSize: '0.875rem', fontWeight: 500, textTransform: 'none' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { overscrollBehaviorY: 'none' },
          body: {
            backgroundColor: t.background,
            textRendering: 'optimizeLegibility',
            fontSynthesisWeight: 'none',
          },
          '::selection': { backgroundColor: t.selection, color: t.selectionForeground },
          '*': { scrollbarWidth: 'thin', scrollbarColor: `${t.input} transparent` },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: t.input,
            borderRadius: 999,
            border: '3px solid transparent',
            backgroundClip: 'content-box',
          },
          '*::-webkit-scrollbar-thumb:hover': { backgroundColor: alpha(t.foreground, 0.24) },
          code: { fontFamily: FONT_MONO },
        },
      },

      // ── Surfaces ────────────────────────────────────────────────────────
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: radius['2xl'] },
          outlined: { borderColor: t.border },
        },
      },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: {
          root: {
            borderRadius: radius['2xl'],
            borderColor: t.border,
            backgroundColor: t.card,
            boxShadow: surfaceShadow,
          },
        },
      },
      MuiCardContent: {
        styleOverrides: { root: { padding: 20, '&:last-child': { paddingBottom: 20 } } },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: t.border } } },

      // ── Buttons ─────────────────────────────────────────────────────────
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiButton: {
        defaultProps: { disableElevation: true, variant: 'outlined', color: 'inherit' },
        styleOverrides: {
          root: {
            height: 32,
            minWidth: 0,
            padding: '0 11px',
            gap: 8,
            borderRadius: radius.lg,
            border: '1px solid transparent',
            fontWeight: 500,
            fontSize: '0.875rem',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            transition: 'background-color .15s, box-shadow .15s, border-color .15s',
            '&:focus-visible': { boxShadow: `0 0 0 2px ${t.background}, 0 0 0 4px ${t.ring}` },
            '&.Mui-disabled': { opacity: 0.64 },
            '&:active': { opacity: 0.85 },
          },
          startIcon: { margin: 0, '& > *:nth-of-type(1)': { fontSize: 16, opacity: 0.8 } },
          endIcon: { margin: 0, '& > *:nth-of-type(1)': { fontSize: 16, opacity: 0.8 } },
          sizeSmall: { height: 28, padding: '0 9px', gap: 6, fontSize: '0.8125rem' },
          sizeLarge: { height: 36, padding: '0 13px' },
          contained: {
            border: `1px solid ${t.primary}`,
            backgroundColor: t.primary,
            color: t.primaryForeground,
            boxShadow: `0 1px 2px ${alpha(t.primary, 0.24)}, inset 0 1px 0 rgba(255,255,255,0.16)`,
            '&:hover': { backgroundColor: alpha(t.primary, 0.9), boxShadow: `0 1px 2px ${alpha(t.primary, 0.24)}` },
            '&.Mui-disabled': { backgroundColor: t.primary, color: t.primaryForeground, boxShadow: 'none' },
          },
          containedError: {
            borderColor: t.destructive,
            backgroundColor: t.destructive,
            color: '#ffffff',
            '&:hover': { backgroundColor: alpha(t.destructive, 0.9) },
          },
          outlined: {
            borderColor: t.input,
            backgroundColor: inputBg,
            color: t.foreground,
            boxShadow: `${shadowXs}, ${t.edge}`,
            '&:hover': { borderColor: t.input, backgroundColor: dark ? alpha('#ffffff', 0.05) : alpha('#000000', 0.02) },
            '&.Mui-disabled': { borderColor: t.input, color: t.foreground, boxShadow: 'none' },
          },
          outlinedError: {
            color: t.destructiveForeground,
            '&:hover': { borderColor: alpha(t.destructive, 0.32), backgroundColor: alpha(t.destructive, 0.04) },
          },
          text: {
            color: t.foreground,
            '&:hover': { backgroundColor: t.accent },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: radius.lg,
            color: t.mutedForeground,
            transition: 'background-color .15s, color .15s',
            '&:hover': { backgroundColor: t.accent, color: t.foreground },
            '&:focus-visible': { boxShadow: `0 0 0 2px ${t.ring}` },
          },
          sizeSmall: { width: 28, height: 28, padding: 0, '& svg': { fontSize: 16 } },
          sizeMedium: { width: 32, height: 32, padding: 0, '& svg': { fontSize: 18 } },
          colorPrimary: { color: t.mutedForeground, '&:hover': { color: t.foreground } },
          colorError: {
            color: t.mutedForeground,
            '&:hover': { color: t.destructiveForeground, backgroundColor: alpha(t.destructive, 0.08) },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            gap: 2,
            padding: 2,
            borderRadius: radius.lg,
            backgroundColor: t.muted,
          },
          grouped: {
            border: 0,
            borderRadius: `${radius.md}px !important`,
            margin: '0 !important',
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            height: 28,
            padding: '0 12px',
            gap: 6,
            border: 0,
            textTransform: 'none',
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: alpha(t.mutedForeground, 0.9),
            '& svg': { fontSize: 16 },
            '&:hover': { backgroundColor: 'transparent', color: t.foreground },
            '&.Mui-selected, &.Mui-selected:hover': {
              color: t.foreground,
              backgroundColor: dark ? t.input : t.background,
              boxShadow: `0 1px 2px rgba(0,0,0,${dark ? 0.2 : 0.06})`,
            },
          },
        },
      },

      // ── Inputs ──────────────────────────────────────────────────────────
      // Labels sit above the field (storageui "Field" style) instead of floating.
      MuiTextField: { defaultProps: { variant: 'outlined', size: 'small' } },
      MuiFormControl: { defaultProps: { size: 'small' } },
      MuiInputLabel: {
        defaultProps: { shrink: true },
        styleOverrides: {
          root: {
            position: 'relative',
            transform: 'none',
            marginBottom: 6,
            fontSize: '0.8125rem',
            fontWeight: 500,
            lineHeight: 1.4,
            color: t.foreground,
            maxWidth: '100%',
            '&.Mui-focused': { color: t.foreground },
            '&.Mui-error': { color: t.destructiveForeground },
            '&.Mui-disabled': { color: t.mutedForeground },
          },
          asterisk: { color: t.destructiveForeground },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: t.foreground,
            '&.Mui-focused': { color: t.foreground },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: radius.lg,
            backgroundColor: inputBg,
            fontSize: '0.875rem',
            boxShadow: `${shadowXs}, ${t.edge}`,
            transition: 'box-shadow .15s, border-color .15s',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: t.input, top: 0 },
            '& .MuiOutlinedInput-notchedOutline legend': { display: 'none' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: t.input },
            '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(t.ring, 0.24)}` },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: t.ring, borderWidth: 1 },
            '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: alpha(t.destructive, 0.36) },
            '&.Mui-error.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(t.destructive, 0.16)}` },
            '&.Mui-disabled': { opacity: 0.64 },
          },
          input: {
            height: 20,
            padding: '6px 11px',
            '&::placeholder': { color: t.mutedForeground, opacity: 0.72 },
          },
          inputSizeSmall: { padding: '6px 11px' },
          multiline: { padding: '6px 11px' },
          adornedStart: { paddingLeft: 10 },
          inputAdornedStart: { paddingLeft: 0 },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          input: { '&[type=number]': { MozAppearance: 'textfield' } },
        },
      },
      MuiFormHelperText: {
        styleOverrides: {
          root: {
            margin: '6px 0 0',
            fontSize: '0.75rem',
            lineHeight: 1.4,
            color: t.mutedForeground,
            '&.Mui-error': { color: t.destructiveForeground },
          },
        },
      },
      MuiSelect: {
        defaultProps: { MenuProps: { PaperProps: { sx: { mt: 0.5 } } } },
        styleOverrides: {
          select: { minHeight: '20px !important', display: 'flex', alignItems: 'center' },
          icon: { fontSize: 18, right: 8, color: t.mutedForeground },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          inputRoot: {
            padding: '0 32px 0 0 !important',
            '& .MuiAutocomplete-input': { padding: '6px 11px !important' },
          },
          paper: { marginTop: 4 },
          listbox: { padding: 4 },
          option: {
            borderRadius: radius.sm,
            minHeight: '32px !important',
            '&.Mui-focused': { backgroundColor: `${t.accent} !important` },
            '&[aria-selected="true"]': { backgroundColor: `${t.accent} !important` },
          },
          endAdornment: { '& .MuiSvgIcon-root': { fontSize: 18 } },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 32, height: 18, padding: 0, margin: '0 10px 0 0', overflow: 'visible' },
          switchBase: {
            padding: 1,
            color: t.background,
            '&:hover': { backgroundColor: 'transparent' },
            '&.Mui-checked': {
              transform: 'translateX(14px)',
              color: t.background,
              '&:hover': { backgroundColor: 'transparent' },
              '& + .MuiSwitch-track': { backgroundColor: t.primary, opacity: 1 },
            },
            '&.Mui-focusVisible + .MuiSwitch-track': { boxShadow: `0 0 0 2px ${t.background}, 0 0 0 4px ${t.ring}` },
            '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.64 },
          },
          thumb: { width: 16, height: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.12)' },
          track: {
            borderRadius: 9,
            opacity: 1,
            backgroundColor: dark ? alpha('#ffffff', 0.16) : alpha('#000000', 0.12),
            transition: 'background-color .2s',
          },
        },
      },
      MuiFormControlLabel: {
        styleOverrides: {
          root: { marginLeft: 0, marginRight: 0, gap: 0 },
          label: { fontSize: '0.875rem' },
        },
      },
      MuiRadio: { defaultProps: { size: 'small' } },

      // ── Menus & popovers ───────────────────────────────────────────────
      MuiPopover: {
        styleOverrides: {
          paper: {
            borderRadius: radius.lg,
            border: `1px solid ${t.border}`,
            backgroundColor: t.popover,
            boxShadow: `${shadowLg}, ${t.edge}`,
          },
        },
      },
      MuiMenu: {
        styleOverrides: { list: { padding: 4 } },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            minHeight: 32,
            borderRadius: radius.sm,
            padding: '4px 8px',
            fontSize: '0.875rem',
            '&:hover': { backgroundColor: t.accent },
            '&.Mui-selected, &.Mui-selected:hover, &.Mui-selected.Mui-focusVisible': {
              backgroundColor: t.accent,
              fontWeight: 500,
            },
            '&.Mui-focusVisible': { backgroundColor: t.accent },
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: false, enterDelay: 300 },
        styleOverrides: {
          tooltip: {
            fontSize: '0.75rem',
            fontWeight: 400,
            padding: '4px 8px',
            borderRadius: radius.md,
            color: t.foreground,
            backgroundColor: t.popover,
            border: `1px solid ${t.border}`,
            boxShadow: `0 4px 6px -1px rgba(0,0,0,.05), 0 2px 4px -2px rgba(0,0,0,.05)`,
          },
        },
      },

      // ── Dialogs ─────────────────────────────────────────────────────────
      MuiBackdrop: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(0, 0, 0, 0.32)',
            backdropFilter: 'blur(4px)',
            '&.MuiBackdrop-invisible': { backgroundColor: 'transparent', backdropFilter: 'none' },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: radius['2xl'],
            border: `1px solid ${t.border}`,
            backgroundColor: t.popover,
            boxShadow: `${shadowLg}, ${t.edge}`,
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { padding: '24px 24px 8px', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.3 },
        },
      },
      MuiDialogContent: {
        styleOverrides: { root: { padding: '8px 24px 24px' } },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            gap: 8,
            padding: '16px 24px',
            borderTop: `1px solid ${t.border}`,
            backgroundColor: alpha(dark ? '#ffffff' : '#000000', 0.04 * 0.72),
            '& > :not(style) ~ :not(style)': { marginLeft: 0 },
          },
        },
      },

      // ── Tabs (segmented control) ───────────────────────────────────────
      MuiTabs: {
        styleOverrides: {
          root: {
            display: 'inline-flex',
            minHeight: 0,
            padding: 2,
            borderRadius: radius.lg,
            backgroundColor: t.muted,
          },
          flexContainer: { gap: 2 },
          indicator: {
            height: '100%',
            borderRadius: radius.md,
            backgroundColor: dark ? t.input : t.background,
            boxShadow: `0 1px 2px rgba(0,0,0,${dark ? 0.2 : 0.06})`,
            zIndex: 0,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            zIndex: 1,
            minHeight: 28,
            minWidth: 0,
            padding: '0 12px',
            borderRadius: radius.md,
            fontSize: '0.8125rem',
            fontWeight: 500,
            textTransform: 'none',
            color: alpha(t.mutedForeground, 0.9),
            '&:hover': { color: t.foreground },
            '&.Mui-selected': { color: t.foreground },
          },
        },
      },

      // ── Data display ───────────────────────────────────────────────────
      MuiChip: {
        defaultProps: { size: 'small' },
        styleOverrides: {
          root: ({ ownerState }) => {
            const base = {
              height: 20,
              borderRadius: radius.sm,
              fontSize: '0.75rem',
              fontWeight: 500,
              border: '1px solid transparent',
              '& .MuiChip-label': { padding: '0 6px' },
              '& .MuiChip-icon': { fontSize: 13, marginLeft: 5, marginRight: -2, color: 'inherit', opacity: 0.8 },
            }
            const tint: Record<string, { bg: string; fg: string }> = {
              info: { bg: t.info, fg: t.infoForeground },
              success: { bg: t.success, fg: t.successForeground },
              warning: { bg: t.warning, fg: t.warningForeground },
              error: { bg: t.destructive, fg: t.destructiveForeground },
            }
            const c = ownerState.color && tint[ownerState.color]
            if (ownerState.variant === 'outlined') {
              return { ...base, borderColor: t.input, backgroundColor: dark ? alpha('#fff', 0.0256) : t.background, color: t.foreground }
            }
            if (c) return { ...base, ...softTint(mode, c.bg, c.fg) }
            if (ownerState.color === 'primary') {
              return { ...base, backgroundColor: t.primary, color: t.primaryForeground }
            }
            // default / secondary → neutral badge
            return {
              ...base,
              borderColor: t.border,
              backgroundColor: dark ? alpha('#ffffff', 0.08 * 0.64) : t.muted,
              color: t.foreground,
            }
          },
        },
      },
      MuiTableContainer: {
        styleOverrides: {
          root: {
            borderRadius: radius['2xl'],
            border: `1px solid ${t.border}`,
            backgroundColor: t.card,
            boxShadow: surfaceShadow,
          },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: {
            '& .MuiTableCell-root': {
              height: 36,
              paddingTop: 0,
              paddingBottom: 0,
              fontSize: '0.75rem',
              fontWeight: 500,
              color: t.mutedForeground,
              backgroundColor: dark ? alpha('#ffffff', 0.02) : alpha('#000000', 0.02),
            },
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: 'background-color .1s',
            '&.MuiTableRow-hover:hover': { backgroundColor: t.accent },
            '&:last-child > .MuiTableCell-body': { borderBottom: 0 },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottom: `1px solid ${t.border}`, fontSize: '0.875rem', padding: '10px 16px' },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: ({ ownerState }) => {
            const map: Record<string, { bg: string; fg: string }> = {
              info: { bg: t.info, fg: t.infoForeground },
              success: { bg: t.success, fg: t.successForeground },
              warning: { bg: t.warning, fg: t.warningForeground },
              error: { bg: t.destructive, fg: t.destructiveForeground },
            }
            const c = map[ownerState.severity ?? 'info']
            return {
              alignItems: 'center',
              padding: '8px 12px',
              borderRadius: radius.lg,
              fontSize: '0.8125rem',
              border: `1px solid ${alpha(c.bg, dark ? 0.24 : 0.2)}`,
              backgroundColor: alpha(c.bg, dark ? 0.08 : 0.04),
              color: t.foreground,
              '& .MuiAlert-icon': { color: c.fg, padding: 0, marginRight: 10, fontSize: 18, opacity: 1 },
              '& .MuiAlert-message': { padding: 0 },
            }
          },
        },
      },
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            borderRadius: radius.lg,
            border: `1px solid ${t.border}`,
            backgroundColor: t.popover,
            color: t.foreground,
            boxShadow: `${shadowLg}, ${t.edge}`,
            fontSize: '0.875rem',
            padding: '4px 14px',
            minWidth: 0,
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: { root: { backgroundColor: t.muted, borderRadius: radius.sm } },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: radius.lg,
            '&:hover': { backgroundColor: t.sidebarAccent },
            '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: t.sidebarAccent },
          },
        },
      },
      MuiLink: { defaultProps: { underline: 'hover', color: 'inherit' } },
    },
  })
}
