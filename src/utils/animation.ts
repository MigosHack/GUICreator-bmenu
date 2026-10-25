import type { AnimationFrame, Project, SlotData } from '@/types'
import { getGuiType } from '@/data/guiTypes'
import { ITEM_DB } from '@/data/items'
import { TEX_MAP } from '@/data/texMap'
import { buildBMenuItems, itemToSlot } from './bmenu'
import { defSlot } from './slot'

// BMenu Animator / FrameOpcodes, By1337/BMenu dc1412d.
export const MAX_ANIMATION_TICK = 2_147_483_646
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const validTick = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_ANIMATION_TICK

export const ANIMATION_OPS = [
  { key: 'set', label: 'Установить предмет', hint: 'Предмет или ID из items и слоты: diamond 0-8', value: 'diamond 0' },
  { key: 'remove', label: 'Убрать с анимационного слоя', hint: 'Слоты: 0-8,13. Под ними снова виден основной слой.', value: '0' },
  { key: 'copy', label: 'Копировать', hint: 'Из слотов → в слоты: 0 1-8. Также: 0++', value: '0 1' },
  { key: 'move', label: 'Переместить', hint: 'Из слотов → в слоты: 0-2 9-11 (одинаковое количество)', value: '0 1' },
  { key: 'swap', label: 'Swap', hint: 'Две группы слотов: 0 1', value: '0 1' },
  { key: 'fill', label: 'Заполнить меню', hint: 'Материал или ID из items: black_stained_glass_pane', value: 'black_stained_glass_pane' },
  { key: 'set-if-empty', label: 'Установить в пустой слот', hint: 'Предмет и слоты: diamond 0-8 (проверяется слой анимации)', value: 'diamond 0' },
  { key: 'remove-if-not-empty', label: 'Убрать над основным предметом', hint: 'Слоты: 0-8 (проверяется основной слой)', value: '0' },
  { key: 'copy-from-base', label: 'Копировать с основного слоя', hint: 'Из слотов → в слоты: 0-8 0-8', value: '0 0' },
  { key: 'title', label: 'Заголовок меню', hint: 'Текст с MiniMessage: <gold>Готово!', value: '<gold>Готово!' },
  { key: 'sound', label: 'Звук', hint: 'Звук, громкость, высота: ui.button.click 1 1', value: 'ui.button.click 1 1' },
  { key: 'commands', label: 'Команды BMenu', hint: 'Одна команда на строку, например: [message] Готово!', value: '[message] Готово!' },
  { key: 'goto', label: 'Перейти к тику', hint: 'Номер следующего тика. Для цикла укажите 0.', value: 0 },
] as const
const MATERIALS = new Set([...Object.keys(TEX_MAP), ...Object.values(ITEM_DB).flatMap(category => category.items.map(item => item.id)), 'air', 'cave_air', 'void_air'])
const ALIASES: Record<string, string> = { st: 'set', rm: 'remove', mv: 'move', sw: 'swap', cl: 'copy', cpy: 'copy', gt: 'goto', snd: 'sound', cmd: 'commands', ttl: 'title', fl: 'fill', rne: 'remove-if-not-empty', cfb: 'copy-from-base', sie: 'set-if-empty' }
export const opcodeName = (name: string) => ALIASES[name] ?? name

export function animationNames(project: Project): string[] {
  const named = project.bmenu?.extra.animations
  return isRecord(named) ? Object.keys(named) : []
}

export function readAnimation(project: Project, name = ''): { frames: AnimationFrame[]; error?: string } {
  const extra = project.bmenu?.extra
  const named = extra?.animations
  const raw = name ? (isRecord(named) && Object.prototype.hasOwnProperty.call(named, name) ? named[name] : undefined) : extra?.animation
  if (raw === undefined) return { frames: [] }
  if (!Array.isArray(raw)) return { frames: [], error: 'Анимация должна быть списком кадров BMenu. Исходные данные сохранены.' }
  const frames: AnimationFrame[] = []
  let lastTick = 0
  for (const value of raw) {
    if (!isRecord(value)) return { frames: [], error: 'Некорректный кадр. Исходные данные сохранены.' }
    const tick = value.tick === undefined ? lastTick + 1 : Number(value.tick)
    if ((typeof value.tick === 'string' && !/^\d+$/.test(value.tick.trim())) || !validTick(tick) || (value.tick !== undefined && !['string', 'number'].includes(typeof value.tick)) || (value.opcodes !== undefined && (!Array.isArray(value.opcodes) || !value.opcodes.every(isRecord)))) {
      return { frames: [], error: 'Проверьте tick и список opcodes в исходной анимации. Исходные данные сохранены.' }
    }
    frames.push({ ...value, tick, opcodes: (value.opcodes ?? []) as Record<string, unknown>[] })
    lastTick = tick
  }
  return { frames }
}

