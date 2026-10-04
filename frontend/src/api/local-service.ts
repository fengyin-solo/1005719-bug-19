import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult, TransferRecord } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const SUBSTATION_KEY = 'substation'
const WORKPERMIT_KEY = 'workpermit'
const RETIRED = '已退役'
const RUNNING = '运行中'

// 退役手续链：每一步办理完落到下一个状态。
const RETIRE_STEPS: { action: string; label: string }[] = [
  { action: '提交投运', label: '提交投运' },
  { action: '安排检修', label: '安排检修（停运停电）' },
  { action: '办理退役', label: '办理退役（退役落定）' },
]
// 各当前态在手续链上的序位：处在「运行中」表示已办完第 0 步，下一步就是缺口。
const STEP_ORDER = ['待投运', '运行中', '检修中', '已退役']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function lastTransfer(row: EntryRow): TransferRecord | undefined {
  const history = Array.isArray(row.移交记录) ? row.移交记录 : []
  return history.length > 0 ? history[history.length - 1] : undefined
}

// 名册与详情面板读站名、接线方式都走这一个口径：底稿上最近一次移交记录为准。
function projectStation(row: EntryRow): EntryRow {
  const latest = lastTransfer(row)
  return {
    ...row,
    站名: latest?.stationName ?? String(row.站名 ?? ''),
    接线方式: latest?.wiring ?? String(row.接线方式 ?? ''),
  }
}

function earliestRetireDate(row: EntryRow): string {
  const onPaper = String(row.停用日期 ?? '').trim()
  if (onPaper) {
    return onPaper
  }
  const retiredAt = (Array.isArray(row.移交记录) ? row.移交记录 : [])
    .filter((item) => item.to === RETIRED)
    .map((item) => item.date)
    .sort()[0]
  return retiredAt ?? ''
}

function stationNameAliases(row: EntryRow): string[] {
  const names = new Set<string>()
  if (row.站名) names.add(String(row.站名).trim())
  for (const item of Array.isArray(row.移交记录) ? row.移交记录 : []) {
    if (item.stationName) names.add(item.stationName.trim())
  }
  return [...names].filter(Boolean)
}

export type StationScope = 'active' | 'retired'

export type StationQuery = {
  filters?: Record<string, string>
  scope?: StationScope
  page?: number
  size?: number
}

// 在用名册 / 退役清册都从同一份底稿切出来；退役站只进退役清册，绝不会翻页翻进在用名册。
export function listStations(query: StationQuery = {}): PageResult {
  const scope: StationScope = query.scope ?? 'active'
  const projected = listRows(SUBSTATION_KEY).map(projectStation)
  const scoped = projected.filter((row) =>
    scope === 'active' ? row.status !== RETIRED : row.status === RETIRED,
  )
  const matched = filterRows(scoped, query.filters ?? {})
  const size = query.size && query.size > 0 ? query.size : matched.length
  const pages = Math.max(1, Math.ceil(matched.length / size))
  const page = Math.min(Math.max(1, query.page ?? 1), pages)
  const start = (page - 1) * size
  return { items: matched.slice(start, start + size), total: matched.length, page, size }
}

// 详情面板与名册共用 projectStation，同一份底稿、同一条解析口径。
export function getStation(id: number): EntryRow | undefined {
  const row = listRows(SUBSTATION_KEY).find((item) => Number(item.id) === id)
  return row ? projectStation(row) : undefined
}

export type StationCounts = {
  running: number
  retired: number
  maintenance: number
  pending: number
}

// 概览的在运站数、停用站数都按这份底稿现算，不缓存退役前的数字。
export function stationCounts(): StationCounts {
  const rows = listRows(SUBSTATION_KEY)
  return {
    running: rows.filter((row) => row.status === RUNNING).length,
    retired: rows.filter((row) => row.status === RETIRED).length,
    maintenance: rows.filter((row) => row.status === '检修中').length,
    pending: rows.filter((row) => row.status === '待投运').length,
  }
}

export type StationDraft = {
  站名: string
  电压等级: string
  所属供电所: string
  主变台数: string
  投运日期: string
  站长: string
  接线方式: string
  operator?: string
}

