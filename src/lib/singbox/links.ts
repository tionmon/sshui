/**
 * Turns share links (ss://, vmess://, vless://, trojan://, hysteria2://, tuic://,
 * anytls://, socks://, wireguard://), base64 subscription content, or pasted sing-box
 * outbound JSON into sing-box outbounds.
 */
import { isGroupType, isObj, type Obj } from './doc'

export type ImportResult =
  | { ok: true; source: string; node: Obj }
  | { ok: false; source: string; error: string; detail?: string }

class LinkError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Decode standard or URL-safe base64 (padding optional) as UTF-8. */
export function decodeBase64(input: string): string | null {
  const clean = input.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null
  try {
    const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

interface Uri {
  scheme: string
  userinfo: string | null
  host: string
  port: string
  path: string
  params: Map<string, string>
  tag: string
}

/** Split a URI by hand: share links bend the URL rules (port lists, raw base64…). */
function parseUri(link: string): Uri {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(link.trim())
  if (!m) throw new LinkError('malformed')
  const [, scheme, rest, query = '', fragment = ''] = m
  const slash = rest.indexOf('/')
  const authority = slash < 0 ? rest : rest.slice(0, slash)
  const path = slash < 0 ? '' : rest.slice(slash)
  const at = authority.lastIndexOf('@')
  const userinfo = at < 0 ? null : authority.slice(0, at)
  const hostport = at < 0 ? authority : authority.slice(at + 1)
  let host: string
  let port = ''
  if (hostport.startsWith('[')) {
    const end = hostport.indexOf(']')
    if (end < 0) throw new LinkError('malformed')
    host = hostport.slice(1, end)
    port = hostport.slice(end + 1).replace(/^:/, '')
  } else {
    const colon = hostport.indexOf(':')
    host = colon < 0 ? hostport : hostport.slice(0, colon)
    port = colon < 0 ? '' : hostport.slice(colon + 1)
  }
  const params = new Map<string, string>()
  // Not URLSearchParams: it turns '+' into a space, which breaks keys and paths
  for (const pair of query.replace(/^\?/, '').split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = decode(eq < 0 ? pair : pair.slice(0, eq))
    params.set(key, decode(eq < 0 ? '' : pair.slice(eq + 1)))
  }
  return {
    scheme: scheme.toLowerCase(),
    userinfo,
    host: decode(host),
    port,
    path: decode(path),
    params,
    tag: decode(fragment.replace(/^#/, '')).trim(),
  }
}

function requirePort(value: string | number | undefined): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new LinkError('badPort', String(value ?? ''))
  return n
}

const truthy = (v: string | undefined) => v === '1' || v === 'true'
const list = (v: string | undefined) =>
  v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

/** Drop undefined/empty values so the generated JSON stays minimal. */
function compact<T extends Obj>(obj: T): T {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete obj[k]
    else if (Array.isArray(v)) v.forEach((item) => isObj(item) && compact(item))
    else if (isObj(v)) {
      compact(v)
      if (Object.keys(v).length === 0) delete obj[k]
    }
  }
  return obj
}

interface StreamOptions {
  security?: string
  sni?: string
  fp?: string
  alpn?: string
  insecure?: boolean
  pbk?: string
  sid?: string
  type?: string
  path?: string
  host?: string
  serviceName?: string
  headerType?: string
}

/** TLS + transport from the Xray-style query parameters shared by vless/trojan/vmess. */
function applyStream(node: Obj, o: StreamOptions, defaultTls: boolean) {
  const security = (o.security ?? (defaultTls ? 'tls' : 'none')).toLowerCase()
  if (security === 'tls' || security === 'xtls' || security === 'reality') {
    const tls: Obj = {
      enabled: true,
      server_name: o.sni,
      insecure: o.insecure || undefined,
      alpn: list(o.alpn),
    }
    if (o.fp) tls.utls = { enabled: true, fingerprint: o.fp }
    if (security === 'reality') {
      if (!o.pbk) throw new LinkError('realityKey')
      tls.reality = { enabled: true, public_key: o.pbk, short_id: o.sid }
      tls.utls = { enabled: true, fingerprint: o.fp || 'chrome' }
    }
    node.tls = tls
  } else if (security !== 'none' && security !== '') {
    throw new LinkError('unsupportedSecurity', security)
  }

  const type = (o.type ?? 'tcp').toLowerCase()
  switch (type) {
    case 'tcp':
    case 'raw':
    case '':
      if (o.headerType === 'http') {
        node.transport = { type: 'http', host: list(o.host), path: o.path || undefined }
      }
      break
    case 'ws': {
      const transport: Obj = { type: 'ws' }
      let path = o.path || '/'
      // "/path?ed=2048" means WebSocket early data
      const ed = path.match(/[?&]ed=(\d+)/)
      if (ed) {
        path = path.replace(/[?&]ed=\d+/, '').replace(/\?$/, '') || '/'
        transport.max_early_data = Number(ed[1])
        transport.early_data_header_name = 'Sec-WebSocket-Protocol'
      }
      transport.path = path
      if (o.host) transport.headers = { Host: o.host }
      node.transport = transport
      break
    }
    case 'grpc':
      node.transport = { type: 'grpc', service_name: o.serviceName || o.path || undefined }
      break
    case 'http':
    case 'h2':
      node.transport = { type: 'http', host: list(o.host), path: o.path || undefined }
      break
    case 'httpupgrade':
      node.transport = { type: 'httpupgrade', host: o.host || undefined, path: o.path || undefined }
      break
    case 'quic':
      node.transport = { type: 'quic' }
      break
    default:
      throw new LinkError('unsupportedTransport', type)
  }
}

const streamFromParams = (p: Map<string, string>): StreamOptions => ({
  security: p.get('security'),
  sni: p.get('sni') || p.get('peer'),
  fp: p.get('fp'),
  alpn: p.get('alpn'),
  insecure: truthy(p.get('allowInsecure')) || truthy(p.get('insecure')) || truthy(p.get('allow_insecure')),
  pbk: p.get('pbk'),
  sid: p.get('sid'),
  type: p.get('type'),
  path: p.get('path'),
  host: p.get('host'),
  serviceName: p.get('serviceName'),
  headerType: p.get('headerType'),
})

// ── Protocols ────────────────────────────────────────────────────────────────

function parseShadowsocks(link: string): Obj {
  let body = link.slice('ss://'.length)
  const hash = body.indexOf('#')
  const fragment = hash < 0 ? '' : body.slice(hash)
  if (hash >= 0) body = body.slice(0, hash)
  const q = body.indexOf('?')
  let main = q < 0 ? body : body.slice(0, q)
  const query = q < 0 ? '' : body.slice(q)
  // Legacy form: ss://base64(method:password@host:port)
  if (!main.includes('@')) {
    const decoded = decodeBase64(main.replace(/\/$/, ''))
    if (!decoded || !decoded.includes('@')) throw new LinkError('malformed')
    main = decoded
  }
  // Split by hand: standard base64 in the user info may contain '/'
  const at = main.lastIndexOf('@')
  const rawUser = main.slice(0, at)
  const uri = parseUri(`ss://x@${main.slice(at + 1)}${query}${fragment}`)
  let userinfo = decode(rawUser)
  if (!userinfo.includes(':')) {
    const decoded = decodeBase64(rawUser)
    if (!decoded || !decoded.includes(':')) throw new LinkError('malformed')
    userinfo = decoded
  }
  const colon = userinfo.indexOf(':')
  const node: Obj = {
    type: 'shadowsocks',
    tag: uri.tag,
    server: uri.host,
    server_port: requirePort(uri.port),
    method: userinfo.slice(0, colon),
    password: userinfo.slice(colon + 1),
  }
  const plugin = uri.params.get('plugin')
  if (plugin) {
    const semi = plugin.indexOf(';')
    const name = semi < 0 ? plugin : plugin.slice(0, semi)
    node.plugin = name === 'simple-obfs' ? 'obfs-local' : name
    if (!['obfs-local', 'v2ray-plugin'].includes(node.plugin)) throw new LinkError('unsupportedPlugin', name)
    if (semi >= 0) node.plugin_opts = plugin.slice(semi + 1)
  }
  return node
}

function parseVmess(link: string): Obj {
  const body = link.slice('vmess://'.length).split('#')[0]
  const decoded = decodeBase64(body)
  if (!decoded) {
    // The newer URI form: vmess://uuid@host:port?…
    const uri = parseUri(link)
    if (!uri.userinfo) throw new LinkError('malformed')
    const node: Obj = {
      type: 'vmess',
      tag: uri.tag,
      server: uri.host,
      server_port: requirePort(uri.port),
      uuid: decode(uri.userinfo),
      security: uri.params.get('encryption') || 'auto',
    }
    applyStream(node, streamFromParams(uri.params), false)
    return node
  }
  let v: Obj
  try {
    v = JSON.parse(decoded)
  } catch {
    throw new LinkError('malformed')
  }
  const node: Obj = {
    type: 'vmess',
    tag: String(v.ps ?? '').trim(),
    server: String(v.add ?? ''),
    server_port: requirePort(v.port),
    uuid: String(v.id ?? ''),
    security: v.scy || 'auto',
    alter_id: Number(v.aid) || undefined,
  }
  if (!node.server || !node.uuid) throw new LinkError('malformed')
  const net = String(v.net || 'tcp')
  applyStream(
    node,
    {
      security: v.tls === 'tls' ? 'tls' : 'none',
      sni: v.sni || undefined,
      fp: v.fp || undefined,
      alpn: v.alpn || undefined,
      insecure: truthy(String(v.allowInsecure ?? v.skip_cert_verify ?? '')),
      type: net === 'h2' ? 'http' : net,
      path: v.path || undefined,
      host: v.host || undefined,
      serviceName: net === 'grpc' ? v.path || undefined : undefined,
      headerType: v.type,
    },
    false,
  )
  // Without an SNI, TLS uses the Host header like v2rayN does
  if (node.tls && !node.tls.server_name && v.host) node.tls.server_name = String(v.host).split(',')[0]
  return node
}

function parseVless(uri: Uri): Obj {
  if (!uri.userinfo) throw new LinkError('malformed')
  const encryption = uri.params.get('encryption')
  if (encryption && encryption !== 'none') throw new LinkError('unsupportedSecurity', `encryption=${encryption}`)
  const node: Obj = {
    type: 'vless',
    tag: uri.tag,
    server: uri.host,
    server_port: requirePort(uri.port),
    uuid: decode(uri.userinfo),
    flow: uri.params.get('flow') || undefined,
  }
  applyStream(node, streamFromParams(uri.params), false)
  return node
}

function parseTrojan(uri: Uri): Obj {
  if (!uri.userinfo) throw new LinkError('malformed')
  const node: Obj = {
    type: 'trojan',
    tag: uri.tag,
    server: uri.host,
    server_port: uri.port ? requirePort(uri.port) : 443,
    password: decode(uri.userinfo),
  }
  applyStream(node, streamFromParams(uri.params), true)
  return node
}

/** "443,20000-30000" → a single port plus sing-box "from:to" ranges */
function hysteriaPorts(spec: string): { port?: number; ranges: string[] } {
  const ranges: string[] = []
  let port: number | undefined
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)[-:](\d+)$/)
    if (range) {
      requirePort(range[1])
      requirePort(range[2])
      ranges.push(`${range[1]}:${range[2]}`)
    } else if (port === undefined) {
      port = requirePort(part)
    } else {
      ranges.push(`${requirePort(part)}:${part}`)
    }
  }
  return { port, ranges }
}

