/**
 * Form definitions for the node types SSHUI can edit field by field. Anything not
 * listed here is still editable in a node's JSON tab, and unknown fields are kept.
 */
import { getIn, isObj, setIn, type Obj } from './doc'

export type FieldKind = 'text' | 'secret' | 'number' | 'port' | 'select' | 'bool' | 'list'

export interface FieldDef {
  /** Dot path inside the node, e.g. "tls.server_name" or "peers.0.public_key" */
  path: string
  kind: FieldKind
  options?: string[]
  required?: boolean
  placeholder?: string
  /** Takes the whole row */
  full?: boolean
}

export type TlsMode = 'none' | 'optional' | 'required'

export interface ProtocolDef {
  type: string
  label: string
  section: 'outbounds' | 'endpoints'
  fields: FieldDef[]
  tls: TlsMode
  /** VLESS Reality */
  reality?: boolean
  /** V2Ray transports (WebSocket, gRPC, …) */
  transport?: boolean
  /** Fields a new node starts with (besides type and tag) */
  template?: Obj
  /** Built-in outbound with no server */
  builtin?: boolean
}

const server: FieldDef[] = [
  { path: 'server', kind: 'text', required: true, placeholder: 'example.com' },
  { path: 'server_port', kind: 'port', required: true, placeholder: '443' },
]
const network: FieldDef = { path: 'network', kind: 'select', options: ['tcp', 'udp'] }

export const SS_METHODS = [
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'aes-128-gcm',
  'aes-192-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  'none',
]

