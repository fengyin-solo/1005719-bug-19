import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import { findStationByName, isDecommissioning, isRetired } from '@/api/substation-service'
import type { ActionResult, EntryRow } from '@/data/types'

// 工作票许可：待办理清单由变电站退役底稿驱动——
// 已停用的站不进待办理清单，退役办理中的站也不得再许可新票。

const MODULE_KEY = 'workpermit'
const OWNER_FIELD = '所属变电站'

export type PermitScope = 'pending' | 'issued' | 'closed' | 'all'

const SCOPE_STATUSES: Record<PermitScope, string[]> = {
  pending: ['待签发'],
  issued: ['已许可'],
  closed: ['已终结', '已作废'],
  all: ['待签发', '已许可', '已终结', '已作废'],
}

function matchesKeyword(row: EntryRow, filters: Record<string, string>): boolean {
  return Object.entries(filters)
    .filter(([, value]) => value.trim() !== '')
    .every(([field, value]) => String(row[field] ?? '').includes(value.trim()))
}

/**
 * 待办理清单：状态为「待签发」，且所属变电站仍是在役站。
 * 退役落定的站即使工作票本身还挂着「待签发」，也不在这里出现（双保险）。
 */
export function listPermits(
  scope: PermitScope = 'pending',
  filters: Record<string, string> = {},
): EntryRow[] {
  const allow = SCOPE_STATUSES[scope]
  return listRows(MODULE_KEY).filter((row) => {
    if (!allow.includes(String(row.status))) {
      return false
    }
    if (scope === 'pending') {
      const owner = String(row[OWNER_FIELD] ?? '')
      const station = findStationByName(owner)
      if (!station || isRetired(station)) {
        return false
      }
    }
    return matchesKeyword(row, filters)
  })
}

export function permitCounts(): { pending: number; issued: number; closed: number; all: number } {
  const rows = listRows(MODULE_KEY)
  return {
    pending: listPermits('pending').length,
    issued: rows.filter((row) => row.status === '已许可').length,
    closed: rows.filter((row) => row.status === '已终结' || row.status === '已作废').length,
    all: rows.length,
  }
}

export function runPermitAction(id: number, action: string): ActionResult {
  const meta = MODULE_BY_KEY.get(MODULE_KEY)
  const target = meta?.actionTargets[action]
  if (!target) {
    return { ok: false, message: `工作票没有登记「${action}」这个动作` }
  }
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的工作票` }
  }
  const row = rows[index]

  if (action === '签发许可' && row.status === '待签发') {
    const owner = String(row[OWNER_FIELD] ?? '')
    const station = findStationByName(owner)
    if (!station) {
      return { ok: false, message: `所属变电站「${owner}」不在在用名册中，工作票卡在「待签发」，不能许可` }
    }
    if (isRetired(station)) {
      return { ok: false, message: `「${owner}」已退役停用，工作票不予许可，应作废重开` }
    }
    if (isDecommissioning(station)) {
      return { ok: false, message: `「${owner}」正在办理退役（当前「${station.status}」），工作票卡在「待签发」，待退役手续明确后再许可` }
    }
  }

  if (action === '办理终结' && row.status !== '已许可') {
    return { ok: false, message: `只有「已许可」的工作票可以办理终结，该票当前为「${row.status}」` }
  }
  if (action === '作废工作票' && (row.status === '已终结' || row.status === '已作废')) {
    return { ok: false, message: `该工作票已「${row.status}」，无需再作废` }
  }

  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target === '已许可',
    abnormal: target === '已作废' ? true : row.abnormal,
  }
  if (target === '已作废' && !updated.作废原因) {
    updated.作废原因 = '人工作废'
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `工作票已${action}，当前状态「${target}」` }
}

export function permitActions(row: EntryRow): string[] {
  switch (row.status) {
    case '待签发':
      return ['签发许可', '作废工作票']
    case '已许可':
      return ['办理终结', '作废工作票']
    default:
      return []
  }
}