function parseHysteria2(uri: Uri): Obj {
  const { port, ranges } = hysteriaPorts(uri.port || '443')
  const extra = uri.params.get('mport')
  if (extra) ranges.push(...hysteriaPorts(extra).ranges)
  const obfs = uri.params.get('obfs')
  const node: Obj = {
    type: 'hysteria2',
    tag: uri.tag,
    server: uri.host,
    server_port: port ?? (ranges.length ? undefined : 443),
    server_ports: ranges.length ? ranges : undefined,
    password: uri.userinfo ? decode(uri.userinfo) : uri.params.get('auth'),
    up_mbps: Number(uri.params.get('upmbps')) || undefined,
    down_mbps: Number(uri.params.get('downmbps')) || undefined,
    obfs: obfs && obfs !== 'none' ? { type: obfs, password: uri.params.get('obfs-password') } : undefined,
    tls: {
      enabled: true,
      server_name: uri.params.get('sni') || undefined,
      insecure: truthy(uri.params.get('insecure')) || undefined,
      alpn: list(uri.params.get('alpn')),
    },
  }
  return node
}

function parseTuic(uri: Uri): Obj {
  if (!uri.userinfo) throw new LinkError('malformed')
  const info = decode(uri.userinfo)
  const colon = info.indexOf(':')
  return {
    type: 'tuic',
    tag: uri.tag,
    server: uri.host,
    server_port: requirePort(uri.port),
    uuid: colon < 0 ? info : info.slice(0, colon),
    password: colon < 0 ? undefined : info.slice(colon + 1),
    congestion_control: uri.params.get('congestion_control') || uri.params.get('congestion-control') || undefined,
    udp_relay_mode: uri.params.get('udp_relay_mode') || uri.params.get('udp-relay-mode') || undefined,
    tls: {
      enabled: true,
      server_name: uri.params.get('sni') || undefined,
      insecure: truthy(uri.params.get('allow_insecure')) || truthy(uri.params.get('insecure')) || undefined,
      alpn: list(uri.params.get('alpn')),
    },
  }
}

