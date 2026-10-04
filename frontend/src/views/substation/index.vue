<template>
  <section class="page" data-module="substation">
    <header class="page-head">
      <div>
        <h2>变电站台账管理</h2>
        <p class="page-desc">维护变电站，围绕站名、电压等级、所属供电所、主变台数做登记、筛选与状态流转。退役落定即从在用名册撤下，停用标记落在台账底稿上。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记变电站</button>
        <button class="btn" type="button" @click="exportRows">导出当前名册清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="scope-tabs">
      <button
        class="scope-tab"
        :class="{ active: scope === 'active' }"
        type="button"
        @click="switchScope('active')"
      >
        在用名册（{{ counts.running + counts.maintenance + counts.pending }}）
      </button>
      <button
        class="scope-tab"
        :class="{ active: scope === 'retired' }"
        type="button"
        @click="switchScope('retired')"
      >
        退役清册（{{ counts.retired }}）
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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <button v-if="column === '站名'" class="link" type="button" @click="openDetail(row.id)">
              {{ row[column] ?? '—' }}
            </button>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!availableActions(row).length" class="muted-text">手续已办结</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ scope === 'active' ? '在用名册暂无记录，退役站不会出现在这里' : '退役清册暂无已退役变电站' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ scope === 'active' ? '在用' : '退役' }}记录</span>
      <span v-if="pageCount > 1" class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ pageCount }} 页</span>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <!-- 重新登记：与既有变电站登记同一份口径，退役站重复登记会被挡下。 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记变电站</h3>
        <label v-for="field in formFields" :key="field" class="form-item">
          <span>{{ field }}<em v-if="requiredFields.includes(field)">*</em></span>
          <input v-model="createForm[field]" :placeholder="`请输入${field}`" />
        </label>
        <p class="form-tip">登记后状态为「待投运」，办完提交投运才进入在用名册；不会直接显示成在用。</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">提交登记</button>
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
        </div>
      </form>
    </div>

    <!-- 详情面板：站名、接线方式与名册同走 projectStation 一份底稿。 -->
    <div v-if="detail" class="modal-mask" @click.self="detail = undefined">
      <article class="modal detail-panel">
        <h3>{{ detail.站名 }} · 详情</h3>
        <dl class="detail-grid">
          <template v-for="field in columns" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detail[field] || '—' }}</dd>
          </template>
          <template v-if="detail.停用日期">
            <dt>停用日期</dt>
            <dd>{{ detail.停用日期 }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
        </dl>
        <h4>移交记录（站名、接线方式以最近一次移交为准）</h4>
        <ul class="transfer-list">
          <li v-for="(item, i) in transferHistory(detail)" :key="i">
            {{ item.date }} · {{ item.action }}：{{ item.from }} → {{ item.to }}（{{ item.operator }}）
            <template v-if="item.stationName || item.wiring">
              ｜站名：{{ item.stationName || '—' }}｜接线方式：{{ item.wiring || '—' }}
            </template>
          </li>
        </ul>
        <div class="modal-actions">
          <button class="btn" type="button" @click="detail = undefined">关闭</button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createStation,
  downloadEntries,
  getStation,
  listStations,
  moduleMeta,
  runAction as applyAction,
  stationCounts,
  type StationScope,
} from '@/api/local-service'
import type { EntryRow, TransferRecord } from '@/data/types'

const meta = moduleMeta('substation')
const columns = ['站名', '电压等级', '所属供电所', '主变台数', '投运日期', '站长', '接线方式', '站点状态']
const formFields = columns.filter((field) => field !== '站点状态')
const requiredFields = ['站名', '电压等级', '所属供电所', '接线方式']
const actionGuards: Record<string, string[]> = {
  提交投运: ['待投运'],
  安排检修: ['运行中'],
  办理退役: ['检修中'],
}

const PAGE_SIZE = 8

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const pageCount = ref(1)
const scope = ref<StationScope>('active')
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const counts = ref(stationCounts())

const creating = ref(false)
const detail = ref<EntryRow>()
const createForm = reactive<Record<string, string>>({})

