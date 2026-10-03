import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  HandoverEntry,
  StationPageResult,
  StationScope,
  StationSummary,
} from '@/data/types'

export type { StationScope }

// 变电站退役：一座站的生命周期都落在同一份底稿（substation 表的同一行）上，
// 退役不是另建记录，而是在底稿上走手续、打停用标记。

const MODULE_KEY = 'substation'
export const STATION_NAME_FIELD = '站名'
export const STATION_WIRING_FIELD = '接线方式'

/** 在用名册口径：未进入退役流程、也未落定停用的站才算在用。 */
export const ACTIVE_STATUSES = ['待投运', '运行中', '检修中']
/** 在运站数口径：已经投运的站，检修中的站仍属在运。 */
export const IN_SERVICE_STATUSES = ['运行中', '检修中']
/** 退役办理中：申请已经受理，手续还没走完。 */
export const DECOMMISSIONING_STATUSES = ['退役申请', '停电许可']
export const RETIRED_STATUS = '已退役'

const APPLY_TIME_FIELD = '退役申请时间'
const CUTOFF_TIME_FIELD = '停电许可时间'
const HANDOVER_TIME_FIELD = '移交时间'
export const HANDOVER_FIELD = '移交记录'
const DEACTIVATED_FIELD = '停用标记'

/** 退役手续的三个步骤，顺序不能跳；每一步只认从上一步过来的站。 */
type RetireStep = {
  action: string
  target: string
  from: string[]
  label: string
  timeField: string
}
const RETIRE_STEPS: RetireStep[] = [
  {
    action: '提交退役申请',
    target: '退役申请',
    from: ['运行中', '检修中'],
    label: '退役申请',
    timeField: APPLY_TIME_FIELD,
  },
  {
    action: '办理停电许可',
    target: '停电许可',
    from: ['退役申请'],
    label: '停电许可',
    timeField: CUTOFF_TIME_FIELD,
  },
  {
    action: '完成资产移交',
    target: '已退役',
    from: ['停电许可'],
    label: '资产移交',
    timeField: HANDOVER_TIME_FIELD,
  },
]

export type StationForm = {
  stationName: string
  voltage?: string
  office?: string
  transformerCount?: string
  commissionDate?: string
  manager?: string
  wiringMode?: string
}

export type HandoverForm = {
  team: string
  stationName?: string
  wiringMode?: string
  note?: string
  date?: string
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 读底稿时补齐退役相关标记：旧数据里已退役但没打停用标记的，按状态补落。 */
function normalizeStation(row: EntryRow): EntryRow {
  const deactivated = row.status === RETIRED_STATUS || row[DEACTIVATED_FIELD] === true
  const handovers = Array.isArray(row[HANDOVER_FIELD]) ? (row[HANDOVER_FIELD] as HandoverEntry[]) : []
  return {
    ...row,
    [DEACTIVATED_FIELD]: deactivated,
    [HANDOVER_FIELD]: handovers,
  }
}

export function stationRows(): EntryRow[] {
  return listRows(MODULE_KEY).map(normalizeStation)
}

function persist(rows: EntryRow[]): void {
  saveRows(MODULE_KEY, rows)
}

export function handoversOf(row: EntryRow): HandoverEntry[] {
  const value = row[HANDOVER_FIELD]
  return Array.isArray(value) ? (value as HandoverEntry[]) : []
}

/**
 * 站名、接线方式的统一读数口径：名册与详情面板都走这里，
 * 底稿值与移交记录对不上时，以最近一次移交记录为准。
 */
export function canonicalValue(row: EntryRow, field: string): string {
  const key = field === STATION_NAME_FIELD ? 'stationName' : 'wiringMode'
  const records = handoversOf(row)
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const value = records[i][key]
    if (value && value.trim() !== '') {
      return value.trim()
    }
  }
  return String(row[field] ?? '')
}

/** 展示用底稿：站名、接线方式替换成移交后的有效值，名册和详情读到的是同一份。 */
export function displayStation(row: EntryRow): EntryRow {
  return {
    ...row,
    [STATION_NAME_FIELD]: canonicalValue(row, STATION_NAME_FIELD),
    [STATION_WIRING_FIELD]: canonicalValue(row, STATION_WIRING_FIELD),
  }
}