function parseAnyTls(uri: Uri): Obj {
  if (!uri.userinfo) throw new LinkError('malformed')
  const fp = uri.params.get('fp')
  return {
    type: 'anytls',
    tag: uri.tag,
    server: uri.host,
    server_port: requirePort(uri.port || '443'),
    password: decode(uri.userinfo),
    tls: {
      enabled: true,
      server_name: uri.params.get('sni') || undefined,
      insecure: truthy(uri.params.get('insecure')) || truthy(uri.params.get('allowInsecure')) || undefined,
      utls: fp ? { enabled: true, fingerprint: fp } : undefined,
    },
  }
}

function parseSocks(uri: Uri): Obj {
  let user: string | undefined
  let pass: string | undefined
  if (uri.userinfo) {
    let info = decode(uri.userinfo)
    // Some apps base64 the user:pass part
    if (!info.includes(':')) info = decodeBase64(uri.userinfo) ?? info
    const colon = info.indexOf(':')
    user = colon < 0 ? info : info.slice(0, colon)
    pass = colon < 0 ? undefined : info.slice(colon + 1)
  }
  return {
    type: 'socks',
    tag: uri.tag,
    server: uri.host,
    server_port: requirePort(uri.port || '1080'),
    version: uri.scheme === 'socks4' ? '4' : uri.scheme === 'socks4a' ? '4a' : undefined,
    username: user,
    password: pass,
  }
}