export const PROTOCOLS: ProtocolDef[] = [
  {
    type: 'shadowsocks',
    label: 'Shadowsocks',
    section: 'outbounds',
    tls: 'none',
    template: { method: '2022-blake3-aes-128-gcm' },
    fields: [
      ...server,
      { path: 'method', kind: 'select', options: SS_METHODS, required: true },
      { path: 'password', kind: 'secret', required: true },
      { path: 'plugin', kind: 'select', options: ['obfs-local', 'v2ray-plugin'] },
      { path: 'plugin_opts', kind: 'text', placeholder: 'obfs=http;obfs-host=example.com' },
      network,
      { path: 'udp_over_tcp', kind: 'bool' },
    ],
  },
  {
    type: 'vmess',
    label: 'VMess',
    section: 'outbounds',
    tls: 'optional',
    transport: true,
    template: { security: 'auto' },
    fields: [
      ...server,
      { path: 'uuid', kind: 'secret', required: true, full: true },
      { path: 'security', kind: 'select', options: ['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305', 'aes-128-ctr'] },
      { path: 'alter_id', kind: 'number', placeholder: '0' },
      { path: 'packet_encoding', kind: 'select', options: ['packetaddr', 'xudp'] },
      network,
    ],
  },
  {
    type: 'vless',
    label: 'VLESS',
    section: 'outbounds',
    tls: 'optional',
    reality: true,
    transport: true,
    fields: [
      ...server,
      { path: 'uuid', kind: 'secret', required: true, full: true },
      { path: 'flow', kind: 'select', options: ['xtls-rprx-vision'] },
      { path: 'packet_encoding', kind: 'select', options: ['xudp', 'packetaddr'] },
      network,
    ],
  },
  {
    type: 'trojan',
    label: 'Trojan',
    section: 'outbounds',
    tls: 'optional',
    transport: true,
    template: { tls: { enabled: true } },
    fields: [...server, { path: 'password', kind: 'secret', required: true }, network],
  },
  {
    type: 'hysteria2',
    label: 'Hysteria2',
    section: 'outbounds',
    tls: 'required',
    template: { tls: { enabled: true } },
    fields: [
      { path: 'server', kind: 'text', required: true, placeholder: 'example.com' },
      { path: 'server_port', kind: 'port', placeholder: '443' },
      { path: 'server_ports', kind: 'list', placeholder: '20000:30000' },
      { path: 'hop_interval', kind: 'text', placeholder: '30s' },
      { path: 'password', kind: 'secret', required: true },
      { path: 'up_mbps', kind: 'number' },
      { path: 'down_mbps', kind: 'number' },
      { path: 'obfs.type', kind: 'select', options: ['salamander'] },
      { path: 'obfs.password', kind: 'secret' },
      network,
    ],
  },
  {
    type: 'tuic',
    label: 'TUIC',
    section: 'outbounds',
    tls: 'required',
    template: { congestion_control: 'bbr', tls: { enabled: true, alpn: ['h3'] } },
    fields: [
      ...server,
      { path: 'uuid', kind: 'secret', required: true, full: true },
      { path: 'password', kind: 'secret' },
      { path: 'congestion_control', kind: 'select', options: ['cubic', 'new_reno', 'bbr'] },
      { path: 'udp_relay_mode', kind: 'select', options: ['native', 'quic'] },
      { path: 'udp_over_stream', kind: 'bool' },
      { path: 'zero_rtt_handshake', kind: 'bool' },
      { path: 'heartbeat', kind: 'text', placeholder: '10s' },
      network,
    ],
  },
  {
    type: 'anytls',
    label: 'AnyTLS',
    section: 'outbounds',
    tls: 'required',
    template: { tls: { enabled: true } },
    fields: [
      ...server,
      { path: 'password', kind: 'secret', required: true },
      { path: 'idle_session_check_interval', kind: 'text', placeholder: '30s' },
      { path: 'idle_session_timeout', kind: 'text', placeholder: '30s' },
      { path: 'min_idle_session', kind: 'number' },
    ],
  },
  {
    type: 'hysteria',
    label: 'Hysteria',
    section: 'outbounds',
    tls: 'required',
    template: { tls: { enabled: true } },
    fields: [
      ...server,
      { path: 'auth_str', kind: 'secret' },
      { path: 'up_mbps', kind: 'number', required: true },
      { path: 'down_mbps', kind: 'number', required: true },
      { path: 'obfs', kind: 'secret' },
      network,
    ],
  },
  {
    type: 'shadowtls',
    label: 'ShadowTLS',
    section: 'outbounds',
    tls: 'required',
    template: { version: 3, tls: { enabled: true } },
    fields: [
      ...server,
      { path: 'version', kind: 'select', options: ['1', '2', '3'] },
      { path: 'password', kind: 'secret' },
    ],
  },
  {
    type: 'wireguard',
    label: 'WireGuard',
    section: 'endpoints',
    tls: 'none',
    template: { address: [], private_key: '', peers: [{ address: '', port: 51820, public_key: '', allowed_ips: ['0.0.0.0/0', '::/0'] }] },
    fields: [
      { path: 'peers.0.address', kind: 'text', required: true, placeholder: 'example.com' },
      { path: 'peers.0.port', kind: 'port', required: true, placeholder: '51820' },
      { path: 'address', kind: 'list', required: true, placeholder: '10.0.0.2/32', full: true },
      { path: 'private_key', kind: 'secret', required: true, full: true },
      { path: 'peers.0.public_key', kind: 'text', required: true, full: true },
      { path: 'peers.0.pre_shared_key', kind: 'secret', full: true },
      { path: 'peers.0.allowed_ips', kind: 'list', placeholder: '0.0.0.0/0', full: true },
      { path: 'peers.0.persistent_keepalive_interval', kind: 'number' },
      { path: 'mtu', kind: 'number', placeholder: '1408' },
    ],
  },
  {
    type: 'socks',
    label: 'SOCKS',
    section: 'outbounds',
    tls: 'none',
    fields: [
      ...server,
      { path: 'version', kind: 'select', options: ['5', '4a', '4'] },
      { path: 'username', kind: 'text' },
      { path: 'password', kind: 'secret' },
      network,
      { path: 'udp_over_tcp', kind: 'bool' },
    ],
  },
  {
    type: 'http',
    label: 'HTTP',
    section: 'outbounds',
    tls: 'optional',
    fields: [...server, { path: 'username', kind: 'text' }, { path: 'password', kind: 'secret' }, { path: 'path', kind: 'text' }],
  },
  {
    type: 'ssh',
    label: 'SSH',
    section: 'outbounds',
    tls: 'none',
    template: { server_port: 22 },
    fields: [
      ...server,
      { path: 'user', kind: 'text', placeholder: 'root' },
      { path: 'password', kind: 'secret' },
      { path: 'private_key_path', kind: 'text', full: true },
    ],
  },
  { type: 'direct', label: 'Direct', section: 'outbounds', tls: 'none', fields: [], builtin: true },
  { type: 'block', label: 'Block', section: 'outbounds', tls: 'none', fields: [], builtin: true },
]

export const protocolOf = (type: string) => PROTOCOLS.find((p) => p.type === type)

/** Types offered when adding a node: endpoints in the endpoints section, block is deprecated */
export const ADDABLE = PROTOCOLS.filter((p) => p.type !== 'block')

/** Numbers that sing-box wants as numbers even when picked from a select */
const NUMERIC_SELECTS = new Set(['version'])

export function readField(node: Obj, field: FieldDef): unknown {
  const v = getIn(node, field.path)
  if (field.kind === 'select' && v !== undefined) return String(v)
  return v
}

export function writeField(node: Obj, field: FieldDef, value: unknown) {
  let v = value
  if (field.kind === 'select' && NUMERIC_SELECTS.has(field.path) && node.type === 'shadowtls' && v) v = Number(v)
  if ((field.kind === 'number' || field.kind === 'port') && typeof v === 'string') v = v.trim() === '' ? undefined : Number(v)
  if (field.kind === 'bool') v = v ? true : undefined
  setIn(node, field.path, v)
}

