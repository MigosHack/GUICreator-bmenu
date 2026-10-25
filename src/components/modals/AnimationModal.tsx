import { useEffect, useMemo, useRef, useState } from 'react'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { AnimationFrame, Project } from '@/types'
import { useProjectStore } from '@/store/projectStore'
import { ItemTexture, McText } from '@/components/shared'
import { GlowButton } from '@/components/ui'
import { getGuiType } from '@/data/guiTypes'
import { parseMM } from '@/utils/minimessage'
import { ANIMATION_OPS, MAX_ANIMATION_TICK, animationEnvironment, animationNames, initialAnimation, lastAnimationTick, opcodeName, readAnimation, seekAnimation, stepAnimation, validTick, validateOpcode, visibleAnimationSlots } from '@/utils/animation'
import s from '@/styles/animation.module.css'

interface Props { project: Project; onClose: () => void }

export function AnimationModal({ project, onClose }: Props) {
  const { dispatch, undo, redo, past, future } = useProjectStore()
  const [name, setName] = useState('')
  const [newName, setNewName] = useState('')
  const [nameError, setNameError] = useState('')
  const parsed = useMemo(() => readAnimation(project, name), [project, name])
  const { frames } = parsed
  const env = useMemo(() => animationEnvironment(project), [project])
  const [preview, setPreview] = useState(() => seekAnimation(env, frames, 0))
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [op, setOp] = useState('set')
  const [draft, setDraft] = useState('diamond 0')
  const [yamlMode, setYamlMode] = useState(false)
  const [formError, setFormError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const tick = preview.tick
  const end = lastAnimationTick(frames)
  const ticks = [...new Set(frames.map(f => f.tick))].sort((a, b) => a - b)
  const actions = frames.filter(f => f.tick === tick).flatMap(f => f.opcodes.flatMap(entry => Object.entries(entry).map(([key, value]) => ({ [key]: value }))))
  const visible = visibleAnimationSlots(env, preview)
  const named = animationNames(project)
  const gt = getGuiType(project.guiType)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { previous?.focus() }
  }, [])
  useEffect(() => {
    setPlaying(false)
    setPreview(previous => seekAnimation(env, frames, Math.max(0, previous.tick)))
    setEditIndex(null)
  }, [env, frames])
  useEffect(() => {
    if (name && !named.includes(name)) setName('')
  }, [name, named.join('\n')])
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setPreview(previous => {
        if (previous.nextTick > end) {
          if (loop) return stepAnimation(env, frames, initialAnimation(env))
          return previous
        }
        return stepAnimation(env, frames, previous)
      })
    }, 50 / speed)
    return () => window.clearInterval(timer)
  }, [playing, speed, loop, end, env, frames])
  useEffect(() => {
    if (playing && !loop && preview.nextTick > end) setPlaying(false)
  }, [playing, loop, end, preview.nextTick])

  function save(next: AnimationFrame[]) { setPlaying(false); dispatch({ type: 'ANIM', name, frames: next }) }
  function chooseTick(value: number) {
    if (!validTick(value)) return
    setPlaying(false); setEditIndex(null); setFormError('')
    setPreview(seekAnimation(env, frames, value))
  }
  function updateActions(next: Record<string, unknown>[]) {
    let found = false
    const updated = frames.map(frame => {
      if (frame.tick !== tick) return frame
      const opcodes = found ? [] : next
      found = true
      return { ...frame, opcodes }
    })
    if (!found) updated.push({ tick, opcodes: next })
    save(updated)
  }
  function editAction(index: number) {
    setPlaying(false)
    const [key, value] = Object.entries(actions[index])[0]
    const multiline = opcodeName(key) === 'commands' && Array.isArray(value) && value.every(v => typeof v === 'string')
    const complex = value !== null && typeof value === 'object' && !multiline
    setEditIndex(index); setOp(key); setYamlMode(complex); setFormError('')
    setDraft(complex ? stringifyYaml(value) : multiline ? value.join('\n') : String(value ?? ''))
  }
  function newAction(key = 'set') {
    setEditIndex(null); setOp(key); setYamlMode(false); setFormError('')
    setDraft(String(ANIMATION_OPS.find(x => x.key === key)?.value ?? ''))
  }
  function applyAction() {
    let value: unknown = draft
    try {
      if (yamlMode) value = parseYaml(draft)
      else if (opcodeName(op) === 'commands') value = draft.split('\n').filter(line => line.trim())
      else if (opcodeName(op) === 'goto') value = draft.trim() ? Number(draft) : ''
    } catch { setFormError('Некорректный YAML. Исправьте значение действия.'); return }
    const error = validateOpcode(op, value, env.base.length)
    if (error) { setFormError(error); return }
    const next = [...actions]
    if (editIndex === null) next.push({ [op]: value })
    else next[editIndex] = { [op]: value }
    updateActions(next); setEditIndex(null); setFormError('')
  }
  function createNamed() {
    const key = newName.trim()
    if (!/^[a-zA-Z0-9_.-]+$/.test(key)) { setNameError('Используйте латинские буквы, цифры, _, . или -.'); return }
    if (named.includes(key)) { setNameError('Анимация с таким именем уже существует.'); return }
    dispatch({ type: 'ANIM', name: key, frames: [{ tick: 0, opcodes: [] }] })
    setName(key); setNewName(''); setNameError(''); chooseTick(0)
  }
  function reorder(index: number, direction: number) {
    const next = [...actions]
    ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
    updateActions(next); setEditIndex(null)
  }
  function keyDown(e: React.KeyboardEvent) {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key !== 'Tab') return
    const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')
    if (!focusable?.length) return
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return <div className={s.overlay} onKeyDown={keyDown} onWheel={e => e.stopPropagation()}>
    <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="animation-title" tabIndex={-1} ref={dialog}>
      <header className={s.header}>
        <div><h2 id="animation-title">Анимации меню</h2><p>{project.name} · BMenu · 20 тиков = 1 секунда</p></div>
        <div className={s.controls}>
          <GlowButton onClick={undo} disabled={!past.length} aria-label="Отменить изменение анимации">↩</GlowButton>
          <GlowButton onClick={redo} disabled={!future.length} aria-label="Повторить изменение анимации">↪</GlowButton>
          <GlowButton onClick={onClose}>Закрыть</GlowButton>
        </div>
      </header>
      <div className={s.clips}>
        <label>Анимация<select aria-label="Анимация" value={name} onChange={e => { setName(e.target.value); chooseTick(0) }}>
          <option value="">При открытии меню</option>{named.map(key => <option key={key} value={key}>{key}</option>)}
        </select></label>
        <label>Новая анимация<input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Например, reward" /></label>
        <GlowButton onClick={createNamed} disabled={!newName.trim()}>Создать</GlowButton>
        {name && <GlowButton variant="danger" onClick={() => { dispatch({ type: 'ANIM', name, frames: null }); setName(''); chooseTick(0) }}>Удалить анимацию</GlowButton>}
      </div>
      {nameError && <p role="alert" className={s.error}>{nameError}</p>}
      {name && <p className={s.note}>Запуск в BMenu: <code>[set_animation] {name}</code></p>}
      {parsed.error && <p role="alert" className={s.error}>{parsed.error}</p>}
      <div className={s.body}>
        <section className={s.preview} aria-label="Предпросмотр анимации">
          <div className={s.previewHeading}><span>Предпросмотр</span><span>Тик {tick} · {(tick / 20).toFixed(2)} с</span></div>
          <div className={s.inventory}>
            <div className={s.inventoryTitle}><McText segs={parseMM(preview.title)} /></div>
            <div className={gt ? s.specialGrid : s.grid} style={gt ? { width: gt.containerWidth * 2, height: gt.containerHeight * 2 } : undefined}>
              {visible.map((item, index) => <button key={index} type="button" className={`${s.slot} ${selectedSlot === index ? s.selected : ''}`}
                style={gt ? { position: 'absolute', left: gt.slots[index].x * 2, top: gt.slots[index].y * 2 } : undefined}
                aria-label={`Слот ${index}: ${item?.itemId ?? 'пусто'}`} aria-pressed={selectedSlot === index}
                onClick={() => setSelectedSlot(index)} title={`${index}: ${item?.itemId ?? 'пусто'}`} data-animation-slot={index} data-item={item?.itemId ?? ''}>
                {item && <ItemTexture itemId={item.itemId} size={28} potionColor={item.potionColor} skullTexture={item.skullTexture} armorTrim={item.armorTrim} />}
                <span className={s.slotNumber}>{index}</span>{item && item.amount > 1 && <b className={s.amount}>{item.amount}</b>}
              </button>)}
            </div>
          </div>
          <p className={s.note}>Выберите слот для действия. Анимационный слой перекрывает основное меню; remove открывает предмет под ним, set AIR скрывает его.</p>
          <div className={s.controls}>
            <GlowButton variant="primary" disabled={!!parsed.error || !frames.length} onClick={() => {
              if (!playing && preview.nextTick > end) setPreview(stepAnimation(env, frames, initialAnimation(env)))
              setPlaying(!playing)
            }}>{playing ? '❚❚ Пауза' : '▶ Играть'}</GlowButton>
            <GlowButton onClick={() => chooseTick(0)}>■ Сначала</GlowButton>
            <label>Скорость<select aria-label="Скорость" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
              {[0.25, 0.5, 1, 2].map(n => <option key={n} value={n}>{n}×</option>)}
            </select></label>
            <label className={s.check}><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />Повтор просмотра</label>
          </div>
          <div className={s.events} aria-label="События текущего тика">
            <strong>События тика {tick}</strong>
            {preview.events.length ? preview.events.map((event, i) => <div key={i}>{event}</div>) : <p>Нет команд или звуков на этом тике.</p>}
            <p>Команды, звуки и серверные плейсхолдеры выполняются в Minecraft.</p>
          </div>
          {preview.warnings.map(w => <p className={s.warning} key={w}>{w}</p>)}
        </section>
        <section className={s.editor} aria-label="Редактор действий">
          <div className={s.previewHeading}><span>Действия на тике {tick}</span><span>{actions.length}</span></div>
          <div className={s.actionList}>
            {actions.length === 0 && <p className={s.empty}>На этом тике нет действий. Выберите тип действия ниже и добавьте его.</p>}
            {actions.map((entry, index) => {
              const [key, value] = Object.entries(entry)[0]
              return <div className={`${s.actionRow} ${editIndex === index ? s.activeAction : ''}`} key={index}>
                <button className={s.actionText} onClick={() => editAction(index)} aria-label={`Редактировать действие ${index + 1}`}><b>{index + 1}. {key}</b><span>{typeof value === 'string' ? value : JSON.stringify(value)}</span></button>
                <div className={s.rowButtons}>
                  <button onClick={() => reorder(index, -1)} disabled={index === 0} aria-label={`Поднять действие ${index + 1}`}>↑</button>
                  <button onClick={() => reorder(index, 1)} disabled={index === actions.length - 1} aria-label={`Опустить действие ${index + 1}`}>↓</button>
                  <button onClick={() => { updateActions(actions.filter((_, i) => i !== index)); setEditIndex(null) }} aria-label={`Удалить действие ${index + 1}`}>×</button>
                </div>
              </div>
            })}
          </div>
          <fieldset disabled={playing || !!parsed.error} className={s.form}>
            <legend>{editIndex === null ? 'Новое действие' : `Изменение действия ${editIndex + 1}`}</legend>
            <label>Тип действия<select aria-label="Тип действия" value={op} onChange={e => { setOp(e.target.value); setYamlMode(false); setFormError(''); setDraft(String(ANIMATION_OPS.find(x => x.key === e.target.value)?.value ?? '')) }}>
              {!ANIMATION_OPS.some(x => x.key === op) && <option value={op}>{op}</option>}
              {ANIMATION_OPS.map(x => <option key={x.key} value={x.key}>{x.label} · {x.key}</option>)}
            </select></label>
            <p className={s.note}>{ANIMATION_OPS.find(x => x.key === opcodeName(op))?.hint}</p>
            <label>{yamlMode ? 'Значение в YAML' : opcodeName(op) === 'commands' ? 'Команды (по одной на строке)' : 'Параметры действия'}
              <textarea aria-label="Параметры действия" rows={opcodeName(op) === 'commands' || yamlMode ? 4 : 2} value={draft} onChange={e => { setDraft(e.target.value); setFormError('') }} spellCheck={false} />
            </label>
            {['set', 'fill', 'set-if-empty'].includes(opcodeName(op)) && <label>Предмет из меню<select aria-label="Предмет из меню" value="" onChange={e => {
              setDraft(opcodeName(op) === 'fill' ? e.target.value : `${e.target.value} ${selectedSlot ?? 0}`)
            }}><option value="" disabled>Выбрать ID из items…</option>{Object.keys(env.items).map(key => <option key={key} value={key}>{key}</option>)}</select></label>}
            {selectedSlot !== null && ['set', 'set-if-empty', 'remove', 'remove-if-not-empty', 'copy', 'move', 'swap', 'copy-from-base'].includes(opcodeName(op)) &&
              <GlowButton onClick={() => {
                const baseOp = opcodeName(op)
                setDraft(['remove', 'remove-if-not-empty'].includes(baseOp) ? String(selectedSlot) : `${draft.trim().split(/\s+/)[0] || 'diamond'} ${selectedSlot}`)
              }}>Вставить слот {selectedSlot}</GlowButton>}
            {formError && <p role="alert" className={s.error}>{formError}</p>}
            <div className={s.controls}>
              <GlowButton variant="primary" onClick={applyAction}>{editIndex === null ? 'Добавить действие' : 'Сохранить действие'}</GlowButton>
              {editIndex !== null && <GlowButton onClick={() => newAction()}>Отмена</GlowButton>}
            </div>
          </fieldset>
        </section>
      </div>
      <section className={s.timeline} aria-label="Таймлайн">
        <div className={s.controls}>
          <GlowButton aria-label="Предыдущий тик" disabled={tick === 0} onClick={() => chooseTick(tick - 1)}>◀</GlowButton>
          <label className={s.tickInput}>Тик<input type="number" min={0} max={MAX_ANIMATION_TICK} step={1} value={tick} onChange={e => chooseTick(Number(e.target.value))} /></label>
          <GlowButton aria-label="Следующий тик" disabled={tick === MAX_ANIMATION_TICK} onClick={() => chooseTick(tick + 1)}>▶</GlowButton>
          <GlowButton disabled={!!parsed.error || ticks.includes(tick)} onClick={() => save([...frames, { tick, opcodes: [] }])}>Добавить кадр</GlowButton>
          <GlowButton variant="danger" disabled={!!parsed.error || !ticks.includes(tick)} onClick={() => save(frames.filter(f => f.tick !== tick))}>Удалить кадр</GlowButton>
          <span className={s.note}>Конец: {end} тик · {ticks.length} кадров</span>
        </div>
        <input aria-label="Выбор тика" type="range" min={0} max={Math.max(20, end, tick)} step={1} value={tick} onChange={e => chooseTick(Number(e.target.value))} />
        <div className={s.markers}>{ticks.map(t => <button key={t} aria-label={`Кадр ${t}`} aria-pressed={tick === t} onClick={() => chooseTick(t)}>{t}<small>{frames.filter(f => f.tick === t).reduce((n, f) => n + f.opcodes.reduce((m, entry) => m + Object.keys(entry).length, 0), 0)} действий</small></button>)}</div>
        <p className={s.note}>Выбор тика показывает кадры по порядку. Воспроизведение учитывает goto. Повтор просмотра не меняет экспорт; для цикла в BMenu добавьте goto. Изменения сохраняются в проекте после добавления действия.</p>
      </section>
    </div>
  </div>
}
