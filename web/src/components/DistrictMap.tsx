import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import geo from '../geo/kz-districts.json'
import { fmtMoney, type CatalogCity, type ZoneStat } from '../api'

type DistrictFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { alias: string; city: string }>

const FEATURES = (geo as unknown as GeoJSON.FeatureCollection).features as DistrictFeature[]

/** Дешёвый район — зелёный, дорогой — розовый (как ok → warm → hot в теме). */
const HEAT = ['#34d399', '#a3e635', '#f59e0b', '#fb7185', '#f43f5e']

function heatColor(v: number | null, lo: number, hi: number): string | null {
  if (v == null || !Number.isFinite(lo) || hi <= lo) return v == null ? null : HEAT[2]
  const t = Math.min(0.999, Math.max(0, (v - lo) / (hi - lo)))
  return HEAT[Math.floor(t * HEAT.length)]
}

const shortName = (n: string): string => n.replace(/\s*р-н\s*/g, ' ').replace(/^\s+|\s+$/g, '')

export interface DistrictMapProps {
  city: CatalogCity
  selected: Set<string>
  /** Районы, которые уже смотрят другие сканы */
  watched: Set<string>
  stats: Record<string, ZoneStat>
  unitLabel: string
  onToggle: (alias: string) => void
}

export default function DistrictMap({ city, selected, watched, stats, unitLabel, onToggle }: DistrictMapProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef(new Map<string, L.Path>())
  const badgesRef = useRef<L.LayerGroup | null>(null)
  const hoverRef = useRef<string | null>(null)
  const names = useMemo(() => new Map(city.districts.map((d) => [d.alias, d.name])), [city])
  const range = useMemo(() => {
    const vals = city.districts.map((d) => stats[d.alias]?.medianUnit).filter((v): v is number => v != null)
    return { lo: Math.min(...vals), hi: Math.max(...vals) }
  }, [city, stats])

  // обработчики Leaflet создаются один раз на город — свежие пропсы читаем через ref
  const live = useRef({ selected, watched, stats, onToggle, unitLabel, range, names })
  live.current = { selected, watched, stats, onToggle, unitLabel, range, names }

  const styleFor = (alias: string): L.PathOptions => {
    const { selected: sel, watched: w, stats: st, range: rg } = live.current
    const isSel = sel.has(alias)
    const hover = hoverRef.current === alias
    const heat = heatColor(st[alias]?.medianUnit ?? null, rg.lo, rg.hi)
    if (isSel) {
      return {
        color: '#22d3ee',
        weight: hover ? 4 : 3,
        fillColor: '#22d3ee',
        fillOpacity: hover ? 0.42 : 0.3,
        dashArray: undefined,
        className: 'district district--selected'
      }
    }
    return {
      color: w.has(alias) ? '#a78bfa' : hover ? '#ffffff' : 'rgba(255,255,255,0.45)',
      weight: hover ? 2.5 : 1.2,
      dashArray: w.has(alias) ? '6 5' : undefined,
      fillColor: heat ?? '#8b5cf6',
      fillOpacity: hover ? 0.32 : heat ? 0.2 : 0.06,
      className: 'district'
    }
  }

  const tooltipHtml = (alias: string): string => {
    const s = live.current.stats[alias]
    const name = live.current.names.get(alias) ?? alias
    const sel = live.current.selected.has(alias)
    const rows = s?.listings
      ? `<div class="dm-row"><span>Медиана</span><b>${fmtMoney(s.medianUnit)}${live.current.unitLabel}</b></div>
         <div class="dm-row"><span>Объявлений</span><b>${s.listings}</b></div>`
      : `<div class="dm-muted">ещё не сканировали</div>`
    const an = s?.anomalies7d ? `<div class="dm-row dm-hot"><span>Аномалий за 7 дн.</span><b>${s.anomalies7d}</b></div>` : ''
    return `<div class="dm-title">${name}</div>${rows}${an}<div class="dm-hint">${sel ? '✓ выбран · клик — убрать' : 'клик — добавить в детектор'}</div>`
  }

  // карта создаётся один раз
  useEffect(() => {
    if (!boxRef.current) return
    const map = L.map(boxRef.current, { zoomControl: false, attributionControl: true, minZoom: 9, maxZoom: 16 })
    // без начального вида flyToBounds падает с «Set map center and zoom first»
    map.setView(city.center, city.zoom)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    // стандартные тайлы OSM без ключа; тёмная тема — CSS-фильтром (.dm-tiles в styles.css)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'dm-tiles',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      layersRef.current.clear()
      badgesRef.current = null
    }
  }, [])

  // слой районов — на смену города
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const feats = FEATURES.filter((f) => f.properties.city === city.id)
    layersRef.current.clear()
    const layer = L.geoJSON(feats as unknown as GeoJSON.GeoJsonObject, {
      style: (f) => styleFor((f as DistrictFeature).properties.alias),
      onEachFeature: (f, l) => {
        const alias = (f as DistrictFeature).properties.alias
        const path = l as L.Path
        layersRef.current.set(alias, path)
        path.bindTooltip(() => tooltipHtml(alias), { sticky: true, direction: 'top', className: 'dm-tip', opacity: 1 })
        path.on({
          mouseover: () => {
            hoverRef.current = alias
            // без bringToFront: перестановка SVG-узла под курсором съедает первый клик
            path.setStyle(styleFor(alias))
          },
          mouseout: () => {
            hoverRef.current = null
            path.setStyle(styleFor(alias))
          },
          click: () => live.current.onToggle(alias)
        })
      }
    }).addTo(map)
    const badges = L.layerGroup().addTo(map)
    badgesRef.current = badges
    const bounds = layer.getBounds()
    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [24, 24], duration: 0.8 })
    else map.setView(city.center, city.zoom)
    return () => {
      layer.remove()
      badges.remove()
    }
    // styleFor/tooltipHtml читают актуальное через ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.id])

  // перекраска и подписи — на любое изменение выбора/статистики
  useEffect(() => {
    for (const [alias, path] of layersRef.current) {
      path.setStyle(styleFor(alias))
      path.setTooltipContent(tooltipHtml(alias))
      // выбранные — поверх соседей, чтобы их контур не перекрывался
      if (selected.has(alias)) path.bringToFront()
    }
    const badges = badgesRef.current
    if (!badges) return
    badges.clearLayers()
    for (const [alias, path] of layersRef.current) {
      const center = (path as unknown as L.Polygon).getBounds().getCenter()
      const n = stats[alias]?.anomalies7d ?? 0
      const sel = selected.has(alias)
      const html = `<div class="dm-label ${sel ? 'is-sel' : ''}">${sel ? '✓ ' : ''}${shortName(names.get(alias) ?? alias)}${
        n ? `<span class="dm-badge">${n}</span>` : ''
      }</div>`
      L.marker(center, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'dm-label-wrap', html, iconSize: [0, 0] })
      }).addTo(badges)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, watched, stats, range, city.id, unitLabel])

  const hasHeat = Number.isFinite(range.lo)

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-2xl border border-white/10">
      <div ref={boxRef} className="absolute inset-0 bg-ink" />
      {hasHeat && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-xl border border-white/10 bg-ink/80 px-3 py-2 text-[10px] text-white/55 backdrop-blur">
          <div className="mb-1 font-semibold uppercase tracking-wider">медиана ₸{unitLabel}</div>
          <div className="flex items-center gap-2">
            <span>{fmtMoney(range.lo)}</span>
            <div className="flex h-1.5 w-24 overflow-hidden rounded-full">
              {HEAT.map((c) => (
                <span key={c} className="flex-1" style={{ background: c }} />
              ))}
            </div>
            <span>{fmtMoney(range.hi)}</span>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute right-3 top-3 z-[500] flex flex-col items-end gap-1 text-[10px] text-white/55">
        <span className="rounded-lg bg-ink/80 px-2 py-1 backdrop-blur"><span className="text-cy">■</span> выбран</span>
        <span className="rounded-lg bg-ink/80 px-2 py-1 backdrop-blur"><span className="text-vio">┅</span> уже в другом скане</span>
      </div>
    </div>
  )
}
