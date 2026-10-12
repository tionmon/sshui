import { Box, Button, Chip } from '@mui/material'
import { Speed } from '@mui/icons-material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { testUrl, type UrlTestResult } from '../../api/tauri'
import { Section, Row } from '../SettingsSection'
import { sameUrl, type Mirror } from '../../lib/devtools'
import { FONT_MONO } from '../../theme'
import ConfigField from './ConfigField'
import TestResult from './TestResult'

interface MirrorPickerProps {
  title: string
  presets: Mirror[]
  /** The saved value (null = tool default, i.e. the first preset) */
  value: string | null
  /** Builds the URL used to time a mirror */
  pingUrl: (url: string) => string
  /** Proxy to test through, if one is configured */
  proxy?: string | null
  onSave: (url: string | null) => Promise<void>
  customLabel: string
  customDescription: string
}

/** Preset mirrors with one-click switching and a speed test, plus a custom URL field. */
function MirrorPicker({ title, presets, value, pingUrl, proxy, onSave, customLabel, customDescription }: MirrorPickerProps) {
  const { t } = useTranslation()
  const [results, setResults] = useState<Record<string, UrlTestResult | null>>({})
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const official = presets[0]
  const current = value ?? official.url

  const testAll = async () => {
    setTesting(true)
    setResults({})
    const urls = [...presets.map((p) => p.url), ...(presets.some((p) => sameUrl(p.url, current)) ? [] : [current])]
    await Promise.all(
      urls.map(async (url) => {
        const result = await testUrl(pingUrl(url), proxy ?? null).catch((e) => ({
          ok: false,
          status: null,
          elapsed_ms: 0,
          message: String(e),
        }))
        setResults((r) => ({ ...r, [url]: result }))
      }),
    )
    setTesting(false)
  }

  const use = async (url: string) => {
    setSaving(url)
    try {
      // The official registry is the tool's default: remove the setting instead of pinning it
      await onSave(sameUrl(url, official.url) ? null : url)
    } finally {
      setSaving(null)
    }
  }

  const custom = presets.some((p) => sameUrl(p.url, current)) ? null : current

  return (
    <Section
      title={title}
      action={
        <Button size="small" startIcon={<Speed />} onClick={testAll} disabled={testing}>
          {t('devtools.testSpeed')}
        </Button>
      }
    >
      {presets.map((preset) => {
        const active = sameUrl(preset.url, current)
        return (
          <Row
            key={preset.url}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {t(`devtools.mirrors.${preset.name}`, { defaultValue: preset.name })}
                {active && <Chip label={t('devtools.current')} color="success" />}
              </Box>
            }
            description={<Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>{preset.url}</Box>}
            control={
              <>
                <TestResult result={results[preset.url]} pending={testing && !(preset.url in results)} />
                {!active && (
                  <Button size="small" onClick={() => use(preset.url)} disabled={!!saving}>
                    {saving === preset.url ? t('devtools.saving') : t('devtools.use')}
                  </Button>
                )}
              </>
            }
          />
        )
      })}
      <ConfigField
        label={customLabel}
        description={customDescription}
        value={custom}
        placeholder="https://"
        validate={(v) => (/^https?:\/\/\S+$/.test(v) ? null : t('devtools.invalidUrl'))}
        onSave={onSave}
        footer={
          custom && (results[custom] || testing) ? (
            <Box sx={{ mt: 1 }}>
              <TestResult result={results[custom]} pending={testing && !(custom in results)} />
            </Box>
          ) : null
        }
      />
    </Section>
  )
}

export default MirrorPicker
