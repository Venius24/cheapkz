const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
export type Level = keyof typeof LEVELS

let current: number = LEVELS.info

const colors: Record<Level, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m'
}

function emit(level: Level, msg: string, extra?: unknown): void {
  if (LEVELS[level] < current) return
  const ts = new Date().toISOString()
  const tail = extra === undefined ? '' : ' ' + safeStr(extra)
  const line = `${ts} ${colors[level]}${level.toUpperCase().padEnd(5)}\x1b[0m ${msg}${tail}`
  ;(level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line)
}

function safeStr(x: unknown): string {
  if (x instanceof Error) return x.stack ?? `${x.name}: ${x.message}`
  try {
    return JSON.stringify(x)
  } catch {
    return String(x)
  }
}

export const log = {
  setLevel(l: Level): void {
    current = LEVELS[l]
  },
  debug(msg: string, extra?: unknown): void {
    emit('debug', msg, extra)
  },
  info(msg: string, extra?: unknown): void {
    emit('info', msg, extra)
  },
  warn(msg: string, extra?: unknown): void {
    emit('warn', msg, extra)
  },
  error(msg: string, extra?: unknown): void {
    emit('error', msg, extra)
  }
}
