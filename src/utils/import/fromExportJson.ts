import type { Project, SlotData, TextSegment, BMenuProjectMeta, BMenuSlotMeta } from '@/types'
import { newProject } from '@/utils/slot'

interface ExportSlot {
  bmenu?: BMenuSlotMeta
  slot: number
  material: string
  displayName?: { segments?: TextSegment[] }
  lore?: { segments?: TextSegment[][] }
  amount?: number
  enchanted?: boolean
  customModelData?: number | null
  potionColor?: string | null
  skullTexture?: string | null
  rpTexture?: string | null
  armorTrim?: { material: string; pattern: string } | null
  hideFlags?: number
}

interface ExportJson {
  bmenu?: BMenuProjectMeta
  menu?: { title?: string; rows?: number; guiType?: string }
  slots?: ExportSlot[]
}

export function fromExportJson(data: unknown): Project | null {
  const d = data as ExportJson
  if (!d || typeof d !== 'object' || !d.menu || !Array.isArray(d.slots)) return null
  const rows = d.menu.rows && d.menu.rows > 0 ? d.menu.rows : 6
  const p = newProject(d.menu.title || 'Импорт', rows)
  if (d.bmenu?.extra && typeof d.bmenu.extra === 'object' && !Array.isArray(d.bmenu.extra)) p.bmenu = structuredClone(d.bmenu)
  if (d.menu.guiType) p.guiType = d.menu.guiType
  const isGui = !!d.menu.guiType
  for (const sl of d.slots) {
    if (typeof sl.slot !== 'number' || !sl.material) continue
    const key = isGui ? String(sl.slot) : `${Math.floor(sl.slot / 9)}-${sl.slot % 9}`
    const slot: SlotData = {
      itemId: sl.material.toLowerCase(),
      displayName: sl.displayName?.segments ?? [],
      lore: sl.lore?.segments ?? [],
      amount: sl.amount ?? 1,
      enchanted: sl.enchanted ?? false,
      customModelData: sl.customModelData ?? null,
      hideFlags: sl.hideFlags ?? 0,
      potionColor: sl.potionColor ?? null,
      skullTexture: sl.skullTexture ?? null,
      armorTrim: sl.armorTrim ?? null,
    }
    if (sl.bmenu && typeof sl.bmenu.key === 'string') slot.bmenu = structuredClone(sl.bmenu)
    p.slots[key] = slot
  }
  return p
}
