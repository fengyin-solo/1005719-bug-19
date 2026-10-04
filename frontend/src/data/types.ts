/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 移交记录：每次建账登记 / 状态流转都在同一份底稿上追加一条，最近一条的站名、接线方式为准。
export type TransferRecord = {
  date: string
  action: string
  from: string
  to: string
  operator: string
  stationName?: string
  wiring?: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  移交记录?: TransferRecord[]
  [field: string]: string | number | boolean | TransferRecord[] | undefined
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  // 动作只允许在这些当前状态下办理；不登记就沿用通用的「目标态去重」校验。
  transitions?: Record<string, string[]>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  // 退役落定时连带作废的未终结工作票数，用来驱动工作票待办理清单。
  voidedPermits?: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