export function isRetired(row: EntryRow): boolean {
  return row[DEACTIVATED_FIELD] === true || row.status === RETIRED_STATUS
}

export function isDecommissioning(row: EntryRow): boolean {
  return DECOMMISSIONING_STATUSES.includes(row.status)
}

function inScope(row: EntryRow, scope: StationScope): boolean {
  if (scope === 'all') {
    return true
  }
  if (scope === 'active') {
    return ACTIVE_STATUSES.includes(row.status)
  }
  if (scope === 'retired') {
    return isRetired(row)
  }
  return DECOMMISSIONING_STATUSES.includes(row.status)
}

function matchesKeyword(row: EntryRow, filters: Record<string, string>): boolean {
  return Object.entries(filters)
    .filter(([, value]) => value.trim() !== '')
    .every(([field, value]) => String(row[field] ?? '').includes(value.trim()))
}

export function scopeCounts(): Record<StationScope, number> {
  const rows = stationRows()
  return {
    active: rows.filter((row) => inScope(row, 'active')).length,
    decommissioning: rows.filter((row) => inScope(row, 'decommissioning')).length,
    retired: rows.filter((row) => inScope(row, 'retired')).length,
    all: rows.length,
  }
}

export function stationSummary(): StationSummary {
  const rows = stationRows()
  return {
    inService: rows.filter((row) => IN_SERVICE_STATUSES.includes(row.status)).length,
    retired: rows.filter((row) => isRetired(row)).length,
    decommissioning: rows.filter((row) => isDecommissioning(row)).length,
    total: rows.length,
  }
}

/**
 * 在用名册分页：先按名册口径过滤，再分页。
 * 退役站在过滤阶段就被撤下，不会靠翻页漏出来。
 */
export function listStations(
  scope: StationScope = 'active',
  filters: Record<string, string> = {},
  page = 1,
  size = 10,
): StationPageResult {
  // 关键字筛在有效值（移交后口径）上做，筛出来的仍然是同一份底稿。
  const matched = stationRows()
    .map(displayStation)
    .filter((row) => inScope(row, scope))
    .filter((row) => matchesKeyword(row, filters))
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * size
  return {
    items: matched.slice(start, start + size),
    total: matched.length,
    page: safePage,
    size,
    scope,
  }
}

export function getStation(id: number): EntryRow | undefined {
  const row = stationRows().find((item) => Number(item.id) === id)
  return row ? displayStation(row) : undefined
}

/** 读原始底稿（未套用移交口径）：详情面板用它展示底稿值与生效值的差异。 */
export function getStationRaw(id: number): EntryRow | undefined {
  return stationRows().find((item) => Number(item.id) === id)
}

/** 登记变电站：沿用既有 8 个登记字段；同名站复用底稿，不新增重复记录。 */
export function registerStation(form: StationForm): ActionResult {
  const name = form.stationName.trim()
  if (!name) {
    return { ok: false, message: '站名不能为空，登记口径要求一站一名' }
  }
  const rows = stationRows()
  const existing = rows.find((row) => canonicalValue(row, STATION_NAME_FIELD) === name)
  if (existing) {
    if (!isRetired(existing)) {
      return { ok: false, message: `「${name}」仍在名册中（当前状态「${existing.status}」），不得重复登记` }
    }
    // 退役站重新登记：复用同一份底稿，清掉退役痕迹，绝不另起一条。
    const index = rows.findIndex((row) => Number(row.id) === existing.id)
    const reopened: EntryRow = {
      ...existing,
      status: '待投运',
      pending: true,
      abnormal: false,
      站点状态: '待投运',
      电压等级: form.voltage?.trim() || existing.电压等级,
      所属供电所: form.office?.trim() || existing.所属供电所,
      主变台数: form.transformerCount?.trim() || existing.主变台数,
      投运日期: form.commissionDate?.trim() || '',
      站长: form.manager?.trim() || existing.站长,
      接线方式: form.wiringMode?.trim() || existing.接线方式,
      [DEACTIVATED_FIELD]: false,
      [HANDOVER_FIELD]: [],
      [APPLY_TIME_FIELD]: '',
      [CUTOFF_TIME_FIELD]: '',
      [HANDOVER_TIME_FIELD]: '',
    }
    const next = [...rows]
    next[index] = reopened
    persist(next)
    return { ok: true, message: `「${name}」原底稿已退役停用，本次按重新登记复用该底稿，当前为「待投运」，未重复建档` }
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '待投运',
    pending: true,
    abnormal: false,
    站名: name,
    电压等级: form.voltage?.trim() || '',
    所属供电所: form.office?.trim() || '',
    主变台数: form.transformerCount?.trim() || '',
    投运日期: form.commissionDate?.trim() || '',
    站长: form.manager?.trim() || '',
    接线方式: form.wiringMode?.trim() || '',
    站点状态: '待投运',
    [DEACTIVATED_FIELD]: false,
    [HANDOVER_FIELD]: [],
  }
  persist([...rows, row])
  return { ok: true, message: `变电站「${name}」已登记，当前状态「待投运」` }
}

