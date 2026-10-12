import { Box, Paper, useTheme } from '@mui/material'
import Editor, { type OnMount } from '@monaco-editor/react'
import { editorOptions, editorTheme, setupMonaco } from '../../lib/monaco'

/** A Monaco JSON editor in an outlined card. */
function JsonEditor({
  value,
  onChange,
  height = 360,
  onMount,
}: {
  value: string
  onChange: (v: string) => void
  height?: number | string
  onMount?: OnMount
}) {
  const theme = useTheme()
  return (
    <Paper variant="outlined" sx={(th) => ({ overflow: 'hidden', boxShadow: `0 1px 2px rgba(0,0,0,.05), ${th.tokens.edge}` })}>
      <Box sx={{ height }}>
        <Editor
          height="100%"
          language="json"
          theme={editorTheme(theme.palette.mode)}
          beforeMount={setupMonaco}
          onMount={onMount}
          value={value}
          onChange={(v) => onChange(v ?? '')}
          options={{ ...editorOptions, tabSize: 2 }}
        />
      </Box>
    </Paper>
  )
}

export default JsonEditor
