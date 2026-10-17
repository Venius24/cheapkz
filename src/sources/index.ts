import type { SourceAdapter } from './types.js'
import { kaspiAdapter } from './kaspi.js'
import { olxAdapter } from './olx.js'
import { krishaAdapter } from './krisha.js'
import { flightsAdapter } from './flights.js'
import { genericAdapter } from './generic.js'
import { krishaZoneAdapter, kaspiCategoryAdapter } from './scan.js'

export const ADAPTERS: SourceAdapter[] = [
  kaspiAdapter,
  olxAdapter,
  krishaAdapter,
  flightsAdapter,
  genericAdapter,
  // сканеры детектора по URL не определяются — создаются только из раздела «Детектор»
  krishaZoneAdapter,
  kaspiCategoryAdapter
]

export function getAdapter(kind: string): SourceAdapter {
  const a = ADAPTERS.find((x) => x.kind === kind)
  if (!a) throw new Error(`Неизвестный тип источника: ${kind}`)
  return a
}

/** Автодетект типа по URL; flights — только вручную. */
export function detectKind(url: string): string {
  try {
    const u = new URL(url)
    for (const a of ADAPTERS) {
      if (a.detect(u)) return a.kind
    }
  } catch {
    /* невалидный url */
  }
  return 'generic'
}
