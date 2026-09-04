import { describe, expect, it } from 'vitest'
import { buildAlertMessage, buildDigestMessage } from '../src/core/format.js'
import { hotScore } from '../src/core/hotScore.js'
import { money, escapeHtml, numLoose, inQuietRange, chunkText, deltaPct } from '../src/util.js'

describe('format', () => {
  const score = hotScore({ price: 50, oldPrice: 100, history: [100, 99, 98, 97, 96], isNew: true })

  it('hot-алерт содержит «ЛОВИ СЕЙЧАС», цену и ссылку', () => {
    const msg = buildAlertMessage(
      {
        watcher: { id: 7, title: 'Айфон <мечты>', kind: 'kaspi', target_price: 60, drop_pct: null, url: 'https://kaspi.kz/p/x/1/' },
        offer: { externalId: '1', title: 'iPhone 15', url: 'https://kaspi.kz/p/x/1/', price: 50, oldPrice: 100, currency: 'KZT' },
        score
      },
      'цена достигла вашей цели'
    )
    expect(msg).toContain('ЛОВИ СЕЙЧАС')
    expect(msg).toContain('50\u2009₸')
    expect(msg).toContain('открыть')
    expect(msg).toContain('&lt;мечты&gt;') // экранирование HTML
    expect(msg).toContain('цель')
  })

  it('дайджест собирает список', () => {
    const d = buildDigestMessage('CheapKZ', [
      { level: 'hot', message: '', title: 'A' },
      { level: 'cool', message: '', title: 'B' }
    ])
    expect(d).toContain('Дайджест CheapKZ')
    expect(d).toContain('алертов: <b>2</b>')
    expect(d).toContain('🔥 A')
  })
})

describe('util', () => {
  it('money группирует разряды и подбирает символ', () => {
    expect(money(199990)).toBe('199\u2009990\u2009₸')
    expect(money(1000, 'USD')).toBe('1\u2009000\u2009$')
    expect(money(null)).toBe('—')
  })
  it('numLoose парсит грязные строки', () => {
    expect(numLoose('200 000 тг')).toBe(200000)
    expect(numLoose('от 145 000 ₸')).toBe(145000)
    expect(numLoose('нет цены')).toBeNull()
    expect(numLoose(42.5)).toBe(42.5)
  })
  it('deltaPct считает снижение', () => {
    expect(deltaPct(200, 150)).toBeCloseTo(25)
    expect(deltaPct(0, 10)).toBe(0)
  })
  it('тихие часы через полночь', () => {
    expect(inQuietRange('23:30', '23:00', '07:00')).toBe(true)
    expect(inQuietRange('03:00', '23:00', '07:00')).toBe(true)
    expect(inQuietRange('12:00', '23:00', '07:00')).toBe(false)
    expect(inQuietRange('12:00', null, null)).toBe(false)
  })
  it('chunkText режет длинные строки', () => {
    const parts = chunkText('x'.repeat(5000), 3800)
    expect(parts.length).toBe(2)
    expect(parts[0].length).toBe(3800)
  })
  it('escapeHtml экранирует и кавычки — иначе URL ломает атрибут href', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })
})

describe('безопасность сообщений', () => {
  it('кавычка в URL объявления не ломает атрибут href', () => {
    const msg = buildAlertMessage(
      {
        watcher: { id: 1, title: 'Тест', kind: 'olx', target_price: null, drop_pct: null, url: 'https://olx.kz' },
        offer: {
          externalId: '1',
          title: 'Товар',
          url: 'https://olx.kz/a" onmouseover="alert(1)',
          price: 100,
          currency: 'KZT'
        },
        score: { score: 50, level: 'warm', parts: {}, reason: 'причина' }
      },
      ''
    )
    expect(msg).not.toContain('onmouseover="')
    expect(msg).toContain('&quot;')
  })

  it('теги в названии объявления не проходят в HTML', () => {
    const msg = buildAlertMessage(
      {
        watcher: { id: 1, title: 'Тест', kind: 'olx', target_price: null, drop_pct: null, url: 'https://olx.kz' },
        offer: { externalId: '1', title: '<b>жирный</b>', url: 'https://olx.kz/a', price: 100 },
        score: { score: 50, level: 'warm', parts: {}, reason: 'причина' }
      },
      ''
    )
    expect(msg).toContain('&lt;b&gt;')
  })
})
