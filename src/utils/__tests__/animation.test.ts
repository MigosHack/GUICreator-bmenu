import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { AnimationFrame } from '@/types'
import { parseBMenu, toBMenu } from '@/utils/bmenu'
import { defSlot, newProject } from '@/utils/slot'
import { animationEnvironment, initialAnimation, readAnimation, seekAnimation, stepAnimation, validateOpcode, visibleAnimationSlots } from '@/utils/animation'
import { fromExportJson } from '@/utils/import/fromExportJson'

function fixture() {
  const p = newProject('Base', 1)
  p.slots['0-0'] = defSlot('stone')
  return animationEnvironment(p)
}

describe('BMenu animation', () => {
  it('keeps the animation layer separate; remove reveals base while AIR masks it', () => {
    const env = fixture()
    const frames: AnimationFrame[] = [
      { tick: 0, opcodes: [{ set: 'diamond 0' }] },
      { tick: 2, opcodes: [{ remove: 0 }] },
      { tick: 3, opcodes: [{ set: 'AIR 0' }] },
      { tick: 4, opcodes: [{ remove: 0 }] },
    ]
    expect(visibleAnimationSlots(env, seekAnimation(env, frames, 1))[0]?.itemId).toBe('diamond')
    expect(visibleAnimationSlots(env, seekAnimation(env, frames, 2))[0]?.itemId).toBe('stone')
    expect(visibleAnimationSlots(env, seekAnimation(env, frames, 3))[0]).toBeUndefined()
    expect(visibleAnimationSlots(env, seekAnimation(env, frames, 4))[0]?.itemId).toBe('stone')
    expect(env.base[0]?.itemId).toBe('stone')
  })

  it('uses ordered operations, sequential overlapping copy, and repeated source for multiple targets', () => {
    const env = fixture()
    const frames = [{ tick: 0, opcodes: [{ set: 'diamond 0', copy: '0-2 1-3' }, { copy: '3 4-8' }] }]
    const state = seekAnimation(env, frames, 0)
    expect(state.layer.map(s => s?.itemId)).toEqual(Array(9).fill('diamond'))
  })

  it('supports aliases, base copy, set-if-empty and remove-if-not-empty', () => {
    const env = fixture()
    const frames = [
      { tick: 0, opcodes: [{ cfb: '0 0-1' }, { sie: 'diamond 0-2' }] },
      { tick: 1, opcodes: [{ rne: '0-2' }] },
    ]
    const state = seekAnimation(env, frames, 1)
    expect(state.layer.slice(0, 3).map(s => s?.itemId)).toEqual([undefined, 'stone', 'diamond'])
  })

  it('moves ranges sequentially and matches the current upstream swap implementation', () => {
    const env = fixture()
    const state = seekAnimation(env, [{ tick: 0, opcodes: [{ set: 'diamond 0' }, { mv: '0++' }, { sw: '1 2' }] }], 0)
    expect(state.layer.slice(0, 3).map(s => s?.itemId)).toEqual([undefined, undefined, 'diamond'])
    expect(state.warnings[0]).toContain('swap')
  })

  it('plays goto without resetting layer state and stops only after the final frame', () => {
    const env = fixture()
    const frames = [
      { tick: 0, opcodes: [{ set: 'diamond 0' }] },
      { tick: 1, opcodes: [{ move: '0 1' }, { goto: 0 }] },
    ]
    let state = stepAnimation(env, frames, initialAnimation(env))
    state = stepAnimation(env, frames, state)
    expect(state.nextTick).toBe(0)
    state = stepAnimation(env, frames, state)
    expect(state.layer.slice(0, 2).map(s => s?.itemId)).toEqual(['diamond', 'diamond'])
    expect(seekAnimation(env, frames, 1).tick).toBe(1)
  })

  it('scrubs sparse timelines without iterating every tick, and does not execute server events', () => {
    const env = fixture()
    const state = seekAnimation(env, [{ tick: 2_000_000_000, opcodes: [{ title: '<gold>Done' }, { commands: [{ message: 'Hi' }] }, { sound: 'ui.button.click 1 1' }] }], 2_000_000_000)
    expect(state.title).toBe('<gold>Done')
    expect(state.events).toHaveLength(2)
    expect(state.nextTick).toBe(2_000_000_001)
  })

  it('reads omitted ticks and same-tick frames in source order without losing unknown fields', () => {
    const project = parseBMenu(`id: a:b
items: {}
animation:
  - opcodes: [{set: 'diamond 0'}]
    extension: keep
  - tick: 1
    opcodes: [{remove: 0}]
  - opcodes: [{future: {a: 1}}]
` )!
    const { frames, error } = readAnimation(project)
    expect(error).toBeUndefined()
    expect(frames.map(f => f.tick)).toEqual([1, 1, 2])
    expect(frames[0].extension).toBe('keep')
    const state = seekAnimation(animationEnvironment(project), frames, 2)
    expect(state.layer[0]).toBeUndefined()
    expect(state.warnings[0]).toContain('future')
    expect(parse(toBMenu(project)).animation[2].opcodes).toEqual([{ future: { a: 1 } }])
  })

  it('resolves exported item IDs and protects unplaced animation items from name collisions', () => {
    const p = newProject('Test', 1)
    p.slots['0-0'] = defSlot('diamond')
    p.bmenu = { extra: { animation: [{ tick: 0, opcodes: [{ set: 'diamond 1' }] }] }, unplaced: { diamond: { material: 'emerald', name: '<gold>Reward', amount: 3 } } }
    const doc = parse(toBMenu(p))
    expect(doc.items.diamond.material).toBe('emerald')
    expect(doc.items.diamond_2.material).toBe('diamond')
    const state = seekAnimation(animationEnvironment(p), readAnimation(p).frames, 0)
    expect(state.layer[1]?.itemId).toBe('emerald')
    expect(state.layer[1]?.amount).toBe(3)
    expect(state.layer[1]?.displayName[0].text).toBe('Reward')
  })

  it('preserves named animations, conditions and item references through BMenu and JSON imports', () => {
    const p = parseBMenu(`id: demo:menu
items:
  prize: {material: diamond, slot: 0, name: '<primary>Prize'}
animations:
  reward:
    - tick: 0
      opcodes:
        - set: prize 1
        - commands: {if: '%level% > 2', do: [{message: Yay}]}
animation:
  - tick: 5
    opcodes: [{goto: 0}]
`)!
    const json = fromExportJson({ menu: { title: p.name, rows: p.rows }, bmenu: p.bmenu, slots: [{ slot: 0, material: 'DIAMOND', bmenu: p.slots['0-0'].bmenu, displayName: { segments: p.slots['0-0'].displayName } }] })!
    expect(parse(toBMenu(json)).animations).toEqual(parse(toBMenu(p)).animations)
    expect(parse(toBMenu(json)).items.prize.name).toBe('<primary>Prize')
    expect(readAnimation(json, 'reward').frames[0].opcodes[0]).toEqual({ set: 'prize 1' })
  })

  it('rejects invalid frames without replacing source data and validates ranges before expansion', () => {
    const p = newProject()
    p.bmenu = { extra: { animation: [{ tick: -1, opcodes: [] }] } }
    expect(readAnimation(p).error).toBeTruthy()
    expect(p.bmenu.extra.animation).toEqual([{ tick: -1, opcodes: [] }])
    for (const [op, value] of [['set', 'diamond 0-999999999999'], ['move', '0-2 4'], ['remove', '-1'], ['goto', 1.2], ['goto', ''], ['sound', 'x nope']]) {
      expect(validateOpcode(String(op), value, 9)).toBeTruthy()
    }
    expect(validateOpcode('copy', '1--', 9)).toBeNull()
  })

  it('uses special inventory sizes and does not preview dynamic material placeholders as real items', () => {
    const p = newProject()
    p.guiType = 'hopper'
    p.slots['2'] = defSlot('stone')
    const env = animationEnvironment(p)
    expect(env.base).toHaveLength(5)
    expect(env.base[2]?.itemId).toBe('stone')
    const state = seekAnimation(env, [{ tick: 0, opcodes: [{ set: '{reward} 0' }] }], 0)
    expect(state.warnings[0]).toContain('{reward}')
    expect(state.layer[0]).toBeUndefined()
  })
})
