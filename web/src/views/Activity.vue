<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { ActivityEvent, ActivityAction, ActivityQuery, AuditExportFormat } from '../core/models';
import { api, apiErrMsg } from '../core/api';
import { timeAgoPhrase } from '../core/util';
import { t, fmtDateTime, type MessageKey } from '../i18n';
import { useEdition, PRICING_URL } from '../core/edition';
import { useToast } from '../core/toast';
import Icon from '../components/Icon.vue';

const props = defineProps<{ query: string }>();

const ACT_META: Record<ActivityAction, { icon: string; col: string; verb: MessageKey | null }> = {
  upload:   { icon: 'upload',   col: 'var(--neon)',   verb: 'activity.verb.upload' },
  download: { icon: 'download', col: 'var(--green)',  verb: 'activity.verb.download' },
  delete:   { icon: 'trash',    col: 'var(--danger)', verb: 'activity.verb.delete' },
  grant:    { icon: 'shield',   col: 'var(--amber)',  verb: 'activity.verb.grant' },
  revoke:   { icon: 'x',        col: 'var(--danger)', verb: 'activity.verb.revoke' },
  key:      { icon: 'key',      col: 'var(--amber)',  verb: null },
  bucket:   { icon: 'database', col: 'var(--neon)',   verb: null },
  share:    { icon: 'share',    col: 'var(--neon)',   verb: 'activity.verb.share' },
};
const ACTION_OPTIONS = Object.keys(ACT_META) as ActivityAction[];
const PAGE_SIZE = 200;
const EXPORT_OPTIONS: { format: AuditExportFormat; label: MessageKey }[] = [
  { format: 'csv', label: 'activity.exportCsv' },
  { format: 'json', label: 'activity.exportJson' },
  { format: 'ndjson', label: 'activity.exportNdjson' },
];

const toast = useToast();
const { has } = useEdition();
const canExport = computed(() => has('audit-export'));

