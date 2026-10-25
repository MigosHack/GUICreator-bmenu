import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Project, SlotData, BMenuSlotMeta } from '@/types'
import { parseMM, seg2mm } from '@/utils/minimessage'
import { defSlot, newProject } from '@/utils/slot'
import { getGuiType } from '@/data/guiTypes'

/**
 * Импорт / экспорт меню плагина BMenu (YAML: id, provider, type, size, title, items).
 *
 * Всё, что редактор не умеет показывать (on_click, oneOf, args, animation, ...),
 * сохраняется в project.bmenu / slot.bmenu и возвращается при экспорте.
 * Строки с неизвестными редактору тегами (<primary>, <alt:..>, {args}, %papi%)
 * экспортируются в исходном виде, пока их не изменили в редакторе.
 */

type Obj = Record<string, unknown>

/** Ключи предмета, которые редактор разбирает сам */
const HANDLED_ITEM_KEYS = new Set(['slot', 'slots', 'material', 'name', 'lore', 'amount', 'enchanted', 'model_data', 'trim'])
const HANDLED_MENU_KEYS = new Set(['title', 'size', 'type', 'items'])

/** BMenu (Bukkit InventoryType) -> guiType редактора */
const TYPE_TO_GUI: Record<string, string> = {
  hopper: 'hopper', dispenser: 'dispenser', dropper: 'dispenser', workbench: 'crafting',
  furnace: 'furnace', anvil: 'anvil', brewing: 'brewing', enchanting: 'enchanting',
  stonecutter: 'stonecutter', cartography: 'cartography', smithing: 'smithing',
  loom: 'loom', grindstone: 'grindstone',
}
const GUI_TO_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_TO_GUI).filter(([k]) => k !== 'dropper').map(([k, v]) => [v, k]),
)

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Похоже ли на BMenu-конфиг: YAML-объект с items в виде map */
export function looksLikeBMenu(raw: string): boolean {
  try {
    const doc = parseYaml(raw)
    if (!isObj(doc) || !isObj(doc.items)) return false
    if ('id' in doc || 'provider' in doc) return true
    return Object.values(doc.items).some(it => isObj(it) && ('slot' in it || 'slots' in it))
  } catch {
    return false
  }
}

/** "0-8,10, 12" | 5 | ['1','3-4'] -> [0..8,10,12] (как AnimationUtil.readSlots) */
export function readSlots(v: unknown): number[] {
  if (v === undefined || v === null) return []
  const str = Array.isArray(v) ? v.join(',') : String(v)
  const out: number[] = []
  for (const part of str.replace(/\s+/g, '').split(',')) {
    if (!part) continue
    const m = part.match(/^(-?\d+)-(-?\d+)$/)
    if (m) {
      let a = Number(m[1]), b = Number(m[2])
      if (a > b) [a, b] = [b, a]
      for (let i = a; i <= b; i++) out.push(i)
    } else if (/^-?\d+$/.test(part)) {
      out.push(Number(part))
    }
  }
  return out
}

/** [0,1,2,5,7,8] -> "0-2,5,7-8" */
export function writeSlots(slots: number[]): string | number {
  const s = [...new Set(slots)].sort((a, b) => a - b)
  if (s.length === 1) return s[0]
  const parts: string[] = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    parts.push(j > i ? `${s[i]}-${s[j]}` : String(s[i]))
    i = j
  }
  return parts.join(',')
}