// 重新登记按站名查重：不管那座站还在用还是已经退掉，再登记只会提示、不会多一条。
export function createStation(draft: StationDraft): ActionResult {
  const name = draft.站名.trim()
  if (!name) {
    return { ok: false, message: '站名是必填项，登记口径与既有变电站台账一致' }
  }
  const required: [keyof StationDraft, string][] = [
    ['电压等级', '电压等级'],
    ['所属供电所', '运维班组（所属供电所）'],
    ['接线方式', '接线方式'],
  ]
  for (const [field, label] of required) {
    if (!String(draft[field] ?? '').trim()) {
      return { ok: false, message: `${label}是必填项，请补齐后再登记` }
    }
  }
  const rows = listRows(SUBSTATION_KEY)
  const duplicated = rows.find((row) =>
    stationNameAliases(row).some((alias) => alias === name),
  )
  if (duplicated) {
    if (duplicated.status === RETIRED) {
      return {
        ok: false,
        message: `「${name}」已于${earliestRetireDate(duplicated)}退役落定，不能重新登记；如需复用请走重新启用流程`,
      }
    }
    return { ok: false, message: `「${name}」已在台账中（当前状态：${duplicated.status}），不能重复登记` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const operator = draft.operator?.trim() || '值班管理员'
  const wiring = draft.接线方式.trim()
  const date = draft.投运日期.trim() || today()
  const record: TransferRecord = {
    date,
    action: '建账登记',
    from: '—',
    to: '待投运',
    operator,
    stationName: name,
    wiring,
  }
  const row: EntryRow = {
    id,
    status: '待投运',
    pending: true,
    abnormal: false,
    站名: name,
    电压等级: draft.电压等级.trim(),
    所属供电所: draft.所属供电所.trim(),
    主变台数: draft.主变台数.trim(),
    投运日期: date,
    站长: draft.站长.trim(),
    接线方式: wiring,
    站点状态: '待投运',
    移交记录: [record],
  }
  saveRows(SUBSTATION_KEY, [...rows, row])
  return { ok: true, message: `变电站「${name}」已登记，当前状态「待投运」，需提交投运后方可进入在用名册` }
}

function blockMessage(action: string, current: string): string {
  const idx = RETIRE_STEPS.findIndex((step) => step.action === action)
  if (idx < 0) {
    return `当前状态为「${current}」，不能办理「${action}」`
  }
  const chain = RETIRE_STEPS.map((step) => step.label).join(' → ')
  // 还没投运的站，后续任何手续都从「提交投运」这一步卡住。
  if (current === '待投运') {
    return `退役手续还没走完：该站尚未投运，请先办理「提交投运」，再依次完成「安排检修（停运停电）」「办理退役」`
  }
  // 已投运的站，目标动作之前还没走到的第一步手续就是缺口。
  // 状态序位 = 已办完的步数；目标动作在链上的序位是 idx，要先走到序位 idx 的状态。
  const order = STEP_ORDER.indexOf(current)
  const stuckIndex = Math.max(0, Math.min(order, idx))
  const stuckAt = RETIRE_STEPS[stuckIndex]?.label ?? RETIRE_STEPS[idx].label
  return `退役手续还没走完，卡在「${stuckAt}」这一步：请按 ${chain} 的顺序办理，当前状态「${current}」不能直接「${action}」`
}

// 退役落定后，工作票待办理清单里指向该站的未终结票一并作废，办理结果驱动待办理清单。
function cascadeVoidPermits(station: EntryRow, date: string): number {
  const aliases = stationNameAliases(station)
  const permits = listRows(WORKPERMIT_KEY)
  let voided = 0
  const next = permits.map((permit) => {
    const belongs = aliases.includes(String(permit.所属变电站 ?? '').trim())
    if (!belongs || permit.status === '已终结' || permit.status === '已作废') {
      return permit
    }
    voided += 1
    return {
      ...permit,
      status: '已作废',
      pending: false,
      abnormal: false,
      终结时间: date,
      许可状态: '已作废',
      作废原因: `所属变电站${earliestRetireDate(station) || date}退役落定，待办理工作票自动作废`,
    }
  })
  if (voided > 0) {
    saveRows(WORKPERMIT_KEY, next)
  }
  return voided
}

function runSubstationAction(meta: ModuleMeta, rows: EntryRow[], index: number, action: string, target: string, operator?: string): ActionResult {
  const row = rows[index]
  const current = String(row.status)

  // 已退役的底稿锁定：重复提交退役只认最早那一次，其他任何流转也不受理。
  if (current === RETIRED) {
    return {
      ok: false,
      message: `该站已于${earliestRetireDate(row)}退役落定并从在用名册撤下，停用标记已在底稿上，不能重复办理${action}`,
    }
  }

  const allowed = meta.transitions?.[action]
  if (allowed && !allowed.includes(current)) {
    return { ok: false, message: blockMessage(action, current) }
  }

  const date = today()
  const history = Array.isArray(row.移交记录) ? row.移交记录 : []
  const record: TransferRecord = {
    date,
    action,
    from: current,
    to: target,
    operator: operator?.trim() || '值班管理员',
    stationName: String(row.站名 ?? ''),
    wiring: String(row.接线方式 ?? ''),
  }
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== meta.statuses[meta.statuses.length - 1],
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    站点状态: target,
    移交记录: [...history, record],
  }

  let voidedPermits: number | undefined
  if (target === RETIRED) {
    // 停用标记落在同一份底稿上：状态、停用日期、移交记录同一条记录更新。
    updated.停用日期 = date
    const next = [...rows]
    next[index] = updated
    saveRows(SUBSTATION_KEY, next)
    voidedPermits = cascadeVoidPermits(updated, date)
    const tail = voidedPermits > 0 ? `；该站待办理工作票 ${voidedPermits} 张已一并作废` : ''
    return {
      ok: true,
      voidedPermits,
      message: `变电站已退役落定：已从在用名册撤下，停用标记落到台账底稿，当前状态「已退役」${tail}`,
    }
  }

  const next = [...rows]
  next[index] = updated
  saveRows(SUBSTATION_KEY, next)
  return { ok: true, message: `变电站已${action}，当前状态「${target}」` }
}

export function runAction(key: string, id: number, action: string, operator?: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)

  // 变电站走退役收口专用流转：已退役锁定、手续跳步挡回都在里面，优先于通用的目标态去重。
  if (key === SUBSTATION_KEY) {
    return runSubstationAction(meta, rows, index, action, target, operator)
  }

  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 工作票许可：退役站不允许再签发新票，否则待办理清单会被退掉的站污染。
  if (key === WORKPERMIT_KEY && action === '签发许可') {
    const stationName = String(rows[index].所属变电站 ?? '').trim()
    const retiredStation = listRows(SUBSTATION_KEY).find(
      (station) => station.status === RETIRED && stationNameAliases(station).includes(stationName),
    )
    if (retiredStation) {
      return {
        ok: false,
        message: `所属变电站「${stationName}」已于${earliestRetireDate(retiredStation)}退役落定，工作票不予签发许可`,
      }
    }
  }

  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== meta.statuses[meta.statuses.length - 1],
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 工作票待办理清单：只数在运（含检修流程中）站的待签发票，退役站的票不计入、不办理。
export function pendingPermitCount(): number {
  const retiredNames = new Set(
    listRows(SUBSTATION_KEY)
      .filter((station) => station.status === RETIRED)
      .flatMap(stationNameAliases),
  )
  return listRows(WORKPERMIT_KEY).filter(
    (permit) =>
      permit.status === '待签发' &&
      !retiredNames.has(String(permit.所属变电站 ?? '').trim()),
  ).length
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  const source = key === SUBSTATION_KEY ? listRows(SUBSTATION_KEY).map(projectStation) : listRows(key)
  for (const row of source) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const counts = stationCounts()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    // 工作票待处理以退役驱动后的待办理清单为准，退役站残留票不计入。
    const pending = meta.key === WORKPERMIT_KEY ? pendingPermitCount() : entries.filter((row) => row.pending).length
    return {
      name: meta.name,
      created: entries.length,
      pending,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    // 在运站数 / 停用站数按变电站底稿现算，退役落定即刻收口。
    { label: '在运站数', value: counts.running },
    { label: '停用站数', value: counts.retired },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}