const events = ref<ActivityEvent[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const hasMore = ref(false);
const error = ref<string | null>(null);
const exportMenuOpen = ref(false);
const exporting = ref(false);

const dateFrom = ref('');
const dateTo = ref('');
const actionFilter = ref('');
const actorFilter = ref('');

const hasFilters = computed(() => !!(dateFrom.value || dateTo.value || actionFilter.value || actorFilter.value.trim()));

const filtered = computed(() => {
  const q = props.query.trim().toLowerCase();
  if (!q) return events.value;
  return events.value.filter((a) => (a.actor + a.bucket + a.target + a.action).toLowerCase().includes(q));
});

function localDayBoundary(day: string, endOfDay: boolean): string | undefined {
  if (!day) return undefined;
  const date = new Date(`${day}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function currentFilters(): ActivityQuery {
  return {
    since: localDayBoundary(dateFrom.value, false),
    until: localDayBoundary(dateTo.value, true),
    action: actionFilter.value || undefined,
    actor: actorFilter.value.trim() || undefined,
  };
}

async function reload() {
  loading.value = true; error.value = null;
  try {
    const page = (await api.activity({ ...currentFilters(), limit: PAGE_SIZE })) ?? [];
    events.value = page;
    hasMore.value = page.length === PAGE_SIZE;
  }
  catch (e) { error.value = apiErrMsg(e); }
  finally { loading.value = false; }
}

async function loadMore() {
  const last = events.value[events.value.length - 1];
  if (!last || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const page = await api.activity({ ...currentFilters(), limit: PAGE_SIZE, before: last.id });
    events.value = [...events.value, ...page];
    hasMore.value = page.length === PAGE_SIZE;
  } catch (e) { toast.error(apiErrMsg(e)); }
  finally { loadingMore.value = false; }
}

function clearFilters() {
  dateFrom.value = ''; dateTo.value = ''; actionFilter.value = ''; actorFilter.value = '';
  void reload();
}

function exportFilename(format: AuditExportFormat): string {
  const today = new Date().toISOString().slice(0, 10);
  return `cockpit-audit-${dateFrom.value || t('activity.exportFileStart')}-${dateTo.value || today}.${format}`;
}

async function exportAs(format: AuditExportFormat) {
  exportMenuOpen.value = false;
  exporting.value = true;
  try {
    const blob = await api.exportActivity(format, currentFilters());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = exportFilename(format);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch (e) { toast.error(apiErrMsg(e, 'export')); }
  finally { exporting.value = false; }
}

function toggleExportMenu() {
  if (canExport.value) exportMenuOpen.value = !exportMenuOpen.value;
}
const closeExportMenu = () => { exportMenuOpen.value = false; };

onMounted(() => {
  void reload();
  window.addEventListener('click', closeExportMenu);
});
onBeforeUnmount(() => window.removeEventListener('click', closeExportMenu));
defineExpose({ reload });

const meta = (a: ActivityEvent) => ACT_META[a.action] ?? ACT_META.bucket;
</script>

<template>
  <div class="view">
    <div class="view-head">
      <div>
        <h1 class="view-title">{{ t('activity.title') }}</h1>
        <p class="view-sub">{{ t('activity.subtitle') }}</p>
      </div>
      <div class="act-export" @click.stop>
        <button class="btn" :disabled="!canExport || exporting"
                :title="canExport ? t('activity.exportTitle') : t('activity.exportProTitle')"
                @click="toggleExportMenu">
          <Icon :name="canExport ? 'download' : 'lock'" :size="15" />{{ exporting ? t('activity.exporting') : t('activity.export') }}
        </button>
        <div v-if="exportMenuOpen" class="act-menu">
          <button v-for="o in EXPORT_OPTIONS" :key="o.format" class="act-menu-item" @click="exportAs(o.format)">{{ t(o.label) }}</button>
        </div>
      </div>
    </div>

    <div class="act-filters">
      <label class="act-field">
        <span class="field-label">{{ t('activity.from') }}</span>
        <input v-model="dateFrom" class="field-input" type="date" :max="dateTo || undefined" @change="reload" />
      </label>
      <label class="act-field">
        <span class="field-label">{{ t('activity.to') }}</span>
        <input v-model="dateTo" class="field-input" type="date" :min="dateFrom || undefined" @change="reload" />
      </label>
      <label class="act-field">
        <span class="field-label">{{ t('activity.action') }}</span>
        <select v-model="actionFilter" class="field-input" @change="reload">
          <option value="">{{ t('activity.allActions') }}</option>
          <option v-for="a in ACTION_OPTIONS" :key="a" :value="a">{{ a }}</option>
        </select>
      </label>
      <label class="act-field act-field-grow">
        <span class="field-label">{{ t('activity.user') }}</span>
        <input v-model="actorFilter" class="field-input" :placeholder="t('activity.userPlaceholder')" @change="reload" @keydown.enter="reload" />
      </label>
      <button v-if="hasFilters" class="btn act-clear" @click="clearFilters"><Icon name="x" :size="14" />{{ t('activity.clear') }}</button>
    </div>
    <div v-if="!canExport" class="act-pro-hint">
      <Icon name="lock" :size="13" />
      {{ t('activity.proHint') }}
      <a :href="PRICING_URL" target="_blank" rel="noopener">{{ t('activity.seePlans') }}</a>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>{{ t('activity.loading') }}</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">{{ t('activity.loadError') }}</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />{{ t('activity.tryAgain') }}</button>
    </div>
    <div v-else-if="filtered.length === 0" class="empty">{{ query || hasFilters ? t('activity.noMatches') : t('activity.empty') }}</div>
    <div v-else class="timeline">
      <div v-for="a in filtered" :key="a.id" class="tl-row">
        <div class="tl-icon" :style="{ '--c': meta(a).col }"><Icon :name="meta(a).icon" :size="15" /></div>
        <div class="tl-body">
          <div class="tl-main"><strong>{{ a.actor }}</strong> {{ meta(a).verb ? t(meta(a).verb!) : '' }} <span class="tl-target">{{ a.target }}</span></div>
          <div class="tl-meta">
            <span class="tl-bucket"><Icon name="database" :size="11" /> {{ a.bucket }}</span>
            <span class="dot-sep">·</span><span :title="fmtDateTime(a.at)">{{ timeAgoPhrase(a.at) }}</span>
          </div>
        </div>
        <div class="tl-action-tag" :style="{ color: meta(a).col, borderColor: meta(a).col }">{{ a.action }}</div>
      </div>
      <button v-if="hasMore" class="btn act-more" :disabled="loadingMore" @click="loadMore">
        <Icon name="plus" :size="14" />{{ loadingMore ? t('activity.loadingMore') : t('activity.loadMore') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.act-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; margin-bottom: 10px; max-width: 880px; }
.act-field { display: flex; flex-direction: column; gap: 4px; min-width: 140px; }
.act-field .field-label { margin: 0; }
.act-field-grow { flex: 1; min-width: 180px; }
.act-clear { flex: none; }
.act-pro-hint {
  display: flex; align-items: center; gap: 6px; margin-bottom: 14px;
  font-size: 12.5px; color: var(--text-3);
}
.act-pro-hint .ic { color: var(--amber); }
.act-pro-hint a { color: var(--neon); }
.act-export { position: relative; flex: none; }
.act-menu {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 180px;
  display: flex; flex-direction: column; padding: 4px;
  background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, .35);
}
.act-menu-item {
  text-align: left; padding: 8px 10px; border: 0; border-radius: 7px; background: none;
  color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer;
}
.act-menu-item:hover { background: var(--bg-3); color: var(--text); }
.act-more { align-self: center; margin-top: 12px; }
</style>
