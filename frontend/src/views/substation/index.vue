<template>
  <section class="page" data-module="substation">
    <header class="page-head">
      <div>
        <h2>变电站台账管理</h2>
        <p class="page-desc">一座站一份底稿：退役在底稿上走「申请 → 停电许可 → 资产移交」三步，落定后撤下在用名册并打上停用标记。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记变电站</button>
        <button class="btn" type="button" @click="exportRows">导出变电站台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in summaryCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="scope-tabs" role="tablist">
      <button
        v-for="tab in scopeTabs"
        :key="tab.key"
        class="scope-tab"
        :class="{ active: scope === tab.key }"
        type="button"
        @click="switchScope(tab.key)"
      >
        {{ tab.label }}（{{ tab.count }}）
      </button>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>停用标记</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.停用标记 ? '已停用' : '在册' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">{{ emptyText }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot page-foot--paged">
      <span>共 {{ total }} 条记录，第 {{ page }} / {{ totalPages }} 页</span>
      <span class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button class="btn" type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
      </span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 登记 / 重新登记 -->
    <div v-if="createOpen" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3>登记变电站</h3>
        <p class="modal-hint">与既有变电站登记口径一致（站名、电压等级、所属供电所、主变台数等）；同名站若已退役，复用原底稿重新登记，不会重复建档。</p>
        <form class="modal-form" @submit.prevent="submitCreate">
          <label v-for="field in createFields" :key="field.key" class="form-item">
            <span>{{ field.label }}<em v-if="field.required">*</em></span>
            <input v-model="createForm[field.key]" :placeholder="field.placeholder" />
          </label>
          <div class="modal-actions">
            <button class="btn primary" type="submit">提交登记</button>
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          </div>
          <p v-if="createError" class="error-text">{{ createError }}</p>
        </form>
      </div>
    </div>

    <!-- 资产移交（退役最后一步） -->
    <div v-if="handoverOpen" class="modal-mask" @click.self="closeHandover">
      <div class="modal">
        <h3>完成资产移交 · {{ handoverTarget?.站名 }}</h3>
        <p class="modal-hint">移交完成即退役落定：撤下在用名册、停用标记落到底稿。站名、接线方式留空表示沿用底稿；填写后以本次移交记录为准。</p>
        <form class="modal-form" @submit.prevent="submitHandover">
          <label class="form-item">
            <span>接收班组<em>*</em></span>
            <input v-model="handoverForm.team" placeholder="如：退役资产接收班" />
          </label>
          <label class="form-item">
            <span>移交后站名</span>
            <input v-model="handoverForm.stationName" :placeholder="`留空沿用：${handoverTarget?.站名}`" />
          </label>
          <label class="form-item">
            <span>移交后接线方式</span>
            <input v-model="handoverForm.wiringMode" :placeholder="`留空沿用：${handoverTarget?.接线方式}`" />
          </label>
          <label class="form-item">
            <span>移交说明</span>
            <input v-model="handoverForm.note" placeholder="可选" />
          </label>
          <div class="modal-actions">
            <button class="btn primary" type="submit">确认移交，退役落定</button>
            <button class="btn ghost" type="button" @click="closeHandover">取消</button>
          </div>
          <p v-if="handoverError" class="error-text">{{ handoverError }}</p>
        </form>
      </div>
    </div>

    <!-- 详情面板：名册与详情读同一份底稿 -->
    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <div class="modal modal--wide">
        <h3>变电站详情 · {{ detail.站名 }}</h3>
        <table class="data-table detail-table">
          <tbody>
            <tr v-for="field in detailFields" :key="field.key">
              <th>{{ field.label }}</th>
              <td>
                {{ detail[field.key] || '—' }}
                <span v-if="field.overridden" class="overridden-tag">
                  底稿原值「{{ field.original }}」，已按最近一次移交记录更新
                </span>
              </td>
            </tr>
            <tr>
              <th>当前状态 / 停用标记</th>
              <td>{{ detail.status }} · {{ detail.停用标记 ? '已停用（已从在用名册撤下）' : '在册未停用' }}</td>
            </tr>
          </tbody>
        </table>

        <h4 class="detail-sub">退役手续进度</h4>
        <ol class="step-list">
          <li v-for="step in timeline" :key="step.label" class="step-item" :class="{ done: step.done }">
            <span class="step-label">{{ step.label }}</span>
            <span class="step-time">{{ step.time || '未办理' }}</span>
          </li>
        </ol>

        <h4 class="detail-sub">移交记录（最近一次为准）</h4>
        <table v-if="handovers.length" class="data-table">
          <thead>
            <tr><th>移交时间</th><th>接收班组</th><th>移交站名</th><th>接线方式</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in handovers" :key="idx">
              <td>{{ item.date }}</td>
              <td>{{ item.team }}</td>
              <td>{{ item.stationName || '沿用' }}</td>
              <td>{{ item.wiringMode || '沿用' }}</td>
              <td>{{ item.note || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="modal-hint">暂无移交记录。</p>

        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  availableActions,
  getStation,
  getStationRaw,
  handoversOf,
  listStations,
  registerStation,
  retireTimeline,
  runRetireAction,
  runStationTransition,
  scopeCounts,
  stationSummary,
  type HandoverForm,
  type StationForm,
  type StationScope,
} from '@/api/substation-service'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow, HandoverEntry } from '@/data/types'

