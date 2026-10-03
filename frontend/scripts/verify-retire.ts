// 退役收口端到端验证：内存 localStorage 桩 + 真实服务代码。
function makeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}
;(globalThis as any).window = { localStorage: makeStorage() }
;(globalThis as any).localStorage = (globalThis as any).window.localStorage

import { listStations, stationSummary, runRetireAction, runStationTransition, registerStation, getStation, getStationRaw, scopeCounts } from '@/api/substation-service'
import { listPermits, runPermitAction, permitCounts } from '@/api/workpermit-service'
import { loadOverview } from '@/api/local-service'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}
function find(name: string) {
  return listStations('all', {}, 1, 100).items.find((r) => r.站名 === name)!
}

// 1. 种子底稿：6 座站（在运 2、退役中 2、停用 1、待投运 1）
const s0 = stationSummary()
check('初始在运站数=2（云岭运行中、青溪检修中）', s0.inService === 2, JSON.stringify(s0))
check('初始停用站数=1（桃溪已移交）', s0.retired === 1)
check('初始退役办理中=2（石岗申请、白沙停电许可）', s0.decommissioning === 2)
check('初始在用名册只有3座（待投运+在运，退役中/停用均撤下）', scopeCounts().active === 3)

// 2. 概览卡片按底稿重算
const ov = loadOverview()
const card = (label: string) => ov.cards.find((c) => c.label === label)!.value
check('概览在运站数按底稿=2', card('在运站数') === 2)
check('概览停用站数按底稿=1', card('停用站数') === 1)
check('概览待办理工作票剔除退役站=2（WP-0001/0002）', card('待办理工作票') === 2)

// 3. 分页：停用站在过滤阶段撤下，任何页都翻不出来
const p1 = listStations('active', {}, 1, 2)
const p2 = listStations('active', {}, 2, 2)
const pagedNames = [...p1.items, ...p2.items].map((r) => r.站名)
check('在用名册分页不含退役/停用站', !pagedNames.includes('35kV桃溪变电站') && !pagedNames.includes('35kV石岗变电站'))
check('在用名册分页总数=3，翻页不漏站', p1.total === 3 && p2.items.length === 1)

// 4. 重复提交退役只认最早一次（石岗已在申请步）
const shigang = find('35kV石岗变电站')
const dup = runRetireAction(Number(shigang.id), '提交退役申请')
check('重复提交退役申请被挡回', !dup.ok && dup.message.includes('最早'))
const skip = runRetireAction(Number(shigang.id), '完成资产移交')
check('跳过停电许可/移交步骤被挡回并说明卡点', !skip.ok && skip.message.includes('跳步'))
const applyAgainFromBaisha = runRetireAction(Number(find('35kV白沙变电站').id), '提交退役申请')
check('停电许可步再次点申请也被挡回', !applyAgainFromBaisha.ok)

// 5. 待投运站不许直接退役、不显示成在用动作
const nanhu = find('110kV南湖变电站')
const tooEarly = runRetireAction(Number(nanhu.id), '提交退役申请')
check('没走完投运的站不许直接退役', !tooEarly.ok && tooEarly.message.includes('尚未投运'))

// 6. 正常退役流程走完：云岭 申请→停电许可→移交（同时改名+改接线）
const yunling = find('220kV云岭变电站')
let r = runRetireAction(Number(yunling.id), '提交退役申请')
check('运行中站提交退役申请成功', r.ok)
r = runRetireAction(Number(yunling.id), '办理停电许可')
check('申请后办理停电许可成功', r.ok)
const before = getStationRaw(Number(yunling.id))!
r = runRetireAction(Number(yunling.id), '完成资产移交', {
  team: '退役资产接收班',
  stationName: '220kV云岭遗产站',
  wiringMode: '单母线分段接线',
})
check('停电许可后完成移交成功并撤册停用', r.ok && r.message.includes('撤下'))
const afterAll = listStations('all', {}, 1, 100).items.find((x) => Number(x.id) === Number(yunling.id))!
check('移交后停用标记落到底稿', afterAll.停用标记 === true && afterAll.status === '已退役')
check('退役后在用名册撤下该站', !listStations('active', {}, 1, 100).items.some((x) => Number(x.id) === Number(yunling.id)))
check('退役后在运站数重算=1', stationSummary().inService === 1)
check('退役后停用站数重算=2', stationSummary().retired === 2)