function blockedStepMessage(row: EntryRow, step: RetireStep): string {
  if (row.status === '待投运') {
    return `「${canonicalValue(row, STATION_NAME_FIELD)}」尚未投运，不在退役范围；退役手续要从在运站发起`
  }
  const currentIndex = RETIRE_STEPS.findIndex((item) => item.target === row.status)
  if (currentIndex >= 0) {
    const current = RETIRE_STEPS[currentIndex]
    const firstTime = String(row[current.timeField] ?? '')
    if (step.action === '提交退役申请') {
      return `退役申请最早已于 ${firstTime || '此前'} 受理（只认最早一次），不得重复提交；该站现停留在「${current.label}」步`
    }
    return `退役手续不能跳步：该站现停留在「${current.label}」步，请先完成该步，再办理「${step.label}」`
  }
  if (isRetired(row)) {
    const retiredAt = String(row[HANDOVER_TIME_FIELD] ?? '')
    return `「${canonicalValue(row, STATION_NAME_FIELD)}」已于 ${retiredAt || '此前'} 完成退役并停用，重复提交无效`
  }
  return `当前状态「${row.status}」不能办理「${step.label}」，退役手续卡在「${RETIRE_STEPS[0].label}」步，请先提交退役申请`
}

/**
 * 退役手续动作：三步顺序流转，每步都校验上一步是否完成。
 * 最后一步落定时撤下在用名册、停用标记落到底稿，并联动工作票。
 */