function parseWireGuard(uri: Uri): Obj {
  if (!uri.userinfo) throw new LinkError('malformed')
  const p = uri.params
  const publicKey = p.get('publickey') || p.get('public_key') || p.get('peer_public_key')
  const address = list(p.get('address') || p.get('ip'))
  if (!publicKey || !address) throw new LinkError('malformed')
  const reserved = list(p.get('reserved'))?.map(Number)
  return {
    type: 'wireguard',
    tag: uri.tag,
    address: address.map((a) => (a.includes('/') ? a : `${a}/${a.includes(':') ? 128 : 32}`)),
    private_key: decode(uri.userinfo),
    mtu: Number(p.get('mtu')) || undefined,
    peers: [
      {
        address: uri.host,
        port: requirePort(uri.port || '51820'),
        public_key: publicKey,
        pre_shared_key: p.get('presharedkey') || p.get('pre_shared_key') || undefined,
        allowed_ips: ['0.0.0.0/0', '::/0'],
        reserved: reserved && reserved.length === 3 && reserved.every((n) => Number.isInteger(n)) ? reserved : undefined,
      },
    ],
  }
}

export const SUPPORTED_SCHEMES = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'hy2', 'tuic', 'anytls', 'socks', 'socks5', 'wireguard', 'wg']