// 7. 退役落定联动工作票：云岭名下待签发 WP-0001 自动作废；已许可 WP-0003 保留
const pendingAfter = listPermits('pending').map((x) => x.工作票号)
check('待办理清单撤下退役站待签发票（WP-0001 已作废）', !pendingAfter.includes('WP-2026-0001') && permitCounts().pending === 1)
const wp3 = listPermits('all').find((x) => x.工作票号 === 'WP-2026-0003')!
check('在途已许可工作票不被误作废', wp3.status === '已许可')
const wp1 = listPermits('all').find((x) => x.工作票号 === 'WP-2026-0001')!
check('联动作废写入作废原因', wp1.status === '已作废' && String(wp1.作废原因).includes('退役'))

// 8. 名册与详情同一口径：桃溪底稿值「桃溪开关站」，移交生效值「35kV桃溪变电站」
const taoxi = listStations('retired', {}, 1, 100).items.find((x) => String(x.站名).includes('桃溪'))!
check('名册读到的站名以最近移交为准', taoxi.站名 === '35kV桃溪变电站')
check('名册读到的接线方式以最近移交为准', taoxi.接线方式 === '单母线分段接线')
const detail = getStation(Number(taoxi.id))!
const raw = getStationRaw(Number(taoxi.id))!
check('详情面板与名册同一份口径', detail.站名 === '35kV桃溪变电站' && detail.接线方式 === '单母线分段接线')
check('底稿原值保留可追溯', String(raw.站名) === '桃溪开关站' && String(raw.接线方式) === '线路变压器组接线')

// 9. 退役站重新登记复用底稿，不产生重复
const beforeReg = listStations('all', {}, 1, 100).total
const reg = registerStation({ stationName: '35kV桃溪变电站', voltage: '35kV', office: '桃溪供电所' })
check('退役站重新登记成功并复用底稿', reg.ok && reg.message.includes('复用'))
const afterReg = listStations('all', {}, 1, 100)
check('重新登记不新增重复记录', afterReg.total === beforeReg)
const reopened = afterReg.items.find((x) => Number(x.id) === Number(taoxi.id))!
check('复用底稿重置为待投运、停用标记清除、移交记录清空', reopened.status === '待投运' && reopened.停用标记 === false && (reopened.移交记录 as unknown[]).length === 0)
check('复用底稿回到在用名册', listStations('active', {}, 1, 100).items.some((x) => Number(x.id) === Number(taoxi.id)))

// 10. 在册同名站重复登记被挡
const dupReg = registerStation({ stationName: '110kV青溪变电站' })
check('在册站重复登记被挡回', !dupReg.ok && dupReg.message.includes('不得重复登记'))

// 11. 退役办理中的站，工作票不予许可
const shigang2 = find('35kV石岗变电站')
// 给石岗挂一张待签发票验证许可拦截（直接登记走不到，借 workpermit 存储写一条）
import { saveRows, listRows } from '@/data/local-store'
const permits = listRows('workpermit')
const newId = permits.reduce((m, x) => Math.max(m, Number(x.id)), 0) + 1
saveRows('workpermit', [...permits, {
  id: newId, status: '待签发', pending: true, abnormal: false,
  工作票号: 'WP-TEST-X', 工作任务: '测试', 所属变电站: '35kV石岗变电站',
}])
const block = runPermitAction(newId, '签发许可')
check('退役办理中站的工作票许可被挡回并说明卡点', !block.ok && block.message.includes('退役'))
// 桃溪已重新登记为在役（待投运），其票仍可许可？待投运未停用——按规则可许可，无退役标记
const taoxiTicket = listPermits('all').find((x) => x.工作票号 === 'WP-2026-0005')!
// 桃溪已被重新登记，但 WP-0005 已是已作废终态，不验证许可

// 12. 常规流转守卫：检修中的站不能直接投运
const qingxi = find('110kV青溪变电站')
const bad = runStationTransition(Number(qingxi.id), '提交投运')
check('非待投运站点提交投运被挡回', !bad.ok)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