export function runRetireAction(id: number, action: string, handoverForm?: HandoverForm): ActionResult {
  const step = RETIRE_STEPS.find((item) => item.action === action)
  if (!step) {
    return { ok: false, message: `退役流程没有登记「${action}」这个动作` }
  }
  const rows = stationRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的变电站底稿` }
  }
  const row = rows[index]
  if (!step.from.includes(row.status as (typeof step.from)[number])) {
    return { ok: false, message: blockedStepMessage(row, step) }
  }

  const updated: EntryRow = {
    ...row,
    status: step.target,
    站点状态: step.target,
    pending: step.target !== RETIRED_STATUS,
  }
  updated[step.timeField] = nowText()

  let voidedCount = 0
  if (step.target === RETIRED_STATUS) {
    const team = handoverForm?.team.trim() ?? ''
    if (!team) {
      return { ok: false, message: '资产移交缺少接收班组，手续卡在「资产移交」步，停用标记不能落定' }
    }
    // 改名前的站名先记下，挂在旧名下的待办理工作票也要随退役收口。
    const previousName = String(row[STATION_NAME_FIELD] ?? '')
    const record: HandoverEntry = {
      date: handoverForm?.date?.trim() || nowText(),
      team,
      stationName: handoverForm?.stationName?.trim() || undefined,
      wiringMode: handoverForm?.wiringMode?.trim() || undefined,
      note: handoverForm?.note?.trim() || undefined,
    }
    updated[HANDOVER_FIELD] = [...handoversOf(row), record]
    updated[DEACTIVATED_FIELD] = true
    // 移交后站名/接线方式以本次移交记录为准：空值表示沿用，不覆盖。
    if (record.stationName) {
      updated[STATION_NAME_FIELD] = record.stationName
    }
    if (record.wiringMode) {
      updated[STATION_WIRING_FIELD] = record.wiringMode
    }
    voidedCount = settleWorkPermitsOnRetire(updated, previousName)
  }

  const next = [...rows]
  next[index] = displayStation(updated)
  persist(next)

  if (step.target === RETIRED_STATUS) {
    const tail = voidedCount > 0 ? `，并联动作废 ${voidedCount} 张待签发工作票` : ''
    return {
      ok: true,
      message: `退役手续已走完：该站已从在用名册撤下，停用标记落到底稿${tail}，工作票待办理清单同步更新`,
    }
  }
  return { ok: true, message: `已${step.action}，退役手续推进到「${step.label}」步` }
}

/** 投运、检修：退役之外的常规流转，仍按既有序列办理。 */
export function runStationTransition(id: number, action: string): ActionResult {
  const meta = MODULE_BY_KEY.get(MODULE_KEY)
  const target = meta?.actionTargets[action]
  if (!target) {
    return { ok: false, message: `变电站没有登记「${action}」这个动作` }
  }
  if (DECOMMISSIONING_STATUSES.includes(target) || target === RETIRED_STATUS) {
    return { ok: false, message: `「${action}」属于退役手续，请按退役步骤逐项办理` }
  }
  const rows = stationRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的变电站底稿` }
  }
  const row = rows[index]
  if (action === '提交投运' && row.status !== '待投运') {
    return { ok: false, message: `只有「待投运」的站可以提交投运，该站当前为「${row.status}」` }
  }
  if (action === '安排检修' && row.status !== '运行中') {
    return { ok: false, message: `只有「运行中」的站可以安排检修，该站当前为「${row.status}」` }
  }
  const updated: EntryRow = {
    ...row,
    status: target,
    站点状态: target,
    pending: target === '检修中',
  }
  const next = [...rows]
  next[index] = displayStation(updated)
  persist(next)
  return { ok: true, message: `变电站已${action}，当前状态「${target}」` }
}

/** 按当前状态给出可执行动作：退役中的站只出现下一步，已停用站不再挂任何流转按钮。 */
export function availableActions(row: EntryRow): string[] {
  if (isRetired(row)) {
    return []
  }
  switch (row.status) {
    case '待投运':
      return ['提交投运']
    case '运行中':
      return ['安排检修', '提交退役申请']
    case '检修中':
      return ['提交退役申请']
    case '退役申请':
      return ['办理停电许可']
    case '停电许可':
      return ['完成资产移交']
    default:
      return []
  }
}

export function retireTimeline(row: EntryRow): { label: string; time: string; done: boolean }[] {
  return RETIRE_STEPS.map((step) => ({
    label: step.label,
    time: String(row[step.timeField] ?? ''),
    done: String(row[step.timeField] ?? '') !== '',
  }))
}

/**
 * 退役落定驱动工作票：该站名下（含移交改名前的旧名）仍在「待签发」
 * （待办理）的工作票随停用一并作废，待办理清单随之收口。
 * 写在同一份本地底稿上，返回作废条数用于提示。
 */
function settleWorkPermitsOnRetire(station: EntryRow, previousName: string): number {
  // 延迟引入，避免模块初始化顺序的耦合。
  const permits = listRows('workpermit')
  const names = new Set([
    canonicalValue(station, STATION_NAME_FIELD),
    String(station[STATION_NAME_FIELD] ?? ''),
    previousName,
  ])
  let count = 0
  const next = permits.map((permit) => {
    const owner = String(permit.所属变电站 ?? '')
    if (permit.status === '待签发' && names.has(owner)) {
      count += 1
      return {
        ...permit,
        status: '已作废',
        pending: false,
        abnormal: true,
        作废原因: `所属变电站「${owner}」已退役停用，待办理工作票随退役自动作废`,
        作废时间: nowText(),
      }
    }
    return permit
  })
  if (count > 0) {
    saveRows('workpermit', next)
  }
  return count
}

/** 按站名找在役底稿：工作票许可时校验归属站是否还在在用名册。 */
export function findStationByName(name: string): EntryRow | undefined {
  const trimmed = name.trim()
  return stationRows().find((row) => canonicalValue(row, STATION_NAME_FIELD) === trimmed)
}
