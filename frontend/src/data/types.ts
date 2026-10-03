/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryValue = string | number | boolean | HandoverEntry[] | null

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: EntryValue
}

/** 移交记录：站名、接线方式在名册与详情两处都以最近一次移交为准。 */
export type HandoverEntry = {
  date: string
  team: string
  stationName?: string
  wiringMode?: string
  note?: string
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
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 变电站在用名册的口径：在用只含未进入退役流程、也未落定停用的站。 */
export type StationScope = 'active' | 'decommissioning' | 'retired' | 'all'

export type StationSummary = {
  /** 在运站数：已经从在用名册撤下、停用标记落定的站不计入 */
  inService: number
  /** 停用站数：退役手续走完、停用标记落到底稿上的站 */
  retired: number
  /** 退役办理中：申请已提交但手续未走完 */
  decommissioning: number
  total: number
}

export type StationPageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  scope: StationScope
}
