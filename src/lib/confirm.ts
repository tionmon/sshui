import { ask } from '@tauri-apps/plugin-dialog'
import { loadSettings } from '../api/tauri'

/**
 * Ask the user to confirm a destructive action, honouring the
 * "confirm before delete" setting. Resolves true when the action may proceed.
 */
export async function confirmAction(message: string, title: string): Promise<boolean> {
  const settings = await loadSettings()
  if (!settings.confirm_delete) return true
  return ask(message, { title, kind: 'warning' })
}