/** & / § коды -> MiniMessage, чтобы parseMM их понял */
const LEGACY: Record<string, string> = {
  '0': 'black', '1': 'dark_blue', '2': 'dark_green', '3': 'dark_aqua', '4': 'dark_red', '5': 'dark_purple',
  '6': 'gold', '7': 'gray', '8': 'dark_gray', '9': 'blue', a: 'green', b: 'aqua', c: 'red', d: 'light_purple',
  e: 'yellow', f: 'white', k: 'obfuscated', l: 'bold', m: 'strikethrough', n: 'underlined', o: 'italic', r: 'reset',
}
function legacyToMM(s: string): string {
  return s
    .replace(/[&§]#([0-9a-fA-F]{6})/g, '<#$1>')
    .replace(/[&§]([0-9a-fk-orA-FK-OR])/g, (_, c: string) => `<${LEGACY[c.toLowerCase()]}>`)
}
const toSegs = (s: string) => parseMM(legacyToMM(s))

function loreLines(v: unknown): string[] {
  if (v === undefined || v === null) return []
  const list = Array.isArray(v) ? v : [v]
  return list.flatMap(l => String(l ?? '').split('\n'))
}

function skinUrlFromBase64(b64: string): string | null {
  try {
    const json = JSON.parse(atob(b64))
    return json?.textures?.SKIN?.url ?? null
  } catch {
    return null
  }
}
const skinBase64FromUrl = (url: string) => btoa(JSON.stringify({ textures: { SKIN: { url } } }))

function slotKey(project: Project, n: number): string {
  return project.guiType ? String(n) : `${Math.floor(n / 9)}-${n % 9}`
}

function slotNumber(project: Project, key: string): number {
  if (project.guiType) return Number(key)
  const [r, c] = key.split('-').map(Number)
  return r * 9 + c
}

// ---------------------------------------------------------------- Import

export function parseBMenu(raw: string): Project | null {
  let doc: unknown
  try { doc = parseYaml(raw) } catch { return null }
  if (!isObj(doc) || !isObj(doc.items)) return null

  const type = String(doc.type ?? 'chest').toLowerCase()
  const guiType = TYPE_TO_GUI[type]
  const size = Number(doc.size ?? 54)
  const rows = Math.min(6, Math.max(1, Math.ceil((Number.isFinite(size) ? size : 54) / 9)))
  const rawTitle = doc.title !== undefined ? String(doc.title) : ''

  const titlePlain = toSegs(rawTitle).map(s => s.text).join('')
  const idName = typeof doc.id === 'string' ? doc.id : ''
  const project = newProject(titlePlain || idName || 'BMenu', rows)
  if (guiType && getGuiType(guiType)) project.guiType = guiType

  const extra: Obj = {}
  for (const [k, v] of Object.entries(doc)) if (!HANDLED_MENU_KEYS.has(k)) extra[k] = v
  const unplaced: Obj = {}

  for (const [key, value] of Object.entries(doc.items)) {
    if (!isObj(value)) continue
    const slots = readSlots(value.slot ?? value.slots).filter(n => n >= 0)
    if (!slots.length) { unplaced[key] = value; continue }
    const data = itemToSlot(key, value)
    for (const n of slots) project.slots[slotKey(project, n)] = structuredClone(data)
  }

  project.bmenu = { rawTitle, extra, ...(Object.keys(unplaced).length ? { unplaced } : {}) }
  return project
}

function itemToSlot(key: string, it: Obj): SlotData {
  let material = String(it.material ?? 'stone')
  let skullTexture: string | null = null
  const extra: Obj = {}

  if (/^basehead-/i.test(material)) {
    skullTexture = skinUrlFromBase64(material.slice('basehead-'.length))
    if (!skullTexture) extra.material = material // не смогли разобрать — оставим как есть
    material = 'player_head'
  } else if (/^player-/i.test(material)) {
    extra.material = material
    material = 'player_head'
  }

  const slot = defSlot(material.toLowerCase().replace(/^minecraft:/, ''))

  const rawName = it.name !== undefined ? String(it.name) : undefined
  const rawLore = it.lore !== undefined ? loreLines(it.lore) : undefined
  slot.displayName = rawName !== undefined ? toSegs(rawName) : []
  slot.lore = (rawLore ?? []).map(toSegs)

  const amount = Number(it.amount)
  if (Number.isInteger(amount) && amount > 0) slot.amount = amount
  else if (it.amount !== undefined) extra.amount = it.amount // плейсхолдер вроде {count}

  slot.enchanted = it.enchanted === true
  if (typeof it.model_data === 'number') slot.customModelData = it.model_data
  else if (it.model_data !== undefined) extra.model_data = it.model_data
  if (isObj(it.trim) && it.trim.material && it.trim.pattern) {
    slot.armorTrim = { material: String(it.trim.material), pattern: String(it.trim.pattern) }
  }
  slot.skullTexture = skullTexture

  for (const [k, v] of Object.entries(it)) if (!HANDLED_ITEM_KEYS.has(k)) extra[k] = v

  const meta: BMenuSlotMeta = {
    key,
    rawName,
    rawLore,
    mmName: seg2mm(slot.displayName),
    mmLore: slot.lore.map(seg2mm),
    ...(Object.keys(extra).length ? { extra } : {}),
  }
  slot.bmenu = meta
  return slot
}

// ---------------------------------------------------------------- Export

export interface BMenuExportOptions {
  /** id меню (ns:key). По умолчанию — из импорта или custom:<имя> */
  id?: string
}

export function defaultBMenuId(project: Project): string {
  const imported = project.bmenu?.extra.id
  if (typeof imported === 'string' && imported) return imported
  const key = project.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return `custom:${key || 'menu'}`
}

export function toBMenu(project: Project, opts: BMenuExportOptions = {}): string {
  const gt = getGuiType(project.guiType)
  const meta = project.bmenu
  const doc: Obj = {}

  // порядок ключей как в файлах BMenu
  doc.id = opts.id ?? defaultBMenuId(project)
  doc.provider = meta?.extra.provider ?? 'default'
  doc.type = gt ? (GUI_TO_TYPE[gt.id] ?? 'chest') : 'chest'
  doc.size = gt ? gt.slots.length : project.rows * 9

  const titleSegs = meta?.rawTitle !== undefined ? toSegs(meta.rawTitle) : []
  const titleChanged = titleSegs.map(s => s.text).join('') !== project.name
  doc.title = meta?.rawTitle !== undefined && !titleChanged ? meta.rawTitle : project.name

  for (const [k, v] of Object.entries(meta?.extra ?? {})) if (!(k in doc)) doc[k] = v

  // группируем одинаковые предметы в один ключ со списком слотов
  const groups: Array<{ key: string; item: Obj; slots: number[]; sig: string }> = []
  const usedKeys = new Set<string>()
  const keys = Object.keys(project.slots).sort((a, b) => slotNumber(project, a) - slotNumber(project, b))
  for (const k of keys) {
    const item = slotToItem(project.slots[k])
    const sig = JSON.stringify(item)
    const base = project.slots[k].bmenu?.key ?? project.slots[k].itemId
    const same = groups.find(g => g.sig === sig && (g.key === base || g.key.startsWith(`${base}_`)))
    if (same) { same.slots.push(slotNumber(project, k)); continue }
    let name = base
    for (let i = 2; usedKeys.has(name); i++) name = `${base}_${i}`
    usedKeys.add(name)
    groups.push({ key: name, item, slots: [slotNumber(project, k)], sig })
  }

  const items: Obj = {}
  for (const g of groups) items[g.key] = { slot: writeSlots(g.slots), ...g.item }
  for (const [k, v] of Object.entries(meta?.unplaced ?? {})) {
    let name = k
    for (let i = 2; name in items; i++) name = `${k}_${i}`
    items[name] = v
  }
  doc.items = items

  return stringifyYaml(doc, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' })
}

function slotToItem(sl: SlotData): Obj {
  const meta = sl.bmenu
  const item: Obj = {}
  const extra = { ...(meta?.extra ?? {}) }

  if (extra.material !== undefined) { item.material = extra.material; delete extra.material }
  else if (sl.itemId === 'player_head' && sl.skullTexture) item.material = `basehead-${skinBase64FromUrl(sl.skullTexture)}`
  else item.material = sl.itemId

  const mmName = seg2mm(sl.displayName)
  if (meta?.rawName !== undefined && mmName === meta.mmName) item.name = meta.rawName
  else if (sl.displayName.length) item.name = mmName

  const mmLore = sl.lore.map(seg2mm)
  const loreUnchanged = meta?.rawLore !== undefined && JSON.stringify(mmLore) === JSON.stringify(meta.mmLore)
  if (loreUnchanged) item.lore = meta!.rawLore
  else if (mmLore.length) item.lore = mmLore

  if (extra.amount !== undefined && sl.amount === 1) { item.amount = extra.amount }
  else if (sl.amount > 1) item.amount = sl.amount
  delete extra.amount

  if (sl.enchanted) item.enchanted = true
  if (extra.model_data !== undefined && sl.customModelData === null) item.model_data = extra.model_data
  else if (sl.customModelData !== null) item.model_data = sl.customModelData
  delete extra.model_data
  if (sl.armorTrim) item.trim = { ...sl.armorTrim }

  return { ...item, ...extra }
}