const meta = moduleMeta('substation')
const columns = ['站名', '电压等级', '所属供电所', '主变台数', '投运日期', '站长', '接线方式', '站点状态']
const filterFields = ['站名', '电压等级', '所属供电所']
const statuses = ['待投运', '运行中', '检修中', '退役申请', '停电许可', '已退役']
const PAGE_SIZE = 10

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const scope = ref<StationScope>('active')
const filters = ref<Record<string, string>>({})
const message = ref('')
const messageOk = ref(false)

const summaryCards = ref([
  { label: '在运站数', value: 0 },
  { label: '停用站数', value: 0 },
  { label: '退役办理中', value: 0 },
  { label: '台账总数', value: 0 },
])

const scopeTabs = ref<{ key: StationScope; label: string; count: number }[]>([
  { key: 'active', label: '在用名册', count: 0 },
  { key: 'decommissioning', label: '退役办理中', count: 0 },
  { key: 'retired', label: '已停用', count: 0 },
  { key: 'all', label: '全部底稿', count: 0 },
])

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const emptyText = computed(() => {
  if (scope.value === 'active') {
    return '在用名册暂无记录：退役站落定后即从这里撤下，翻页也不会出现'
  }
  if (scope.value === 'decommissioning') {
    return '当前没有卡在退役手续中的站'
  }
  if (scope.value === 'retired') {
    return '暂无已停用站'
  }
  return '暂无变电站台账数据，可先登记变电站'
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function flash(text: string, ok = false) {
  message.value = text
  messageOk.value = ok
}

function refreshCounters() {
  const summary = stationSummary()
  summaryCards.value = [
    { label: '在运站数', value: summary.inService },
    { label: '停用站数', value: summary.retired },
    { label: '退役办理中', value: summary.decommissioning },
    { label: '台账总数', value: summary.total },
  ]
  const counts = scopeCounts()
  scopeTabs.value = scopeTabs.value.map((tab: { key: StationScope; label: string; count: number }) => ({
    ...tab,
    count: counts[tab.key],
  }))
}

function reload() {
  const payload = listStations(scope.value, filters.value, page.value, PAGE_SIZE)
  rows.value = payload.items
  total.value = payload.total
  if (page.value > totalPages.value) {
    page.value = totalPages.value
    reload()
    return
  }
  refreshCounters()
}

function switchScope(next: StationScope) {
  scope.value = next
  page.value = 1
  message.value = ''
  reload()
}

function goPage(target: number) {
  if (target < 1 || target > totalPages.value) {
    return
  }
  page.value = target
  reload()
}

function resetFilters() {
  filters.value = {}
  page.value = 1
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// —— 登记 ——
const createOpen = ref(false)
const createError = ref('')
const createFields = [
  { key: 'stationName', label: '站名', required: true, placeholder: '如：110kV东湖变电站' },
  { key: 'voltage', label: '电压等级', required: false, placeholder: '如：110kV' },
  { key: 'office', label: '所属供电所', required: false, placeholder: '如：东湖供电所' },
  { key: 'transformerCount', label: '主变台数', required: false, placeholder: '如：2' },
  { key: 'commissionDate', label: '投运日期', required: false, placeholder: 'YYYY-MM-DD' },
  { key: 'manager', label: '站长', required: false, placeholder: '' },
  { key: 'wiringMode', label: '接线方式', required: false, placeholder: '如：单母线分段接线' },
] as const
const createForm = reactive<StationForm>({
  stationName: '',
  voltage: '',
  office: '',
  transformerCount: '',
  commissionDate: '',
  manager: '',
  wiringMode: '',
})

function openCreate() {
  createError.value = ''
  Object.assign(createForm, {
    stationName: '',
    voltage: '',
    office: '',
    transformerCount: '',
    commissionDate: '',
    manager: '',
    wiringMode: '',
  })
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

function submitCreate() {
  const result = registerStation({ ...createForm })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  page.value = 1
  scope.value = 'active'
  reload()
  flash(result.message, true)
}

// —— 退役手续动作 ——
const handoverOpen = ref(false)
const handoverError = ref('')
const handoverTarget = ref<EntryRow | null>(null)
const handoverForm = reactive<HandoverForm>({ team: '', stationName: '', wiringMode: '', note: '' })

function runAction(action: string, row: EntryRow) {
  message.value = ''
  if (action === '完成资产移交') {
    openHandover(row)
    return
  }
  const result =
    action === '提交退役申请' || action === '办理停电许可'
      ? runRetireAction(Number(row.id), action)
      : runStationTransition(Number(row.id), action)
  flash(result.message, result.ok)
  reload()
}

function openHandover(row: EntryRow) {
  handoverTarget.value = row
  handoverError.value = ''
  handoverForm.team = ''
  handoverForm.stationName = ''
  handoverForm.wiringMode = ''
  handoverForm.note = ''
  handoverOpen.value = true
}

function closeHandover() {
  handoverOpen.value = false
  handoverTarget.value = null
}

function submitHandover() {
  if (!handoverTarget.value) {
    return
  }
  const result = runRetireAction(Number(handoverTarget.value.id), '完成资产移交', { ...handoverForm })
  if (!result.ok) {
    handoverError.value = result.message
    return
  }
  handoverOpen.value = false
  handoverTarget.value = null
  page.value = 1
  scope.value = 'active'
  reload()
  flash(result.message, true)
}

// —— 详情面板 ——
const detail = ref<EntryRow | null>(null)
const timeline = ref<{ label: string; time: string; done: boolean }[]>([])
const handovers = ref<HandoverEntry[]>([])

const detailFields = computed(() => {
  if (!detail.value) {
    return []
  }
  const effective = detail.value
  const raw = getStationRaw(Number(effective.id))
  const labels: Record<string, string> = {
    站名: '站名',
    电压等级: '电压等级',
    所属供电所: '所属供电所（运维班组口径）',
    主变台数: '主变台数',
    投运日期: '投运日期',
    站长: '站长',
    接线方式: '接线方式',
  }
  return ['站名', '电压等级', '所属供电所', '主变台数', '投运日期', '站长', '接线方式'].map((key) => {
    const original = String(raw?.[key] ?? '')
    const overridden = (key === '站名' || key === '接线方式') && original !== String(effective[key] ?? '')
    return { key, label: labels[key], original, overridden }
  })
})

function openDetail(row: EntryRow) {
  const station = getStation(Number(row.id))
  if (!station) {
    flash('底稿读取失败', false)
    return
  }
  detail.value = station
  timeline.value = retireTimeline(station)
  handovers.value = handoversOf(station)
}

function closeDetail() {
  detail.value = null
}

onMounted(reload)
</script>
