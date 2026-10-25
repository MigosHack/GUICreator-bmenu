import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { parseBMenu, toBMenu, readSlots, writeSlots, looksLikeBMenu } from '@/utils/bmenu'
import { parseAnyImport } from '@/utils/import/parseAnyImport'

const SRC = `
id: bmenu:confirm
provider: bmenu:confirm
type: chest
size: 45
title: "<b><#009900>＄ <#4D4D4D>Подтверждение"
args:
  preview_slot: "22"
items:
  frame:
    slot: 0,1,3-5
    name: " "
    material: black_stained_glass_pane
  info:
    slot: 31
    material: paper
    name: "<primary>Цена: {price}"
    lore: " <alt:a:b>➥ Нажмите"
    on_click: "[confirm_purchase]"
  hidden:
    material: stone
    on_click: "[close]"
`

describe('bmenu', () => {
  it('slots', () => {
    expect(readSlots('0,1,3-5')).toEqual([0, 1, 3, 4, 5])
    expect(readSlots(['10', 12])).toEqual([10, 12])
    expect(writeSlots([5, 0, 1, 2, 7])).toBe('0-2,5,7')
  })

  it('detects and imports', () => {
    expect(looksLikeBMenu(SRC)).toBe(true)
    const r = parseAnyImport(SRC)
    expect(r.kind).toBe('menu')
    const p = parseBMenu(SRC)!
    expect(p.rows).toBe(5)
    expect(Object.keys(p.slots)).toHaveLength(6)
    expect(p.slots['3-4'].itemId).toBe('paper')
  })

  it('round-trips without losing data', () => {
    const out = parse(toBMenu(parseBMenu(SRC)!))
    expect(out.id).toBe('bmenu:confirm')
    expect(out.provider).toBe('bmenu:confirm')
    expect(out.size).toBe(45)
    expect(out.args).toEqual({ preview_slot: '22' })
    expect(out.title).toBe('<b><#009900>＄ <#4D4D4D>Подтверждение')
    expect(out.items.frame.slot).toBe('0-1,3-5')
    expect(out.items.info.name).toBe('<primary>Цена: {price}')
    expect(out.items.info.lore).toEqual([' <alt:a:b>➥ Нажмите'])
    expect(out.items.info.on_click).toBe('[confirm_purchase]')
    expect(out.items.hidden).toEqual({ material: 'stone', on_click: '[close]' })
  })

  it('skull textures', () => {
    const b64 = btoa(JSON.stringify({ textures: { SKIN: { url: 'http://textures.minecraft.net/texture/abc' } } }))
    const p = parseBMenu(`items:\n  h:\n    slot: 0\n    material: basehead-${b64}\n`)!
    expect(p.slots['0-0'].skullTexture).toBe('http://textures.minecraft.net/texture/abc')
    expect(parse(toBMenu(p)).items.h.material).toBe(`basehead-${b64}`)
  })
})