export interface AnimationEnvironment {
  base: (SlotData | undefined)[]
  items: Record<string, unknown>
  title: string
}
export interface AnimationState {
  tick: number
  nextTick: number
  layer: (SlotData | undefined)[]
  title: string
  events: string[]
  warnings: string[]
}

export function animationEnvironment(project: Project): AnimationEnvironment {
  const gt = getGuiType(project.guiType)
  const keys = gt ? gt.slots.map(s => s.key) : Array.from({ length: project.rows * 9 }, (_, i) => `${Math.floor(i / 9)}-${i % 9}`)
  return { base: keys.map(k => project.slots[k]), items: buildBMenuItems(project), title: project.name }
}
export function initialAnimation(env: AnimationEnvironment): AnimationState {
  return { tick: -1, nextTick: 0, layer: Array(env.base.length).fill(undefined), title: env.title, events: [], warnings: [] }
}
export function lastAnimationTick(frames: AnimationFrame[]): number {
  return frames.reduce((max, f) => Math.max(max, f.tick), 0)
}

/** Bounded expansion: malformed or huge ranges cannot freeze the editor. */
function slots(value: string, size: number): number[] {
  const parts = value.replace(/\s+/g, '').split(',')
  const result: number[] = []
  for (const part of parts) {
    if (!/^\d+(?:-\d+)?$/.test(part)) throw new Error('Слоты задаются числами и диапазонами, например 0-8,13.')
    const [a, b = a] = part.split('-').map(Number)
    if (a >= size || b >= size) throw new Error(`Номер слота должен быть от 0 до ${size - 1}.`)
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) result.push(i)
  }
  return result
}
function pair(value: string, size: number): [number[], number[]] {
  const short = value.trim().match(/^(\d+)(\+\+|--)$/)
  if (short) {
    const n = Number(short[1])
    return [slots(String(n), size), slots(String(n + (short[2] === '++' ? 1 : -1)), size)]
  }
  const parts = value.trim().split(/\s+/)
  if (parts.length > 2) throw new Error('Укажите две группы слотов через пробел.')
  return [slots(parts[0], size), slots(parts[1] ?? parts[0], size)]
}
function scalar(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Ожидается текст или число.')
  return String(value)
}

export function validateOpcode(name: string, value: unknown, size: number): string | null {
  const op = opcodeName(name)
  try {
    if (op === 'commands') {
      if (value == null || typeof value === 'boolean' || (Array.isArray(value) && !value.length)) throw new Error('Укажите команды BMenu.')
      if (typeof value === 'string' && !value.trim()) throw new Error('Укажите хотя бы одну команду.')
      return null
    }
    if (op === 'goto') {
      if (!['number', 'string'].includes(typeof value) || !String(value).trim() || !validTick(Number(value))) throw new Error('Тик должен быть целым неотрицательным числом.')
      return null
    }
    const text = scalar(value)
    if (op === 'title') return null
    if (!text.trim()) throw new Error('Укажите значение действия.')
    if (op === 'set' || op === 'set-if-empty') {
      const match = text.trim().match(/^(\S+)\s+(.+)$/)
      if (!match) throw new Error('Укажите предмет и слоты, например diamond 0-8.')
      slots(match[2], size)
    } else if (op === 'remove' || op === 'remove-if-not-empty') slots(text, size)
    else if (['copy', 'copy-from-base', 'move', 'swap'].includes(op)) {
      const [from, to] = pair(text, size)
      if ((op === 'move' || op === 'swap') && from.length !== to.length) throw new Error('Количество исходных и целевых слотов должно совпадать.')
    } else if (op === 'sound') {
      const parts = text.trim().split(/\s+/)
      if (parts.length > 3 || parts.slice(1).some(x => !Number.isFinite(Number(x)) || Number(x) < 0)) throw new Error('Формат: ui.button.click 1 1; громкость и высота — неотрицательные числа.')
    } else if (op !== 'fill') throw new Error(`Действие ${name} сохранится, но не поддерживается в предпросмотре.`)
    return null
  } catch (error) { return (error as Error).message }
}

