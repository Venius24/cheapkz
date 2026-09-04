import { SourceError } from '../http/client.js'
import type { AdapterFetchArgs, Offer, SourceAdapter } from './types.js'

export interface FlightJson {
  origin?: string
  destination?: string
  price?: number
  currency?: string
  departure_at?: string
  return_at?: string | null
  airline?: string
  flight_number?: string | number
  transfers?: number
  link?: string
}

export const AVIASALES_BASE = 'https://www.aviasales.kz'

export function flightUrl(link: string | undefined, base = AVIASALES_BASE): string {
  if (!link) return base
  return link.startsWith('http') ? link : `${base}${link}`
}

/** Чистая функция — покрыта тестами. */
export function parseFlights(raw: unknown): Offer[] {
  const data = (raw as { data?: unknown })?.data
  if (!Array.isArray(data)) throw new SourceError('Flights: неожиданный формат ответа', 'PARSE')
  return (data as FlightJson[]).map((f) => {
    const dep = f.departure_at ?? ''
    const ret = f.return_at ?? ''
    const ext = [dep, ret, f.airline ?? '', String(f.flight_number ?? '')].join('|')
    const datePart = dep ? ` · ${dep.slice(0, 10)}` : ''
    const backPart = ret ? ` – ${ret.slice(0, 10)}` : ''
    const airPart = f.airline ? ` · ${f.airline}${f.flight_number ? '-' + f.flight_number : ''}` : ''
    const tr = f.transfers ? ` · ${f.transfers} пересадка` : ' · прямой'
    return {
      externalId: ext,
      title: `${f.origin ?? '?'}→${f.destination ?? '?'}${datePart}${backPart}${airPart}${tr}`,
      url: flightUrl(f.link),
      price: typeof f.price === 'number' ? f.price : null,
      currency: (f.currency ?? 'kzt').toUpperCase(),
      meta: { airline: f.airline, departure_at: dep, return_at: ret, transfers: f.transfers ?? 0 }
    }
  })
}

export function assertTpToken(token: string | null | undefined): void {
  if (!token) {
    throw new SourceError(
      'Не задан TRAVELPAYOUTS_TOKEN — добавьте токен из travelpayouts.com в .env, авиамониторинг без него недоступен',
      'CONFIG'
    )
  }
}

export interface FlightsParams {
  origin: string
  destination: string
  depart_date?: string
  return_date?: string
  one_way?: boolean
  currency?: string
}

export async function fetchFlights(
  guard: AdapterFetchArgs['guard'],
  tpToken: string | null,
  params: Record<string, unknown>
): Promise<Offer[]> {
  assertTpToken(tpToken)
  const p = params as unknown as FlightsParams
  if (!p?.origin || !p?.destination) {
    throw new SourceError('Для билетов нужны параметры origin и destination (IATA-коды: ALA, NQZ…)', 'CONFIG')
  }
  const qs = new URLSearchParams({
    origin: p.origin.toUpperCase(),
    destination: p.destination.toUpperCase(),
    currency: (p.currency ?? 'kzt').toLowerCase(),
    sorting: 'price',
    direct: 'false',
    limit: '30',
    one_way: String(p.one_way ?? !p.return_date),
    token: tpToken as string
  })
  if (p.depart_date) qs.set('departure_at', p.depart_date)
  if (p.return_date) qs.set('return_date', p.return_date)
  const json = await guard.getJson(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${qs.toString()}`)
  return parseFlights(json)
}

export const flightsAdapter: SourceAdapter = {
  kind: 'flights',
  label: 'Авиабилеты',
  detect(): boolean {
    return false // создаётся вручную с параметрами origin/destination
  },
  async fetch({ guard, params, tpToken }: AdapterFetchArgs): Promise<Offer[]> {
    return fetchFlights(guard, tpToken, params)
  }
}
