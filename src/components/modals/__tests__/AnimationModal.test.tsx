import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnimationModal } from '../AnimationModal'
import { useProjectStore } from '@/store/projectStore'
import { newProject } from '@/utils/slot'
import { readAnimation } from '@/utils/animation'

function Harness() {
  const project = useProjectStore(state => state.present)
  return <AnimationModal project={project} onClose={() => {}} />
}
function slot(index: number) { return document.querySelector(`[data-animation-slot="${index}"]`)! }

beforeEach(() => {
  vi.useFakeTimers()
  const p = newProject('Animation', 1)
  p.bmenu = { extra: { animation: [
    { tick: 0, opcodes: [{ set: 'diamond 0' }] },
    { tick: 2, opcodes: [{ move: '0 1' }] },
    { tick: 4, opcodes: [{ title: 'Done' }] },
  ] } }
  useProjectStore.getState().loadProject(p)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('animation controls', () => {
  it('plays at 20 TPS, pauses, seeks and stops on the last tick without changing the project', () => {
    const original = useProjectStore.getState().present
    render(<Harness />)
    expect(slot(0).getAttribute('data-item')).toBe('diamond')
    fireEvent.click(screen.getByRole('button', { name: '▶ Играть' }))
    act(() => { vi.advanceTimersByTime(100) })
    expect(slot(1).getAttribute('data-item')).toBe('diamond')
    fireEvent.click(screen.getByRole('button', { name: '❚❚ Пауза' }))
    act(() => { vi.advanceTimersByTime(1000) })
    expect((screen.getByRole('spinbutton', { name: 'Тик' }) as HTMLInputElement).value).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: '▶ Играть' }))
    act(() => { vi.advanceTimersByTime(100) })
    expect((screen.getByRole('spinbutton', { name: 'Тик' }) as HTMLInputElement).value).toBe('4')
    expect(screen.queryByRole('button', { name: '❚❚ Пауза' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Кадр 0' }))
    expect(slot(0).getAttribute('data-item')).toBe('diamond')
    expect(slot(1).getAttribute('data-item')).toBe('')
    expect(useProjectStore.getState().present).toBe(original)
  })

  it('honors goto during playback and clears the interval when unmounted', () => {
    const store = useProjectStore.getState()
    store.dispatch({ type: 'ANIM', name: '', frames: [{ tick: 0, opcodes: [{ set: 'diamond 0' }] }, { tick: 1, opcodes: [{ goto: 0 }] }] })
    const view = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '▶ Играть' }))
    act(() => { vi.advanceTimersByTime(100) })
    expect((screen.getByRole('spinbutton', { name: 'Тик' }) as HTMLInputElement).value).toBe('0')
    expect(screen.getByRole('button', { name: '❚❚ Пауза' })).toBeTruthy()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects invalid slots, edits an action type in place, and supports undo', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Параметры действия'), { target: { value: 'diamond 100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить действие' }))
    expect(screen.getByRole('alert').textContent).toContain('от 0 до 8')
    expect(readAnimation(useProjectStore.getState().present).frames[0].opcodes).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать действие 1' }))
    fireEvent.change(screen.getByLabelText('Тип действия'), { target: { value: 'fill' } })
    fireEvent.change(screen.getByLabelText('Параметры действия'), { target: { value: 'emerald' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить действие' }))
    expect(readAnimation(useProjectStore.getState().present).frames[0].opcodes).toEqual([{ fill: 'emerald' }])
    expect(slot(8).getAttribute('data-item')).toBe('emerald')
    fireEvent.click(screen.getByRole('button', { name: 'Отменить изменение анимации' }))
    expect(readAnimation(useProjectStore.getState().present).frames[0].opcodes).toEqual([{ set: 'diamond 0' }])
  })
})