function resolveItem(id: string, env: AnimationEnvironment, warnings: string[]): SlotData | undefined {
  const raw = Object.prototype.hasOwnProperty.call(env.items, id) ? env.items[id] : undefined
  if (isRecord(raw)) {
    if (['oneOf', 'requirements', 'view_requirement', 'if'].some(k => k in raw)) warnings.push(`Условия предмета «${id}» вычисляются только на сервере.`)
    return itemToSlot(id, raw)
  }
  const material = id.toLowerCase().replace(/^minecraft:/, '')
  if (!MATERIALS.has(material)) {
    warnings.push(`Предмет «${id}» не найден локально. Ссылки, условия и плейсхолдеры требуют BMenu.`)
    return undefined
  }
  return defSlot(material)
}

/** One actual BMenu tick, including goto. Never execute server commands in the browser. */
export function stepAnimation(env: AnimationEnvironment, frames: AnimationFrame[], previous: AnimationState, tick = previous.nextTick): AnimationState {
  const state: AnimationState = { ...previous, layer: [...previous.layer], tick, nextTick: tick + 1, events: [], warnings: [] }
  for (const frame of frames) {
    if (frame.tick !== tick) continue
    for (const entry of frame.opcodes) for (const [name, value] of Object.entries(entry)) {
      const error = validateOpcode(name, value, env.base.length)
      if (error) { state.warnings.push(`${name}: ${error}`); continue }
      const op = opcodeName(name)
      const text = String(value)
      switch (op) {
        case 'goto': state.nextTick = Number(value); break
        case 'title': state.title = text; break
        case 'commands': state.events.push(`Команды: ${typeof value === 'string' ? value : JSON.stringify(value)}`); break
        case 'sound': state.events.push(`Звук: ${text}`); break
        case 'fill': {
          const item = resolveItem(text.trim(), env, state.warnings)
          if (item) state.layer.fill(item)
          break
        }
        case 'set': case 'set-if-empty': {
          const [, id, targets] = text.trim().match(/^(\S+)\s+(.+)$/)!
          const item = resolveItem(id, env, state.warnings)
          if (item) for (const n of slots(targets, env.base.length)) if (op === 'set' || !state.layer[n]) state.layer[n] = item
          break
        }
        case 'remove': case 'remove-if-not-empty':
          for (const n of slots(text, env.base.length)) if (op === 'remove' || env.base[n]) state.layer[n] = undefined
          break
        case 'copy': case 'copy-from-base': case 'move': case 'swap': {
          const [from, to] = pair(text, env.base.length)
          // Current upstream SwapAnimOpcode has the same implementation as move.
          if (op === 'swap') state.warnings.push('В текущем BMenu swap работает как move; предпросмотр повторяет это поведение.')
          for (let i = 0; i < to.length; i++) {
            const source = from[Math.min(i, from.length - 1)]
            state.layer[to[i]] = (op === 'copy-from-base' ? env.base : state.layer)[source]
            if (op === 'move' || op === 'swap') state.layer[source] = undefined
          }
          break
        }
      }
    }
  }
  state.warnings = [...new Set(state.warnings)]
  return state
}

/** Scrubbing addresses timeline ticks directly; playback follows goto instead. */
export function seekAnimation(env: AnimationEnvironment, frames: AnimationFrame[], tick: number): AnimationState {
  let state = initialAnimation(env)
  const ticks = [...new Set(frames.map(f => f.tick).filter(t => t <= tick))].sort((a, b) => a - b)
  const warnings: string[] = []
  for (const t of ticks) {
    state = stepAnimation(env, frames, state, t)
    warnings.push(...state.warnings)
  }
  if (state.tick !== tick) state = stepAnimation(env, frames, state, tick)
  return { ...state, warnings: [...new Set(warnings.concat(state.warnings))] }
}

export function visibleAnimationSlots(env: AnimationEnvironment, state: AnimationState): (SlotData | undefined)[] {
  return env.base.map((base, i) => {
    const slot = state.layer[i] ?? base
    return slot && !['air', 'cave_air', 'void_air'].includes(slot.itemId) ? slot : undefined
  })
}
