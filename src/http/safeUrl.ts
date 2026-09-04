import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { SourceError } from './errors.js'

/** Приватные/служебные диапазоны IPv4, куда наблюдения ходить не должны. */
function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true
  const [a, b] = p
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 169 && b === 254) return true // link-local + метаданные облаков
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0) return true // 192.0.0/24, 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast + reserved + broadcast
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const x = ip.toLowerCase().split('%')[0]
  if (x === '::' || x === '::1') return true
  if (x.startsWith('fe80') || x.startsWith('fc') || x.startsWith('fd')) return true
  if (x.startsWith('::ffff:')) return isPrivateIPv4(x.slice(7))
  return false
}

export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip)
  if (v === 4) return isPrivateIPv4(ip)
  if (v === 6) return isPrivateIPv6(ip)
  return true
}

/**
 * Защита от SSRF: наблюдения создаются по ссылке от пользователя, поэтому
 * перед запросом проверяем схему и то, что имя резолвится в публичный адрес.
 * `allowPrivate` включается только осознанно (ALLOW_PRIVATE_TARGETS=1) — например,
 * когда мониторится внутренний сервис в той же сети.
 */
export async function assertPublicUrl(rawUrl: string, allowPrivate = false): Promise<URL> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    throw new SourceError(`невалидный URL: ${rawUrl.slice(0, 120)}`, 'CONFIG')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SourceError(`схема ${u.protocol} запрещена — только http/https`, 'CONFIG')
  }
  if (allowPrivate) return u

  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new SourceError(`адрес ${host} находится во внутренней сети — запрос запрещён`, 'CONFIG')
    }
    return u
  }
  let addrs: Array<{ address: string }>
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    throw new SourceError(`не удалось разрешить имя ${host}`, 'NETWORK')
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new SourceError(`имя ${host} указывает во внутреннюю сеть — запрос запрещён`, 'CONFIG')
  }
  return u
}