const stats = computed(() => [
  { label: '在运站数', value: counts.value.running },
  { label: '停用站数', value: counts.value.retired },
  { label: '检修中变电站', value: counts.value.maintenance },
  { label: '待投运变电站', value: counts.value.pending },
])

const statusSummary = computed(() => {
  const source = (scope.value === 'active'
    ? ['待投运', '运行中', '检修中']
    : ['已退役']) as string[]
  return source.map((status) => ({
    status,
    count:
      status === '运行中'
        ? counts.value.running
        : status === '已退役'
          ? counts.value.retired
          : status === '检修中'
            ? counts.value.maintenance
            : counts.value.pending,
  }))
})

function availableActions(row: EntryRow): string[] {
  if (String(row.status) === '已退役') {
    return []
  }
  return Object.entries(actionGuards)
    .filter(([, allowed]) => allowed.includes(String(row.status)))
    .map(([action]) => action)
}

function transferHistory(row: EntryRow): TransferRecord[] {
  return Array.isArray(row.移交记录) ? row.移交记录 : []
}

function flash(message: string, ok: boolean) {
  errorMessage.value = ok ? '' : message
  successMessage.value = ok ? message : ''
}

function switchScope(next: StationScope) {
  scope.value = next
  page.value = 1
  reload()
}

function goPage(target: number) {
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

function openCreate() {
  for (const field of formFields) {
    createForm[field] = ''
  }
  creating.value = true
}

function submitCreate() {
  const result = createStation({
    站名: createForm.站名 ?? '',
    电压等级: createForm.电压等级 ?? '',
    所属供电所: createForm.所属供电所 ?? '',
    主变台数: createForm.主变台数 ?? '',
    投运日期: createForm.投运日期 ?? '',
    站长: createForm.站长 ?? '',
    接线方式: createForm.接线方式 ?? '',
  })
  flash(result.message, result.ok)
  if (!result.ok) {
    return
  }
  creating.value = false
  scope.value = 'active'
  page.value = 1
  reload()
}

function openDetail(id: number) {
  detail.value = getStation(Number(id))
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  flash(result.message, result.ok)
  reload()
}

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const payload = listStations({
      filters: filters.value,
      scope: scope.value,
      page: page.value,
      size: PAGE_SIZE,
    })
    rows.value = payload.items
    total.value = payload.total
    page.value = payload.page
    pageCount.value = Math.max(1, Math.ceil(payload.total / PAGE_SIZE))
    counts.value = stationCounts()
  } catch (error) {
    flash(error instanceof Error ? error.message : '变电站台账列表读取失败', false)
  }
}

onMounted(reload)
</script>

<style scoped>
.muted-text { color: var(--muted); font-size: 12px; }
.success-text { color: #067647; }
.scope-tabs { display: flex; gap: 8px; margin-bottom: 10px; }
.scope-tab { border: 1px solid var(--border); background: #fff; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 13px; }
.scope-tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.pager { display: inline-flex; align-items: center; gap: 8px; }
.pager .btn:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 20; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 520px; max-height: 82vh; overflow: auto; }
.modal h3 { margin: 0 0 12px; font-size: 16px; }
.modal h4 { margin: 14px 0 6px; font-size: 13px; }
.form-item, .detail-grid dt { font-size: 12px; color: var(--muted); }
.form-item { display: block; margin-bottom: 8px; }
.form-item span, .form-item input { display: block; width: 100%; }
.form-item input { margin-top: 3px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.form-item em { color: #b42318; font-style: normal; margin-left: 2px; }
.form-tip { font-size: 12px; color: var(--muted); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.detail-grid { display: grid; grid-template-columns: 110px 1fr; gap: 4px 12px; margin: 0; }
.detail-grid dt { color: var(--muted); }
.detail-grid dd { margin: 0; font-size: 13px; }
.transfer-list { margin: 0; padding-left: 18px; font-size: 12px; color: #334155; }
.transfer-list li { margin-bottom: 4px; }
</style>
