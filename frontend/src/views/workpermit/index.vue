<template>
  <section class="page" data-module="workpermit">
    <header class="page-head">
      <div>
        <h2>工作票许可管理</h2>
        <p class="page-desc">待办理清单由变电站退役底稿驱动：已停用站的票自动撤下；退役办理中的站不予新许可。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出工作票许可清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
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
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in permitActions(row)"
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
          <td :colspan="columns.length + 2" class="empty-state">{{ emptyText }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条记录</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  listPermits,
  permitActions,
  permitCounts,
  runPermitAction,
  type PermitScope,
} from '@/api/workpermit-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('workpermit')
const columns = ['工作票号', '工作任务', '所属变电站', '停电范围', '工作负责人', '许可时间', '终结时间', '许可状态']
const filterFields = ['工作票号', '工作任务', '所属变电站']

const rows = ref<EntryRow[]>([])
const message = ref('')
const messageOk = ref(false)
const filters = ref<Record<string, string>>({})
const scope = ref<PermitScope>('pending')

const stats = ref([
  { label: '待办理工作票', value: 0 },
  { label: '已许可工作票', value: 0 },
  { label: '已终结/作废', value: 0 },
])

const scopeTabs = ref<{ key: PermitScope; label: string; count: number }[]>([
  { key: 'pending', label: '待办理', count: 0 },
  { key: 'issued', label: '已许可', count: 0 },
  { key: 'closed', label: '已终结/作废', count: 0 },
  { key: 'all', label: '全部', count: 0 },
])

const emptyText = computed(() => {
  if (scope.value === 'pending') {
    return '待办理清单为空：在役站没有待签发工作票，已退役站的票已随退役撤下并作废'
  }
  return '暂无工作票许可数据'
})

function refreshCounters() {
  const counts = permitCounts()
  stats.value = [
    { label: '待办理工作票', value: counts.pending },
    { label: '已许可工作票', value: counts.issued },
    { label: '已终结/作废', value: counts.closed },
  ]
  scopeTabs.value = scopeTabs.value.map((tab) => ({
    ...tab,
    count: tab.key === 'pending'
      ? counts.pending
      : tab.key === 'issued'
        ? counts.issued
        : tab.key === 'closed'
          ? counts.closed
          : counts.all,
  }))
}

function reload() {
  message.value = ''
  rows.value = listPermits(scope.value, filters.value)
  refreshCounters()
}

function switchScope(next: PermitScope) {
  scope.value = next
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  const result = runPermitAction(Number(row.id), action)
  reload()
  message.value = result.message
  messageOk.value = result.ok
}

onMounted(reload)
</script>