/** "server:port" for the node table. */
export function addressOf(node: Obj): string | null {
  const host = (h: unknown) => (typeof h === 'string' && h.includes(':') && !h.startsWith('[') ? `[${h}]` : String(h))
  if (node.type === 'wireguard' && Array.isArray(node.peers) && isObj(node.peers[0])) {
    const p = node.peers[0]
    return p.address ? `${host(p.address)}${p.port ? `:${p.port}` : ''}` : null
  }
  if (typeof node.server !== 'string' || !node.server) return null
  if (node.server_port) return `${host(node.server)}:${node.server_port}`
  if (Array.isArray(node.server_ports) && node.server_ports.length) return `${host(node.server)}:${node.server_ports[0]}`
  return host(node.server)
}

/** Required fields that are empty, as paths. */
export function missingFields(node: Obj): string[] {
  const def = protocolOf(String(node.type))
  if (!def) return []
  const missing = def.fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = getIn(node, f.path)
      return v === undefined || v === '' || v === null || (Array.isArray(v) && v.length === 0)
    })
    .map((f) => f.path)
  // Hysteria2 needs a port or a port range
  if (node.type === 'hysteria2' && !node.server_port && !(Array.isArray(node.server_ports) && node.server_ports.length)) {
    missing.push('server_port')
  }
  return missing
}

export const isValidPort = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

// ── TLS and transport ────────────────────────────────────────────────────────

export const UTLS_FINGERPRINTS = ['chrome', 'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized']
export const TRANSPORTS = ['ws', 'grpc', 'http', 'httpupgrade', 'quic']

export type Security = 'none' | 'tls' | 'reality'

export function securityOf(node: Obj): Security {
  const tls = isObj(node.tls) ? node.tls : null
  if (!tls || !tls.enabled) return 'none'
  return isObj(tls.reality) && tls.reality.enabled ? 'reality' : 'tls'
}

export function setSecurity(node: Obj, security: Security) {
  if (security === 'none') {
    delete node.tls
    return
  }
  const tls: Obj = isObj(node.tls) ? node.tls : {}
  tls.enabled = true
  if (security === 'reality') {
    tls.reality = { ...(isObj(tls.reality) ? tls.reality : {}), enabled: true }
    // Reality needs a uTLS fingerprint
    tls.utls = { enabled: true, fingerprint: (isObj(tls.utls) && tls.utls.fingerprint) || 'chrome' }
  } else {
    delete tls.reality
  }
  node.tls = tls
}

export function setFingerprint(node: Obj, fingerprint: string) {
  if (!fingerprint) {
    if (isObj(node.tls)) delete node.tls.utls
    return
  }
  setIn(node, 'tls.utls', { enabled: true, fingerprint })
}

/** Replace the transport, keeping path/host when switching between similar types. */
export function setTransport(node: Obj, type: string) {
  if (!type) {
    delete node.transport
    return
  }
  const old = isObj(node.transport) ? node.transport : {}
  const next: Obj = { type }
  if (type === 'ws' || type === 'httpupgrade' || type === 'http') {
    if (typeof old.path === 'string') next.path = old.path
    const oldHost = old.host ?? (isObj(old.headers) ? old.headers.Host : undefined)
    if (oldHost) {
      if (type === 'ws') next.headers = { Host: Array.isArray(oldHost) ? oldHost[0] : oldHost }
      else if (type === 'http') next.host = Array.isArray(oldHost) ? oldHost : [oldHost]
      else next.host = Array.isArray(oldHost) ? oldHost[0] : oldHost
    }
  }
  if (type === 'grpc' && typeof old.service_name === 'string') next.service_name = old.service_name
  node.transport = next
}

export const TRANSPORT_FIELDS: Record<string, FieldDef[]> = {
  ws: [
    { path: 'transport.path', kind: 'text', placeholder: '/' },
    { path: 'transport.headers.Host', kind: 'text' },
    { path: 'transport.max_early_data', kind: 'number' },
    { path: 'transport.early_data_header_name', kind: 'text', placeholder: 'Sec-WebSocket-Protocol' },
  ],
  grpc: [{ path: 'transport.service_name', kind: 'text', full: true }],
  http: [
    { path: 'transport.host', kind: 'list' },
    { path: 'transport.path', kind: 'text', placeholder: '/' },
  ],
  httpupgrade: [
    { path: 'transport.host', kind: 'text' },
    { path: 'transport.path', kind: 'text', placeholder: '/' },
  ],
  quic: [],
}

export const TLS_FIELDS: FieldDef[] = [
  { path: 'tls.server_name', kind: 'text', placeholder: 'example.com' },
  { path: 'tls.alpn', kind: 'list', placeholder: 'h2' },
  { path: 'tls.insecure', kind: 'bool' },
]

export const REALITY_FIELDS: FieldDef[] = [
  { path: 'tls.reality.public_key', kind: 'text', required: true, full: true },
  { path: 'tls.reality.short_id', kind: 'text' },
]

/**
 * A key identifying the server and credentials, so re-importing the same link
 * doesn't add a duplicate.
 */
export function nodeFingerprint(node: Obj): string {
  const parts = [node.type, addressOf(node), node.uuid, node.password, node.private_key, node.method]
  return parts.map((p) => (p === undefined ? '' : String(p))).join('|')
}
