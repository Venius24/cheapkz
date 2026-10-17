/**
 * Справочники для детектора аномалий: районы Krisha.kz и категории Kaspi.
 * Алиасы районов — это сегменты URL выдачи Krisha (krisha.kz/arenda/kvartiry/<alias>/),
 * коды категорий — значение фильтра :category: в каталоге Kaspi.
 * Геометрия районов для карты лежит отдельно в web/src/geo/kz-districts.json.
 */

export interface District {
  alias: string
  name: string
}

export interface City {
  id: string
  name: string
  /** id города в Kaspi (цены и наличие зависят от города) */
  kaspiCity: string
  center: [lat: number, lon: number]
  zoom: number
  districts: District[]
}

export const CITIES: City[] = [
  {
    id: 'almaty',
    name: 'Алматы',
    kaspiCity: '710000000',
    center: [43.238, 76.89],
    zoom: 11,
    districts: [
      { alias: 'almaty-alatauskij', name: 'Алатауский р-н' },
      { alias: 'almaty-almalinskij', name: 'Алмалинский р-н' },
      { alias: 'almaty-aujezovskij', name: 'Ауэзовский р-н' },
      { alias: 'almaty-bostandykskij', name: 'Бостандыкский р-н' },
      { alias: 'almaty-zhetysuskij', name: 'Жетысуский р-н' },
      { alias: 'almaty-medeuskij', name: 'Медеуский р-н' },
      { alias: 'almaty-nauryzbajskiy', name: 'Наурызбайский р-н' },
      { alias: 'almaty-turksibskij', name: 'Турксибский р-н' }
    ]
  },
  {
    id: 'astana',
    name: 'Астана',
    kaspiCity: '750000000',
    center: [51.15, 71.44],
    zoom: 11,
    districts: [
      { alias: 'astana-almatinskij', name: 'р-н Алматы' },
      { alias: 'astana-esilskij', name: 'Есильский р-н' },
      { alias: 'astana-nura', name: 'р-н Нура' },
      { alias: 'r-n-bajkonur', name: 'р-н Байконур' },
      { alias: 'astana-saraishyk', name: 'р-н Сарайшык' },
      { alias: 'astana-saryarkinskij', name: 'р-н Сарыарка' }
    ]
  },
  {
    id: 'shymkent',
    name: 'Шымкент',
    kaspiCity: '511010000',
    center: [42.33, 69.6],
    zoom: 11,
    districts: [
      { alias: 'shymkent-abajskij', name: 'Абайский р-н' },
      { alias: 'shymkent-al-farabijskij', name: 'Аль-Фарабийский р-н' },
      { alias: 'shymkent-enbekshinskij', name: 'Енбекшинский р-н' },
      { alias: 'karatauskij', name: 'Каратауский р-н' },
      { alias: 'shymkent-turan', name: 'р-н Туран' }
    ]
  }
]

const DISTRICT_INDEX = new Map<string, { district: District; city: City }>(
  CITIES.flatMap((city) => city.districts.map((district) => [district.alias, { district, city }] as const))
)

export function findDistrict(alias: string): { district: District; city: City } | undefined {
  return DISTRICT_INDEX.get(alias)
}

export function findCity(id: string): City | undefined {
  return CITIES.find((c) => c.id === id)
}

export interface KaspiCategory {
  code: string
  name: string
  group: string
  icon: string
}

/** Коды проверены на живом каталоге Kaspi (фильтр :category: регистронезависим). */
export const KASPI_CATEGORIES: KaspiCategory[] = [
  { code: 'Smartphones', name: 'Смартфоны', group: 'Гаджеты', icon: '📱' },
  { code: 'Smart watches', name: 'Смарт-часы', group: 'Гаджеты', icon: '⌚' },
  { code: 'Headphones', name: 'Наушники', group: 'Гаджеты', icon: '🎧' },
  { code: 'Tablets', name: 'Планшеты', group: 'Гаджеты', icon: '📲' },
  { code: 'Portable speakers', name: 'Портативные колонки', group: 'Гаджеты', icon: '🔊' },
  { code: 'Smart speakers', name: 'Умные колонки', group: 'Гаджеты', icon: '🗣' },
  { code: 'Action cameras', name: 'Экшн-камеры', group: 'Гаджеты', icon: '📷' },
  { code: 'Notebooks', name: 'Ноутбуки', group: 'Компьютеры', icon: '💻' },
  { code: 'Monitors', name: 'Мониторы', group: 'Компьютеры', icon: '🖥' },
  { code: 'Videocards', name: 'Видеокарты', group: 'Компьютеры', icon: '🎮' },
  { code: 'Hard drives', name: 'SSD и диски', group: 'Компьютеры', icon: '💾' },
  { code: 'Mice', name: 'Мыши', group: 'Компьютеры', icon: '🖱' },
  { code: 'Keyboards', name: 'Клавиатуры', group: 'Компьютеры', icon: '⌨️' },
  { code: 'Game consoles', name: 'Игровые приставки', group: 'ТВ и развлечения', icon: '🕹' },
  { code: 'TVs', name: 'Телевизоры', group: 'ТВ и развлечения', icon: '📺' },
  { code: 'Refrigerators', name: 'Холодильники', group: 'Техника для дома', icon: '🧊' },
  { code: 'Washers', name: 'Стиральные машины', group: 'Техника для дома', icon: '🫧' },
  { code: 'Dishwashers', name: 'Посудомоечные машины', group: 'Техника для дома', icon: '🍽' },
  { code: 'Air conditioners', name: 'Кондиционеры', group: 'Техника для дома', icon: '❄️' },
  { code: 'Vacuum cleaners', name: 'Пылесосы', group: 'Техника для дома', icon: '🧹' },
  { code: 'Robot vacuum cleaners', name: 'Роботы-пылесосы', group: 'Техника для дома', icon: '🤖' },
  { code: 'Coffee machines', name: 'Кофемашины', group: 'Кухня', icon: '☕' },
  { code: 'Microwave ovens', name: 'Микроволновки', group: 'Кухня', icon: '🍲' },
  { code: 'Blenders', name: 'Блендеры', group: 'Кухня', icon: '🥤' },
  { code: 'Hair dryers', name: 'Фены', group: 'Красота', icon: '💨' },
  { code: 'Shavers', name: 'Электробритвы', group: 'Красота', icon: '🪒' },
  { code: 'Perfumes', name: 'Парфюмерия', group: 'Красота', icon: '🌸' },
  { code: 'Bicycles', name: 'Велосипеды', group: 'Спорт и авто', icon: '🚲' },
  { code: 'Tires', name: 'Шины', group: 'Спорт и авто', icon: '🛞' }
]

export function findKaspiCategory(code: string): KaspiCategory | undefined {
  const c = code.toLowerCase()
  return KASPI_CATEGORIES.find((x) => x.code.toLowerCase() === c)
}

/** Код категории допускает только буквы, цифры, пробел, _ и - (он подставляется в фильтр запроса). */
export function isValidCategoryCode(code: string): boolean {
  return /^[A-Za-z0-9 _-]{2,48}$/.test(code)
}
