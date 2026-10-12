import { useQuery, useQueryClient } from '@tanstack/react-query'
import { detectDevTools } from '../api/tauri'

export const DEV_TOOLS_KEY = ['devTools']

/**
 * Which developer tools are installed. Detection only scans PATH, and the result is
 * kept for the whole session — pages never re-detect on their own, only when the
 * user asks (recheck / refresh).
 */
export function useDevTools() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: DEV_TOOLS_KEY,
    queryFn: detectDevTools,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  const recheck = () => queryClient.invalidateQueries({ queryKey: DEV_TOOLS_KEY })
  return { ...query, recheck }
}

/** Config reads are cheap but involve a version spawn; keep them for a while. */
export const TOOL_INFO_STALE_MS = 5 * 60 * 1000

export const sameUrl = (a?: string | null, b?: string | null) =>
  (a ?? '').trim().replace(/\/+$/, '').toLowerCase() === (b ?? '').trim().replace(/\/+$/, '').toLowerCase()

export interface Mirror {
  /** i18n key under devtools.mirrors, or a literal name */
  name: string
  url: string
}

export const NPM_MIRRORS: Mirror[] = [
  { name: 'npmOfficial', url: 'https://registry.npmjs.org/' },
  { name: 'npmmirror', url: 'https://registry.npmmirror.com/' },
  { name: 'tencent', url: 'https://mirrors.cloud.tencent.com/npm/' },
  { name: 'huawei', url: 'https://repo.huaweicloud.com/repository/npm/' },
]

export const PIP_MIRRORS: Mirror[] = [
  { name: 'pypiOfficial', url: 'https://pypi.org/simple' },
  { name: 'tsinghua', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { name: 'aliyun', url: 'https://mirrors.aliyun.com/pypi/simple/' },
  { name: 'tencent', url: 'https://mirrors.cloud.tencent.com/pypi/simple' },
  { name: 'huawei', url: 'https://repo.huaweicloud.com/repository/pypi/simple' },
]

const withSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`)

/** Small endpoints used to time a mirror without downloading large indexes. */
export const npmPingUrl = (registry: string) => `${withSlash(registry)}-/ping`
export const pipPingUrl = (index: string) => `${withSlash(index)}pip/`
export const dockerPingUrl = (mirror: string) => `${withSlash(mirror)}v2/`
