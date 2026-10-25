import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from '../projectStore'
import { defSlot } from '@/utils/slot'

describe('projectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({
      past: [],
      present: { id: 'test', name: 'Test', rows: 3, cols: 9, slots: {}, createdAt: 0, updatedAt: 0 },
      future: [],
    })
  })

  it('dispatches SS to set slot', () => {
    const store = useProjectStore.getState()
    store.dispatch({ type: 'SS', key: '0-0', data: defSlot('diamond') })
    const state = useProjectStore.getState()
    expect(state.present.slots['0-0']).toBeDefined()
    expect(state.present.slots['0-0'].itemId).toBe('diamond')
    expect(state.past).toHaveLength(1)
  })

  it('undo restores previous state', () => {
    const store = useProjectStore.getState()
    store.dispatch({ type: 'SS', key: '0-0', data: defSlot('diamond') })
    useProjectStore.getState().undo()
    const state = useProjectStore.getState()
    expect(state.present.slots['0-0']).toBeUndefined()
    expect(state.future).toHaveLength(1)
  })

  it('redo restores undone state', () => {
    const store = useProjectStore.getState()
    store.dispatch({ type: 'SS', key: '0-0', data: defSlot('diamond') })
    useProjectStore.getState().undo()
    useProjectStore.getState().redo()
    const state = useProjectStore.getState()
    expect(state.present.slots['0-0']).toBeDefined()
  })

  it('RS removes slot', () => {
    const store = useProjectStore.getState()
    store.dispatch({ type: 'SS', key: '1-1', data: defSlot('stone') })
    useProjectStore.getState().dispatch({ type: 'RS', key: '1-1' })
    expect(useProjectStore.getState().present.slots['1-1']).toBeUndefined()
  })

  it('setName updates name', () => {
    useProjectStore.getState().setName('New Name')
    expect(useProjectStore.getState().present.name).toBe('New Name')
  })
})

describe('animation history', () => {
  it('saves, deletes, undoes and redoes named clips without touching base slots or other BMenu data', () => {
    const base = { id: 'anim', name: 'Animation', rows: 1, cols: 9 as const, slots: { '0-0': defSlot('stone') }, createdAt: 0, updatedAt: 0, bmenu: { extra: { args: { x: 'keep' }, animation: [{ tick: 0, opcodes: [{ title: 'Open' }] }] } } }
    useProjectStore.getState().loadProject(base)
    const frames = [{ tick: 10, opcodes: [{ commands: ['[message] Hi'] }] }]
    useProjectStore.getState().dispatch({ type: 'ANIM', name: 'reward', frames })
    expect(useProjectStore.getState().present.bmenu?.extra.animations).toEqual({ reward: frames })
    expect(base.bmenu.extra).not.toHaveProperty('animations')
    useProjectStore.getState().dispatch({ type: 'ANIM', name: 'reward', frames: null })
    expect(useProjectStore.getState().present.bmenu?.extra.animations).toEqual({})
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().present.bmenu?.extra.animations).toEqual({ reward: frames })
    useProjectStore.getState().redo()
    expect(useProjectStore.getState().present.bmenu?.extra.animations).toEqual({})
    expect(useProjectStore.getState().present.slots).toEqual(base.slots)
    expect(useProjectStore.getState().present.bmenu?.extra.args).toEqual({ x: 'keep' })
    expect(useProjectStore.getState().present.bmenu?.extra.animation).toEqual(base.bmenu.extra.animation)
  })
})
