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

/** WebView2 reports Windows in its user agent. */
export const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/** crates.io index mirrors (Cargo source replacement). */
export const CARGO_MIRRORS: Mirror[] = [
  { name: 'cratesOfficial', url: 'sparse+https://index.crates.io/' },
  { name: 'rsproxy', url: 'sparse+https://rsproxy.cn/index/' },
  { name: 'tsinghua', url: 'sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/' },
  { name: 'ustc', url: 'sparse+https://mirrors.ustc.edu.cn/crates.io-index/' },
  { name: 'aliyun', url: 'sparse+https://mirrors.aliyun.com/crates.io-index/' },
]

/** rustup mirrors: RUSTUP_DIST_SERVER with its matching RUSTUP_UPDATE_ROOT. */
export const RUSTUP_MIRRORS: (Mirror & { updateRoot: string })[] = [
  { name: 'rustupOfficial', url: 'https://static.rust-lang.org', updateRoot: 'https://static.rust-lang.org/rustup' },
  { name: 'rsproxy', url: 'https://rsproxy.cn', updateRoot: 'https://rsproxy.cn/rustup' },
  { name: 'tsinghua', url: 'https://mirrors.tuna.tsinghua.edu.cn/rustup', updateRoot: 'https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup' },
  { name: 'ustc', url: 'https://mirrors.ustc.edu.cn/rust-static', updateRoot: 'https://mirrors.ustc.edu.cn/rust-static/rustup' },
  { name: 'aliyun', url: 'https://mirrors.aliyun.com/rustup', updateRoot: 'https://mirrors.aliyun.com/rustup/rustup' },
]

/** GOPROXY values (with the usual ",direct" fallback). */
export const GO_PROXIES: Mirror[] = [
  { name: 'goOfficial', url: 'https://proxy.golang.org,direct' },
  { name: 'goproxycn', url: 'https://goproxy.cn,direct' },
  { name: 'goproxyio', url: 'https://goproxy.io,direct' },
  { name: 'aliyun', url: 'https://mirrors.aliyun.com/goproxy/,direct' },
  { name: 'tencent', url: 'https://mirrors.cloud.tencent.com/go/,direct' },
]

export const cargoPingUrl = (index: string) => `${withSlash(index.replace(/^sparse\+/, ''))}config.json`
export const rustupPingUrl = (dist: string) => `${dist.replace(/\/+$/, '')}/dist/channel-rust-stable.toml.sha256`
/** First proxy in a GOPROXY list, asked for a tiny module listing. */
export const goPingUrl = (goproxy: string) => {
  const first = goproxy.split(/[,|]/).find((p) => /^https?:\/\//.test(p)) ?? 'https://proxy.golang.org'
  return `${withSlash(first)}golang.org/x/text/@v/list`
}