export function parseLink(link: string): Obj {
  const scheme = link.slice(0, link.indexOf('://')).toLowerCase()
  let node: Obj
  switch (scheme) {
    case 'ss':
      node = parseShadowsocks(link)
      break
    case 'vmess':
      node = parseVmess(link)
      break
    case 'vless':
      node = parseVless(parseUri(link))
      break
    case 'trojan':
      node = parseTrojan(parseUri(link))
      break
    case 'hysteria2':
    case 'hy2':
      node = parseHysteria2(parseUri(link))
      break
    case 'tuic':
      node = parseTuic(parseUri(link))
      break
    case 'anytls':
      node = parseAnyTls(parseUri(link))
      break
    case 'socks':
    case 'socks5':
    case 'socks4':
    case 'socks4a':
      node = parseSocks(parseUri(link))
      break
    case 'wireguard':
    case 'wg':
      node = parseWireGuard(parseUri(link))
      break
    case 'http':
    case 'https':
      throw new LinkError('subscriptionUrl')
    default:
      throw new LinkError('unsupportedScheme', scheme || link.slice(0, 12))
  }
  if (!node.server && node.type !== 'wireguard') throw new LinkError('malformed')
  return compact(node)
}

/** Outbounds from pasted sing-box JSON: one outbound, a list, or a whole config. */
function fromJson(text: string): ImportResult[] | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return null
  }
  const items: unknown[] = Array.isArray(value)
    ? value
    : isObj(value) && (Array.isArray(value.outbounds) || Array.isArray(value.endpoints))
      ? [...(value.outbounds ?? []), ...(value.endpoints ?? [])]
      : [value]
  return items
    .filter((o): o is Obj => isObj(o) && typeof o.type === 'string')
    .filter((o) => !isGroupType(o.type) && !['direct', 'block', 'dns'].includes(o.type))
    .map((node) => ({ ok: true as const, source: `${node.type} ${node.tag ?? ''}`.trim(), node: structuredClone(node) }))
}

/** Parse whatever the user pasted: links (one per line), base64 content or JSON. */
export function parseImport(input: string): ImportResult[] {
  const json = fromJson(input)
  if (json) return json
  let text = input.trim()
  if (text && !text.includes('://')) {
    const decoded = decodeBase64(text)
    if (decoded && decoded.includes('://')) text = decoded
  }
  // One link per line, or several on a line separated by spaces. Names after '#'
  // sometimes contain raw spaces, so only split where the next link starts.
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/\s+(?=[a-z][a-z0-9+.-]*:\/\/)/i))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((source): ImportResult => {
      try {
        if (!source.includes('://')) throw new LinkError('malformed')
        return { ok: true, source, node: parseLink(source) }
      } catch (e) {
        if (e instanceof LinkError) return { ok: false, source, error: e.code, detail: e.detail }
        return { ok: false, source, error: 'malformed', detail: e instanceof Error ? e.message : String(e) }
      }
    })
}
