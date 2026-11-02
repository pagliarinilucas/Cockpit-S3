<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { User, Group, Bucket, Perm, Role, UserGrant } from '../core/models';
import { api, apiErrMsg, ApiError } from '../core/api';
import { useToast } from '../core/toast';
import PermPicker from '../components/PermPicker.vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import FolderPicker from '../components/FolderPicker.vue';
import { t, fmtDateTime, type MessageKey } from '../i18n';
import { timeAgoPhrase } from '../core/util';

const toast = useToast();
const around = (key: MessageKey) => t(key, { name: '\u0000' }).split('\u0000');
const tab = ref<'users' | 'groups'>('users');
const users = ref<User[]>([]);
const groups = ref<Group[]>([]);
const buckets = ref<Bucket[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const bucketName = (id: string) => buckets.value.find((b) => b.id === id)?.name ?? id;
const groupName = (id: string) => groups.value.find((g) => g.id === id)?.name ?? id;

async function reload() {
  loading.value = true; error.value = null;
  try {
    users.value = (await api.users()) ?? [];
    try { groups.value = (await api.groups()) ?? []; } catch { groups.value = []; }
    try { buckets.value = (await api.buckets()) ?? []; } catch { buckets.value = []; }
  } catch (e) { error.value = apiErrMsg(e); }
  finally { loading.value = false; }
}
onMounted(reload);
defineExpose({ reload });

// ── new user ──
const showNew = ref(false);
const newErr = ref<string | null>(null);
const nu = ref<{ username: string; password: string; role: Role }>({ username: '', password: '', role: 'user' });
function openNew() { nu.value = { username: '', password: '', role: 'user' }; newErr.value = null; showNew.value = true; }
async function create() {
  const { username, password, role } = nu.value;
  if (!username.trim()) { newErr.value = t('users.errUsernameRequired'); return; }
  if (password.length < 6) { newErr.value = t('users.errPasswordShort'); return; }
  try {
    await api.createUser(username.trim(), password, role);
    toast.success(t('users.userCreated', { name: username }));
    showNew.value = false; reload();
  } catch (e) {
    newErr.value = e instanceof ApiError && e.status === 409 ? t('users.errUserExists') : t('users.errCreateUser');
  }
}

// ── reset / delete user ──
const resetUser = ref<string | null>(null);
const resetPwd = ref('');
const delUser = ref<string | null>(null);
function openReset(username: string) { resetPwd.value = ''; resetUser.value = username; }
async function confirmReset() {
  const u = resetUser.value; if (!u) return;
  if (resetPwd.value.length < 6) { toast.error(t('users.errPasswordShortToast')); return; }
  try { await api.resetPassword(u, resetPwd.value); toast.success(t('users.passwordReset', { name: u })); resetUser.value = null; }
  catch { toast.error(t('users.errResetPassword')); }
}
async function confirmDelete() {
  const u = delUser.value; if (!u) return;
  delUser.value = null;
  try { await api.deleteUser(u); toast.success(t('users.userDeleted', { name: u })); reload(); }
  catch { toast.error(t('users.errDeleteUser')); }
}

// ── toggle "pode compartilhar" ──
async function toggleCanShare(u: User) {
  try {
    const updated = await api.setUserCanShare(u.username, !u.canShare);
    users.value = users.value.map((x) => x.username === u.username ? updated : x);
    toast.success(updated.canShare ? t('users.nowCanShare', { name: u.username }) : t('users.noLongerCanShare', { name: u.username }));
  } catch { toast.error(t('users.errShareToggle')); }
}

// ── user permissions editor ──
const editUser = ref<User | null>(null);
function openPerms(u: User) { editUser.value = u; }
function refreshEditUser(updated: User | null) {
  if (!updated) return;
  editUser.value = updated;
  users.value = users.value.map((x) => x.username === updated.username ? updated : x);
}
async function toggleGroup(g: Group) {
  const u = editUser.value; if (!u) return;
  const member = !u.groups.includes(g.id);
  try { refreshEditUser(await api.setUserGroup(u.username, g.id, member)); await reloadGroupsKeepEditor(); }
  catch { toast.error(t('users.errGroupChange')); }
}
async function setUserGrantPerm(gr: UserGrant, perm: Perm) {
  const u = editUser.value; if (!u) return;
  try { refreshEditUser(await api.setUserGrant(u.username, gr.bucketId, gr.prefix, perm)); }
  catch { toast.error(t('users.errPermChange')); }
}
async function removeUserGrant(gr: UserGrant) {
  const u = editUser.value; if (!u) return;
  try { refreshEditUser(await api.setUserGrant(u.username, gr.bucketId, gr.prefix, null)); }
  catch { toast.error(t('users.errRemove')); }
}
async function removeUserBlock(b: { bucketId: string; prefix: string }) {
  const u = editUser.value; if (!u) return;
  try { refreshEditUser(await api.setUserBlock(u.username, b.bucketId, b.prefix, false)); }
  catch { toast.error(t('users.errRemoveBlock')); }
}

// ── add grant / block flow (shared picker) ──
// mode: 'user-grant' | 'user-block' | 'group-grant'
const picker = ref<{ mode: string; subjectId: string; bucketId: string; step: 'bucket' | 'folder' } | null>(null);
function startAdd(mode: string, subjectId: string) {
  const bucketId = buckets.value[0]?.id;
  if (!bucketId) { toast.error(t('users.errNoBucket')); return; }
  picker.value = { mode, subjectId, bucketId, step: 'bucket' };
}
async function onPick(prefix: string) {
  const p = picker.value; if (!p) return;
  picker.value = null;
  try {
    if (p.mode === 'user-grant') refreshEditUser(await api.setUserGrant(p.subjectId, p.bucketId, prefix, 'read-only'));
    else if (p.mode === 'user-block') refreshEditUser(await api.setUserBlock(p.subjectId, p.bucketId, prefix, true));
    else if (p.mode === 'group-grant') { await api.setGroupGrant(p.subjectId, p.bucketId, prefix, 'read-only'); await reloadGroupsKeepEditor(); }
  } catch { toast.error(t('users.errAdd')); }
}

// ── groups ──
const showNewGroup = ref(false);
const newGroupName = ref('');
const editGroup = ref<Group | null>(null);
async function reloadGroupsKeepEditor() {
  groups.value = (await api.groups()) ?? [];
  if (editGroup.value) editGroup.value = groups.value.find((g) => g.id === editGroup.value!.id) ?? null;
}
async function createGroup() {
  const name = newGroupName.value.trim();
  if (!name) return;
  try { await api.createGroup(name); newGroupName.value = ''; showNewGroup.value = false; await reload(); }
  catch (e) { toast.error(e instanceof ApiError && e.status === 409 ? t('users.errGroupExists') : t('users.errCreateGroup')); }
}
const delGroup = ref<Group | null>(null);
async function confirmDeleteGroup() {
  const g = delGroup.value; if (!g) return; delGroup.value = null;
  try { await api.deleteGroup(g.id); toast.success(t('users.groupDeleted', { name: g.name })); if (editGroup.value?.id === g.id) editGroup.value = null; await reload(); }
  catch { toast.error(t('users.errDeleteGroup')); }
}
async function setGroupGrantPerm(g: Group, gr: { bucketId: string; prefix: string; perm: Perm }, perm: Perm) {
  try { await api.setGroupGrant(g.id, gr.bucketId, gr.prefix, perm); await reloadGroupsKeepEditor(); }
  catch { toast.error(t('users.errPermChange')); }
}
async function removeGroupGrant(g: Group, gr: { bucketId: string; prefix: string }) {
  try { await api.setGroupGrant(g.id, gr.bucketId, gr.prefix, null); await reloadGroupsKeepEditor(); }
  catch { toast.error(t('users.errRemove')); }
}

type RosterFilter = 'all' | 'admin' | 'user' | 'share' | 'noaccess' | 'never';
type RosterSort = 'name' | 'recent' | 'access';
const ROSTER_FILTERS: RosterFilter[] = ['all', 'admin', 'user', 'share', 'noaccess', 'never'];
const ROSTER_SORTS: RosterSort[] = ['name', 'recent', 'access'];

const search = ref('');
const filter = ref<RosterFilter>('all');
const groupFilter = ref('');
const sort = ref<RosterSort>('name');
const searchInput = ref<HTMLInputElement | null>(null);

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function reachableBuckets(u: User): number {
  const ids = new Set(u.grants.map((g) => g.bucketId));
  for (const gid of u.groups) for (const gr of groups.value.find((g) => g.id === gid)?.grants ?? []) ids.add(gr.bucketId);
  return ids.size;
}
const hasNoAccess = (u: User) => u.role !== 'admin' && reachableBuckets(u) === 0;

const matchesFilter = (u: User, f: RosterFilter) => {
  if (f === 'admin') return u.role === 'admin';
  if (f === 'user') return u.role !== 'admin';
  if (f === 'share') return u.role === 'admin' || !!u.canShare;
  if (f === 'noaccess') return hasNoAccess(u);
  if (f === 'never') return !u.lastLogin;
  return true;
};

const matchesSearch = (u: User, q: string) => {
  if (!q) return true;
  if (normalize(u.username).includes(q)) return true;
  return u.groups.some((gid) => normalize(groupName(gid)).includes(q));
};

const filterCounts = computed(() => {
  const counts = {} as Record<RosterFilter, number>;
  for (const f of ROSTER_FILTERS) counts[f] = users.value.filter((u) => matchesFilter(u, f)).length;
  return counts;
});

const filteredUsers = computed(() => {
  const q = normalize(search.value.trim());
  const list = users.value.filter((u) =>
    matchesFilter(u, filter.value)
    && (!groupFilter.value || u.groups.includes(groupFilter.value))
    && matchesSearch(u, q));
  const byName = (a: User, b: User) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
  if (sort.value === 'recent') return list.sort((a, b) => (b.lastLogin ?? '').localeCompare(a.lastLogin ?? '') || byName(a, b));
  if (sort.value === 'access') {
    const weight = (u: User) => (u.role === 'admin' ? Number.MAX_SAFE_INTEGER : reachableBuckets(u));
    return list.sort((a, b) => weight(b) - weight(a) || byName(a, b));
  }
  return list.sort(byName);
});

const letterOf = (u: User) => {
  const first = normalize(u.username).charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
};
const showLetters = computed(() => sort.value === 'name' && filteredUsers.value.length > 30);

const filteredGroups = computed(() => {
  const q = normalize(search.value.trim());
  return groups.value
    .filter((g) => !q || normalize(g.name).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
});
const membersOf = (g: Group) => users.value.filter((u) => u.groups.includes(g.id));

const isFiltering = computed(() => !!search.value.trim() || filter.value !== 'all' || !!groupFilter.value);
function clearFilters() {
  search.value = '';
  filter.value = 'all';
  groupFilter.value = '';
}

function highlight(text: string): { text: string; hit: boolean }[] {
  const q = normalize(search.value.trim());
  if (!q) return [{ text, hit: false }];
  const at = normalize(text).indexOf(q);
  if (at < 0) return [{ text, hit: false }];
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, at + q.length), hit: true },
    { text: text.slice(at + q.length), hit: false },
  ].filter((part) => part.text);
}

const AVATAR_HUES = [190, 160, 38, 350, 220, 280, 120, 20];
function avatarStyle(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
  return { '--avatar': `hsl(${hue} 80% 62%)` };
}
const initials = (name: string) => {
  const parts = name.split(/[.\-_\s@]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || '?';
};

const lastSeen = (u: User) => (u.lastLogin ? timeAgoPhrase(u.lastLogin) : t('roster.neverSignedIn'));
const lastSeenTitle = (u: User) => (u.lastLogin ? fmtDateTime(u.lastLogin, '') : '');

function onRosterKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
  if (e.key === '/' && !typing && !editUser.value && !editGroup.value) {
    e.preventDefault();
    searchInput.value?.focus();
  }
}
function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { search.value = ''; (e.target as HTMLInputElement).blur(); }
  if (e.key === 'Enter') {
    if (tab.value === 'users' && filteredUsers.value[0]) openPerms(filteredUsers.value[0]);
    if (tab.value === 'groups' && filteredGroups.value[0]) editGroup.value = filteredGroups.value[0];
  }
}
onMounted(() => window.addEventListener('keydown', onRosterKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onRosterKey));

const prefixLabel = (prefix: string) => prefix ? '/' + prefix : t('users.wholeBucket');

const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  if (editUser.value) editUser.value = null;
  else if (editGroup.value) editGroup.value = null;
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="view">
    <div class="view-head">
      <div>
        <h1 class="view-title">{{ t('users.title') }}</h1>
        <p class="view-sub">{{ t('users.subtitle') }}</p>
      </div>
      <button v-if="tab === 'users'" class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />{{ t('users.newUser') }}</button>
      <button v-else class="btn btn-primary" @click="showNewGroup = true"><Icon name="plus" :size="16" />{{ t('users.newGroup') }}</button>
    </div>

    <div class="ro-bar">
      <div class="tabs">
        <button class="tab" :class="{ 'tab-on': tab === 'users' }" @click="tab = 'users'">
          <Icon name="key" :size="15" /> {{ t('users.tabUsers') }}<span class="tab-count">{{ users.length }}</span>
        </button>
        <button class="tab" :class="{ 'tab-on': tab === 'groups' }" @click="tab = 'groups'">
          <Icon name="shield" :size="15" /> {{ t('users.tabGroups') }}<span class="tab-count">{{ groups.length }}</span>
        </button>
      </div>
      <label class="ro-search">
        <Icon name="search" :size="16" />
        <input
          ref="searchInput" v-model="search" type="search" spellcheck="false" autocomplete="off"
          :placeholder="tab === 'users' ? t('roster.searchUsers') : t('roster.searchGroups')"
          @keydown="onSearchKey"
        />
        <button v-if="search" class="ro-search-clear" :title="t('roster.clear')" @click.prevent="search = ''"><Icon name="x" :size="14" /></button>
        <kbd v-else class="ro-kbd" :title="t('roster.searchShortcut')">/</kbd>
      </label>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>{{ t('users.loading') }}</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">{{ t('users.loadError') }}</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />{{ t('users.tryAgain') }}</button>
    </div>

    <template v-else-if="tab === 'users'">
      <div class="ro-filters">
        <div class="ro-chips" role="tablist">
          <button
            v-for="f in ROSTER_FILTERS" :key="f" role="tab" class="ro-chip" :class="['is-' + f, { 'is-on': filter === f }]"
            :aria-selected="filter === f" :disabled="f !== 'all' && !filterCounts[f]" @click="filter = f"
          >
            {{ t(`roster.filters.${f}`) }}<span class="ro-chip-count">{{ filterCounts[f] }}</span>
          </button>
        </div>
        <div class="ro-selects">
          <select v-if="groups.length" v-model="groupFilter" class="ro-select" :class="{ 'is-on': groupFilter }">
            <option value="">{{ t('roster.anyGroup') }}</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <label class="ro-sort">
            <span>{{ t('roster.sortLabel') }}</span>
            <select v-model="sort" class="ro-select">
              <option v-for="s in ROSTER_SORTS" :key="s" :value="s">{{ t(`roster.sort.${s}`) }}</option>
            </select>
          </label>
        </div>
      </div>

      <div v-if="!users.length" class="ro-empty">
        <div class="ro-empty-ic"><Icon name="key" :size="22" /></div>
        <div class="ro-empty-title">{{ t('roster.noUsersTitle') }}</div>
        <p class="ro-empty-hint">{{ t('roster.noUsersHint') }}</p>
        <button class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />{{ t('users.newUser') }}</button>
      </div>

      <template v-else>
        <div class="ro-meta">
          <span>{{ t('roster.showing', { count: filteredUsers.length, total: users.length }) }}</span>
          <button v-if="isFiltering" class="ro-link" @click="clearFilters">{{ t('roster.clearFilters') }}</button>
        </div>

        <div v-if="!filteredUsers.length" class="ro-empty">
          <div class="ro-empty-ic"><Icon name="search" :size="22" /></div>
          <div class="ro-empty-title">{{ t('roster.emptyTitle') }}</div>
          <p class="ro-empty-hint">{{ t('roster.emptyHint') }}</p>
          <button class="btn" @click="clearFilters"><Icon name="x" :size="15" />{{ t('roster.clearFilters') }}</button>
        </div>

        <div v-else class="ro-table" role="list">
          <div class="ro-head" aria-hidden="true">
            <span>{{ t('roster.colUser') }}</span>
            <span>{{ t('roster.colGroups') }}</span>
            <span>{{ t('roster.colAccess') }}</span>
            <span>{{ t('roster.colLastSeen') }}</span>
            <span></span>
          </div>
          <template v-for="(u, i) in filteredUsers" :key="u.username">
            <div v-if="showLetters && (i === 0 || letterOf(filteredUsers[i - 1]!) !== letterOf(u))" class="ro-letter">{{ letterOf(u) }}</div>
            <div
              class="ro-row" role="listitem" tabindex="0" :style="{ animationDelay: Math.min(i, 14) * 18 + 'ms' }"
              @click="openPerms(u)" @keydown.enter.self="openPerms(u)"
            >
              <div class="ro-who">
                <span class="ro-avatar" :style="avatarStyle(u.username)">{{ initials(u.username) }}</span>
                <span class="ro-name">
                  <span class="ro-username"><template v-for="(part, pi) in highlight(u.username)" :key="pi"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
                  <span class="ro-badges">
                    <span class="ro-role" :class="u.role === 'admin' ? 'is-admin' : ''">{{ u.role === 'admin' ? t('users.roleAdminBadge') : t('users.roleUserBadge') }}</span>
                  </span>
                </span>
              </div>
              <div class="ro-groups">
                <template v-if="u.groups.length">
                  <span v-for="gid in u.groups.slice(0, 2)" :key="gid" class="ro-group" :class="{ 'is-on': groupFilter === gid }"><template v-for="(part, pi) in highlight(groupName(gid))" :key="pi"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
                  <span v-if="u.groups.length > 2" class="ro-group is-more" :title="u.groups.slice(2).map(groupName).join(', ')">{{ t('roster.moreGroups', { count: u.groups.length - 2 }) }}</span>
                </template>
                <span v-else class="ro-dim">{{ t('roster.noGroups') }}</span>
              </div>
              <div class="ro-access">
                <span v-if="u.role === 'admin'" class="ro-access-val is-full">{{ t('roster.fullAccess') }}</span>
                <span v-else-if="hasNoAccess(u)" class="ro-access-val is-none">{{ t('roster.noAccess') }}</span>
                <span v-else class="ro-access-val">{{ t('roster.buckets', { count: reachableBuckets(u) }) }}</span>
                <span v-if="u.role !== 'admin' && u.blocks.length" class="ro-blocked">{{ t('roster.blocked', { count: u.blocks.length }) }}</span>
              </div>
              <div class="ro-seen" :class="{ 'is-never': !u.lastLogin }" :title="lastSeenTitle(u)">{{ lastSeen(u) }}</div>
              <div class="ro-acts" @click.stop>
                <button
                  v-if="u.role !== 'admin'" class="ro-share" :class="{ 'is-on': u.canShare }"
                  :title="u.canShare ? t('roster.sharing') : t('roster.notSharing')" :aria-pressed="!!u.canShare" @click="toggleCanShare(u)"
                ><Icon name="share" :size="14" /></button>
                <button class="iconbtn" :title="t('users.resetPassword')" @click="openReset(u.username)"><Icon name="key" :size="15" /></button>
                <button class="iconbtn iconbtn-danger" :title="t('users.delete')" @click="delUser = u.username"><Icon name="trash" :size="15" /></button>
                <button class="ro-open" :title="t('roster.openPermissions')" @click="openPerms(u)"><Icon name="shield" :size="14" />{{ t('users.permissions') }}</button>
              </div>
            </div>
          </template>
        </div>
      </template>
    </template>

    <template v-else>
      <div v-if="!groups.length" class="ro-empty">
        <div class="ro-empty-ic"><Icon name="shield" :size="22" /></div>
        <div class="ro-empty-title">{{ t('roster.noGroupsTitle') }}</div>
        <p class="ro-empty-hint">{{ t('roster.noGroupsHint') }}</p>
        <button class="btn btn-primary" @click="showNewGroup = true"><Icon name="plus" :size="16" />{{ t('users.newGroup') }}</button>
      </div>
      <template v-else>
        <div class="ro-meta">
          <span>{{ t('roster.showingGroups', { count: filteredGroups.length, total: groups.length }) }}</span>
          <button v-if="search" class="ro-link" @click="search = ''">{{ t('roster.clearFilters') }}</button>
        </div>
        <div v-if="!filteredGroups.length" class="ro-empty">
          <div class="ro-empty-ic"><Icon name="search" :size="22" /></div>
          <div class="ro-empty-title">{{ t('roster.emptyTitle') }}</div>
          <button class="btn" @click="search = ''"><Icon name="x" :size="15" />{{ t('roster.clearFilters') }}</button>
        </div>
        <div v-else class="ro-groups-grid">
          <article v-for="g in filteredGroups" :key="g.id" class="ro-gcard">
            <header class="ro-gcard-head">
              <div class="ro-gcard-title">
                <Icon name="shield" :size="16" />
                <span><template v-for="(part, pi) in highlight(g.name)" :key="pi"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
              </div>
              <button class="iconbtn iconbtn-danger" :title="t('users.delete')" @click="delGroup = g"><Icon name="trash" :size="15" /></button>
            </header>
            <div class="ro-gcard-stats">
              <span>{{ t('roster.members', { count: membersOf(g).length }) }}</span>
              <span>{{ t('roster.grants', { count: g.grants.length }) }}</span>
            </div>
            <div class="ro-gcard-members">
              <template v-if="membersOf(g).length">
                <span v-for="m in membersOf(g).slice(0, 6)" :key="m.username" class="ro-avatar is-small" :style="avatarStyle(m.username)" :title="m.username">{{ initials(m.username) }}</span>
                <span v-if="membersOf(g).length > 6" class="ro-avatar is-small is-more">+{{ membersOf(g).length - 6 }}</span>
              </template>
              <span v-else class="ro-dim">{{ t('roster.noMembers') }}</span>
            </div>
            <ul v-if="g.grants.length" class="ro-gcard-grants">
              <li v-for="gr in g.grants.slice(0, 4)" :key="gr.bucketId + gr.prefix">
                <Icon name="folder" :size="13" />
                <span class="ro-gcard-path">{{ bucketName(gr.bucketId) }}<span class="ro-dim">{{ prefixLabel(gr.prefix) }}</span></span>
                <span class="ro-perm" :class="'is-' + gr.perm">{{ gr.perm }}</span>
              </li>
              <li v-if="g.grants.length > 4" class="ro-dim">+{{ g.grants.length - 4 }}</li>
            </ul>
            <button class="ro-gcard-edit" @click="editGroup = g"><Icon name="database" :size="14" />{{ t('roster.editGrants') }}</button>
          </article>
        </div>
      </template>
    </template>

    <!-- new user modal -->
    <Modal v-if="showNew" :title="t('users.newUser')" icon="key" @close="showNew = false">
      <div class="field">
        <label class="field-label">{{ t('users.usernameLabel') }}</label>
        <input class="field-input" v-model="nu.username" :placeholder="t('users.usernamePlaceholder')" autocomplete="off" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">{{ t('users.password') }}</label>
          <input class="field-input" type="password" v-model="nu.password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label class="field-label">{{ t('users.role') }}</label>
          <select class="modal-input" v-model="nu.role">
            <option value="user">{{ t('users.roleUser') }}</option>
            <option value="admin">{{ t('users.roleAdmin') }}</option>
          </select>
        </div>
      </div>
      <p v-if="newErr" class="modal-hint" style="color:var(--danger)">{{ newErr }}</p>
      <p v-else class="modal-hint">{{ t('users.newUserHint') }}</p>
      <template #foot>
        <button class="btn" @click="showNew = false">{{ t('users.cancel') }}</button>
        <button class="btn btn-primary" @click="create"><Icon name="check" :size="16" />{{ t('users.createUser') }}</button>
      </template>
    </Modal>

    <!-- reset password modal -->
    <Modal v-if="resetUser" :title="t('users.resetPassword')" icon="shield" @close="resetUser = null">
      <p class="modal-text">{{ around('users.newPasswordFor')[0] }}<strong>{{ resetUser }}</strong>{{ around('users.newPasswordFor')[1] }}</p>
      <input class="modal-input" style="margin-top:12px" type="password" v-model="resetPwd" autocomplete="new-password" @keydown.enter="confirmReset" />
      <template #foot>
        <button class="btn" @click="resetUser = null">{{ t('users.cancel') }}</button>
        <button class="btn btn-primary" @click="confirmReset"><Icon name="check" :size="16" />{{ t('users.savePassword') }}</button>
      </template>
    </Modal>

    <!-- delete user modal -->
    <Modal v-if="delUser" :title="t('users.deleteUserTitle')" icon="trash" @close="delUser = null">
      <p class="modal-text">{{ around('users.deleteUserConfirm')[0] }}<strong>{{ delUser }}</strong>{{ around('users.deleteUserConfirm')[1] }}</p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> {{ t('users.deleteUserWarn') }}</p>
      <template #foot>
        <button class="btn" @click="delUser = null">{{ t('users.cancel') }}</button>
        <button class="btn btn-danger" @click="confirmDelete"><Icon name="trash" :size="16" />{{ t('users.deleteAccount') }}</button>
      </template>
    </Modal>

    <!-- new group modal -->
    <Modal v-if="showNewGroup" :title="t('users.newGroup')" icon="shield" @close="showNewGroup = false">
      <div class="field">
        <label class="field-label">{{ t('users.groupName') }}</label>
        <input class="field-input" v-model="newGroupName" :placeholder="t('users.groupNamePlaceholder')" @keydown.enter="createGroup" />
      </div>
      <template #foot>
        <button class="btn" @click="showNewGroup = false">{{ t('users.cancel') }}</button>
        <button class="btn btn-primary" @click="createGroup"><Icon name="check" :size="16" />{{ t('users.createGroup') }}</button>
      </template>
    </Modal>

    <!-- delete group modal -->
    <Modal v-if="delGroup" :title="t('users.deleteGroupTitle')" icon="trash" @close="delGroup = null">
      <p class="modal-text">{{ around('users.deleteGroupConfirm')[0] }}<strong>{{ delGroup.name }}</strong>{{ around('users.deleteGroupConfirm')[1] }}</p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> {{ t('users.deleteGroupWarn') }}</p>
      <template #foot>
        <button class="btn" @click="delGroup = null">{{ t('users.cancel') }}</button>
        <button class="btn btn-danger" @click="confirmDeleteGroup"><Icon name="trash" :size="16" />{{ t('users.deleteGroup') }}</button>
      </template>
    </Modal>

    <!-- user permissions editor -->
    <div v-if="editUser" class="modal-back" @click.self="editUser = null">
      <div class="pm">
        <div class="pm-head">
          <div class="pm-head-ic"><Icon name="shield" :size="19" /></div>
          <div style="flex:1;min-width:0">
            <div class="pm-title">{{ t('users.permissions') }}</div>
            <div class="pm-sub">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="1.8"/><path d="M5 19.5c1.3-3 4-4.6 7-4.6s5.7 1.6 7 4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              <span class="pm-user">{{ editUser.username }}</span><span>{{ t('users.individualAccess') }}</span>
            </div>
          </div>
          <button class="pm-x" :aria-label="t('users.close')" @click="editUser = null"><Icon name="x" :size="15" /></button>
        </div>

        <div class="pm-body">
          <p v-if="editUser.role === 'admin'" class="modal-text">{{ t('users.adminsFullAccess') }}</p>
          <template v-else>
            <section>
              <div class="pm-eyebrow">{{ t('users.groupsEyebrow') }}</div>
              <div v-if="groups.length" style="display:flex;gap:6px;flex-wrap:wrap">
                <button v-for="g in groups" :key="g.id" class="chip" :class="{ 'chip-on': editUser.groups.includes(g.id) }" @click="toggleGroup(g)">{{ g.name }}</button>
              </div>
              <div v-else class="pm-note">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style="flex:none;color:var(--text-3)"><circle cx="9" cy="8.5" r="2.8" stroke="currentColor" stroke-width="1.7"/><circle cx="16.5" cy="9.5" r="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 18.5c1.1-2.6 3.2-3.9 5.5-3.9s4.4 1.3 5.5 3.9M15.5 14.9c2 .2 3.7 1.4 4.6 3.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
                <span>{{ t('users.noGroupsNote') }}</span>
              </div>
            </section>

            <section>
              <div class="pm-eyebrow-row">
                <div class="pm-eyebrow">{{ t('users.directGrantsEyebrow') }}</div>
                <div class="pm-count">{{ t('users.folderCount', { count: editUser.grants.length }) }}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:10px">
                <div v-for="gr in editUser.grants" :key="gr.bucketId + gr.prefix" class="grant-card">
                  <div class="grant-card-top">
                    <Icon name="folder" :size="17" class="gc-folder" />
                    <span class="gc-name">{{ bucketName(gr.bucketId) }}</span>
                    <span class="gc-scope">{{ prefixLabel(gr.prefix) }}</span>
                    <div style="flex:1"></div>
                    <button class="gc-del" :title="t('users.revokeAccess')" @click="removeUserGrant(gr)"><Icon name="trash" :size="14" /></button>
                  </div>
                  <PermPicker :perm="gr.perm" @change="setUserGrantPerm(gr, $event)" />
                </div>
                <button class="pm-add" @click="startAdd('user-grant', editUser.username)"><Icon name="plus" :size="14" />{{ t('users.grantFolderAccess') }}</button>
              </div>
            </section>

            <section>
              <div class="pm-eyebrow">{{ t('users.blocksEyebrow') }}</div>
              <div style="display:flex;flex-direction:column;gap:10px">
                <div v-if="!editUser.blocks.length" class="pm-block-empty">{{ t('users.noBlocks') }}</div>
                <div v-for="b in editUser.blocks" :key="b.bucketId + b.prefix" class="pm-block">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style="flex:none;color:var(--danger)"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M6.2 6.2l11.6 11.6" stroke="currentColor" stroke-width="1.7"/></svg>
                  <span class="pm-block-path">{{ bucketName(b.bucketId) }} {{ prefixLabel(b.prefix) }}</span>
                  <button class="pm-unblock" @click="removeUserBlock(b)">{{ t('users.unblock') }}</button>
                </div>
                <button class="pm-add-block" @click="startAdd('user-block', editUser.username)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M6.2 6.2l11.6 11.6" stroke="currentColor" stroke-width="1.8"/></svg>
                  {{ t('users.blockFolder') }}
                </button>
              </div>
            </section>
          </template>
        </div>

        <div class="pm-foot">
          <div class="pm-foot-note"><span class="pm-dot"></span>{{ t('users.footNote') }}</div>
          <div style="flex:1"></div>
          <button class="pm-close" @click="editUser = null">{{ t('users.close') }}</button>
        </div>
      </div>
    </div>

    <!-- group grants editor -->
    <Modal v-if="editGroup" :title="t('users.groupGrantsTitle', { name: editGroup.name })" icon="database" wide @close="editGroup = null">
      <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:10px">
        <div v-for="gr in editGroup.grants" :key="gr.bucketId + gr.prefix" class="grant-card">
          <div class="grant-card-top">
            <span class="grant-loc"><Icon name="folder" :size="14" /><strong>{{ bucketName(gr.bucketId) }}</strong><span class="muted">{{ prefixLabel(gr.prefix) }}</span></span>
            <button class="iconbtn iconbtn-danger" :title="t('users.removeGrant')" @click="removeGroupGrant(editGroup, gr)"><Icon name="trash" :size="14" /></button>
          </div>
          <PermPicker :perm="gr.perm" @change="setGroupGrantPerm(editGroup, gr, $event)" />
        </div>
        <p v-if="!editGroup.grants.length" class="muted">{{ t('users.noGrants') }}</p>
      </div>
      <button class="btn" @click="startAdd('group-grant', editGroup.id)"><Icon name="plus" :size="15" /> {{ t('users.grantFolder') }}</button>
      <template #foot>
        <button class="btn btn-primary" @click="editGroup = null"><Icon name="check" :size="16" />{{ t('users.close') }}</button>
      </template>
    </Modal>

    <!-- bucket choice + folder picker for add flow -->
    <Modal v-if="picker && picker.step === 'bucket'" :title="t('users.bucket')" icon="database" @close="picker = null">
      <div class="field">
        <label class="field-label">{{ t('users.bucket') }}</label>
        <select class="modal-input" v-model="picker.bucketId">
          <option v-for="b in buckets" :key="b.id" :value="b.id">{{ b.name ?? b.id }}</option>
        </select>
      </div>
      <p class="modal-hint">{{ t('users.pickBucketHint') }}</p>
      <template #foot>
        <button class="btn" @click="picker = null">{{ t('users.cancel') }}</button>
        <button class="btn btn-primary" @click="picker.step = 'folder'"><Icon name="check" :size="16" />{{ t('users.continue') }}</button>
      </template>
    </Modal>
    <FolderPicker v-if="picker && picker.step === 'folder'" :bucket-id="picker.bucketId" :bucket-name="bucketName(picker.bucketId)"
      @pick="onPick" @close="picker = null" />
  </div>
</template>

<style scoped>
.tabs { display: inline-flex; gap: 2px; padding: 3px; margin-bottom: 18px; background: var(--bg-0); border: 1px solid var(--line-2); border-radius: 10px; }
.tab { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px; border: none; background: transparent; color: var(--text-3); border-radius: 7px; cursor: pointer; font-family: var(--display-font); font-weight: 600; font-size: 13px; letter-spacing: .3px; transition: color .14s, background .14s; }
.tab:hover { color: var(--text); }
.tab-on { background: var(--bg-3); color: var(--neon); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--neon) 28%, transparent); }

.chip { display: inline-flex; align-items: center; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 999px; padding: 4px 11px; font-size: 12px; color: var(--text-2); cursor: pointer; transition: color .14s, border-color .14s, background .14s; }
.chip:hover { border-color: color-mix(in srgb, var(--neon) 40%, transparent); color: var(--text); }
.chip-on { background: color-mix(in srgb, var(--neon) 14%, var(--bg-2)); border-color: color-mix(in srgb, var(--neon) 45%, transparent); color: var(--neon); }
.grant-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
.grant-row:first-child { border-top: none; }
.grant-loc { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--text); }
.grant-loc svg { color: var(--neon); flex: none; }
.grant-loc strong { white-space: nowrap; }
.muted { color: var(--text-3); font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grant-card { display: flex; flex-direction: column; gap: 12px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 12px; padding: 14px 15px; }
.grant-card-top { display: flex; align-items: center; gap: 10px; }
.gc-folder { color: var(--neon); flex: none; }
.gc-name { font-weight: 600; font-size: 15px; color: var(--text); }
.gc-scope { font-family: var(--mono); font-size: 11px; color: var(--text-3); border: 1px solid var(--line); border-radius: 5px; padding: 2px 7px; white-space: nowrap; flex: none; }
.gc-del { width: 30px; height: 30px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-3); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color .14s, background .14s, border-color .14s; }
.gc-del:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); border-color: color-mix(in srgb, var(--danger) 32%, transparent); }
.row-acts { display: flex; align-items: center; gap: 6px; }
.row-acts .iconbtn { width: 30px; height: 30px; }

.pm { width: 100%; max-width: 660px; max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: linear-gradient(180deg, var(--bg-1), var(--bg-0)); border: 1px solid var(--line-2); border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,.6); overflow: hidden; animation: pop .18s cubic-bezier(.2,.9,.3,1.2); }
.pm-head { display: flex; align-items: center; gap: 14px; padding: 18px 22px; border-bottom: 1px solid var(--line); }
.pm-head-ic { width: 38px; height: 38px; border-radius: 10px; background: color-mix(in srgb, var(--neon) 9%, transparent); border: 1px solid color-mix(in srgb, var(--neon) 28%, transparent); color: var(--neon); display: flex; align-items: center; justify-content: center; flex: none; }
.pm-title { font-weight: 700; font-size: 18px; letter-spacing: .2px; color: var(--text); }
.pm-sub { display: flex; align-items: center; gap: 7px; margin-top: 2px; font-family: var(--mono); font-size: 11.5px; color: var(--text-2); }
.pm-user { color: var(--neon); }
.pm-x { width: 32px; height: 32px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-3); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color .14s, background .14s, border-color .14s; }
.pm-x:hover { color: var(--text); background: color-mix(in srgb, var(--text-2) 12%, transparent); border-color: var(--line); }
.pm-body { padding: 20px 22px 24px; display: flex; flex-direction: column; gap: 22px; overflow-y: auto; }
.pm-eyebrow { font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: 2.5px; color: var(--text-3); margin-bottom: 10px; }
.pm-eyebrow-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
.pm-eyebrow-row .pm-eyebrow { margin: 0; }
.pm-count { font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.pm-note { display: flex; align-items: center; gap: 12px; padding: 13px 15px; border: 1px dashed var(--line-2); border-radius: 11px; color: var(--text-2); font-size: 13.5px; }
.pm-add { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 12px; border: 1px dashed var(--line-2); border-radius: 11px; background: transparent; color: var(--text-2); font-family: inherit; font-size: 14px; font-weight: 500; cursor: pointer; transition: color .15s, border-color .15s, background .15s; }
.pm-add:hover { color: var(--neon); border-color: color-mix(in srgb, var(--neon) 45%, transparent); background: color-mix(in srgb, var(--neon) 5%, transparent); }
.pm-block-empty { font-size: 13.5px; color: var(--text-3); }
.pm-block { display: flex; align-items: center; gap: 10px; border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent); background: color-mix(in srgb, var(--danger) 6%, transparent); border-radius: 11px; padding: 11px 14px; }
.pm-block-path { font-family: var(--mono); font-size: 13px; color: var(--text); flex: 1; }
.pm-unblock { border: none; background: transparent; color: var(--text-3); font-family: var(--mono); font-size: 11.5px; cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: color .14s, background .14s; }
.pm-unblock:hover { color: var(--text); background: color-mix(in srgb, var(--text-2) 12%, transparent); }
.pm-add-block { display: flex; align-items: center; gap: 9px; width: fit-content; padding: 9px 16px; border: 1px solid color-mix(in srgb, var(--danger) 34%, transparent); border-radius: 9px; background: transparent; color: var(--danger); font-family: inherit; font-size: 14px; font-weight: 500; cursor: pointer; transition: background .15s, border-color .15s; }
.pm-add-block:hover { background: color-mix(in srgb, var(--danger) 9%, transparent); border-color: color-mix(in srgb, var(--danger) 55%, transparent); }
.pm-foot { display: flex; align-items: center; gap: 14px; padding: 15px 22px; border-top: 1px solid var(--line); background: rgba(0,0,0,.18); }
.pm-foot-note { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.pm-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex: none; }
.pm-close { padding: 10px 26px; border-radius: 9px; border: 1px solid color-mix(in srgb, var(--neon) 42%, transparent); background: color-mix(in srgb, var(--neon) 10%, transparent); color: var(--neon); font-weight: 700; font-size: 14px; letter-spacing: .3px; cursor: pointer; transition: background .15s, box-shadow .15s; }
.pm-close:hover { background: color-mix(in srgb, var(--neon) 18%, transparent); box-shadow: 0 0 18px color-mix(in srgb, var(--neon) 22%, transparent); }

.ro-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.ro-bar .tabs { margin-bottom: 0; }
.tab-count {
  margin-left: 4px; padding: 0 7px; border-radius: 999px; font-family: var(--mono); font-size: 10.5px; line-height: 18px;
  background: color-mix(in srgb, var(--text) 7%, transparent); color: var(--text-2);
}
.tab-on .tab-count { background: color-mix(in srgb, var(--neon) 16%, transparent); color: var(--neon); }
.ro-search {
  flex: 1; min-width: 240px; display: flex; align-items: center; gap: 10px; height: 42px; padding: 0 12px 0 14px;
  border: 1px solid var(--line-2); border-radius: 11px; background: var(--bg-1); color: var(--text-3); cursor: text;
  transition: border-color .15s, box-shadow .15s;
}
.ro-search:focus-within {
  border-color: color-mix(in srgb, var(--neon) 55%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--neon) 12%, transparent);
  color: var(--neon);
}
.ro-search input {
  flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none;
  font-family: var(--body); font-size: 14.5px; color: var(--text);
}
.ro-search input::-webkit-search-cancel-button { display: none; }
.ro-search input::placeholder { color: var(--text-3); }
.ro-kbd {
  padding: 1px 7px; border-radius: 6px; border: 1px solid var(--line-2); border-bottom-width: 2px;
  font-family: var(--mono); font-size: 11px; color: var(--text-3); background: var(--bg-2);
}
.ro-search-clear {
  width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 6px; cursor: pointer;
  background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--text-2);
}

.ro-filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.ro-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.ro-chip {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--line-2); background: var(--bg-1); color: var(--text-2);
  font-family: var(--body); font-size: 12.5px; transition: color .14s, border-color .14s, background .14s;
  --chip: var(--neon);
}
.ro-chip.is-admin { --chip: var(--amber); }
.ro-chip.is-noaccess, .ro-chip.is-never { --chip: var(--danger); }
.ro-chip.is-share { --chip: var(--green); }
.ro-chip:hover:not(:disabled) { color: var(--text); border-color: color-mix(in srgb, var(--chip) 40%, var(--line-2)); }
.ro-chip:disabled { opacity: .4; cursor: default; }
.ro-chip.is-on { color: var(--chip); border-color: color-mix(in srgb, var(--chip) 55%, transparent); background: color-mix(in srgb, var(--chip) 11%, var(--bg-1)); }
.ro-chip-count { font-family: var(--mono); font-size: 10.5px; color: var(--text-3); }
.ro-chip.is-on .ro-chip-count { color: inherit; }
.ro-selects { display: flex; gap: 8px; align-items: center; }
.ro-select {
  height: 32px; padding: 0 28px 0 10px; border-radius: 8px; border: 1px solid var(--line-2); cursor: pointer;
  background: var(--bg-1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2356697f' stroke-width='3'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center;
  appearance: none; color: var(--text); font-family: var(--body); font-size: 12.5px;
}
.ro-select.is-on { border-color: color-mix(in srgb, var(--neon) 55%, transparent); color: var(--neon); }
.ro-sort { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-3); }

.ro-meta { display: flex; align-items: center; gap: 12px; margin: 4px 2px 10px; font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.ro-link { border: 0; background: none; padding: 0; cursor: pointer; font: inherit; color: var(--neon); }
.ro-link:hover { text-decoration: underline; }

.ro-table { border: 1px solid var(--line-2); border-radius: 14px; background: var(--bg-1); overflow: hidden; }
.ro-head, .ro-row {
  display: grid; grid-template-columns: minmax(200px, 1.5fr) minmax(140px, 1.2fr) minmax(120px, .9fr) minmax(100px, .7fr) 236px;
  gap: 16px; align-items: center; padding: 0 16px;
}
.ro-head {
  height: 38px; border-bottom: 1px solid var(--line); background: var(--bg-0);
  font-family: var(--mono); font-size: 9.5px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-3);
}
.ro-letter {
  position: sticky; top: 0; z-index: 1; padding: 5px 16px; border-bottom: 1px solid var(--line);
  font-family: var(--display-font); font-weight: 700; font-size: 12px; letter-spacing: 1px; color: var(--neon);
  background: color-mix(in srgb, var(--bg-0) 92%, var(--neon) 4%);
}
.ro-row {
  min-height: 60px; border-bottom: 1px solid var(--line); cursor: pointer; outline: none;
  transition: background .12s;
  animation: ro-in .28s cubic-bezier(.2, .7, .2, 1) both;
}
.ro-row:last-child { border-bottom: 0; }
.ro-row:hover, .ro-row:focus-visible { background: color-mix(in srgb, var(--neon) 5%, var(--bg-1)); }
.ro-row:focus-visible { box-shadow: inset 3px 0 0 var(--neon); }
.ro-who { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ro-avatar {
  flex: none; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
  font-family: var(--display-font); font-weight: 700; font-size: 12.5px; letter-spacing: .5px;
  color: var(--avatar); background: color-mix(in srgb, var(--avatar) 14%, var(--bg-2));
  border: 1px solid color-mix(in srgb, var(--avatar) 30%, transparent);
}
.ro-avatar.is-small { width: 28px; height: 28px; border-radius: 8px; font-size: 10px; margin-left: 4px; }
.ro-avatar.is-small:first-child { margin-left: 0; }
.ro-avatar.is-more { --avatar: var(--text-2); }
.ro-name { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ro-username { font-weight: 600; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ro-badges { display: flex; gap: 6px; }
.ro-role {
  font-family: var(--mono); font-size: 9.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-3);
}
.ro-role.is-admin { color: var(--amber); }
mark { background: color-mix(in srgb, var(--neon) 24%, transparent); color: var(--text); border-radius: 3px; padding: 0 1px; }
.ro-groups { display: flex; gap: 5px; flex-wrap: wrap; min-width: 0; }
.ro-group {
  max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--bg-2);
  font-size: 11.5px; color: var(--text-2);
}
.ro-group.is-on { border-color: color-mix(in srgb, var(--neon) 50%, transparent); color: var(--neon); }
.ro-group.is-more { color: var(--text-3); }
.ro-dim { color: var(--text-3); font-size: 12px; }
.ro-access { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ro-access-val { font-family: var(--mono); font-size: 12px; color: var(--text); }
.ro-access-val.is-full { color: var(--amber); }
.ro-access-val.is-none { color: var(--text-3); }
.ro-blocked { font-family: var(--mono); font-size: 10.5px; color: var(--danger); }
.ro-seen { font-family: var(--mono); font-size: 11.5px; color: var(--text-2); white-space: nowrap; }
.ro-seen.is-never { color: var(--text-3); font-style: italic; }
.ro-acts { display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
.ro-acts .iconbtn { width: 30px; height: 30px; opacity: 0; transition: opacity .12s; }
.ro-row:hover .ro-acts .iconbtn, .ro-row:focus-within .ro-acts .iconbtn { opacity: 1; }
.ro-share {
  width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--line-2); background: transparent; color: var(--text-3);
  transition: color .14s, border-color .14s, background .14s;
}
.ro-share:hover { color: var(--text); }
.ro-share.is-on { color: var(--green); border-color: color-mix(in srgb, var(--green) 45%, transparent); background: color-mix(in srgb, var(--green) 10%, transparent); }
.ro-open {
  margin-left: 4px; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--neon) 35%, transparent); background: color-mix(in srgb, var(--neon) 8%, transparent);
  color: var(--neon); font-family: var(--body); font-size: 12.5px; font-weight: 600; white-space: nowrap;
}
.ro-open:hover { background: color-mix(in srgb, var(--neon) 16%, transparent); }

.ro-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 44px 24px;
  border: 1px dashed var(--line-2); border-radius: 14px;
}
.ro-empty-ic { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; color: var(--neon); background: color-mix(in srgb, var(--neon) 10%, transparent); }
.ro-empty-title { font-family: var(--display-font); font-weight: 700; font-size: 17px; color: var(--text); }
.ro-empty-hint { margin: 0 0 6px; max-width: 46ch; font-size: 13.5px; color: var(--text-2); }

.ro-groups-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 14px; }
.ro-gcard {
  display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; border-radius: 14px;
  border: 1px solid var(--line-2); background: var(--bg-1);
}
.ro-gcard-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ro-gcard-title { display: flex; align-items: center; gap: 9px; min-width: 0; font-family: var(--display-font); font-weight: 700; font-size: 15px; color: var(--text); }
.ro-gcard-title .ic { color: var(--neon); flex: none; }
.ro-gcard-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ro-gcard-stats { display: flex; gap: 14px; font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.ro-gcard-members { display: flex; align-items: center; min-height: 26px; }
.ro-gcard-grants { list-style: none; margin: 0; padding: 10px 0 0; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 7px; }
.ro-gcard-grants li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text); min-width: 0; }
.ro-gcard-grants .ic { color: var(--neon); flex: none; }
.ro-gcard-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ro-gcard-path .ro-dim { margin-left: 4px; font-family: var(--mono); font-size: 11px; }
.ro-perm { flex: none; font-family: var(--mono); font-size: 9.5px; letter-spacing: .8px; text-transform: uppercase; color: var(--text-2); }
.ro-perm.is-owner { color: var(--amber); }
.ro-perm.is-read-write { color: var(--green); }
.ro-perm.is-view-only { color: var(--text-3); }
.ro-gcard-edit {
  margin-top: auto; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; border-radius: 9px; cursor: pointer;
  border: 1px dashed var(--line-2); background: transparent; color: var(--text-2); font-family: var(--body); font-size: 13px;
  transition: color .14s, border-color .14s, background .14s;
}
.ro-gcard-edit:hover { color: var(--neon); border-color: color-mix(in srgb, var(--neon) 45%, transparent); background: color-mix(in srgb, var(--neon) 5%, transparent); }

@keyframes ro-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .ro-row { animation: none; } }
@media (max-width: 900px) {
  .ro-head { display: none; }
  .ro-row { grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 14px; }
  .ro-groups, .ro-access, .ro-seen, .ro-acts { padding-left: 46px; }
  .ro-access { flex-direction: row; gap: 10px; }
  .ro-acts { justify-content: flex-start; }
  .ro-acts .iconbtn { opacity: 1; }
  .ro-open { margin-left: auto; }
}
@media (max-width: 560px) {
  .ro-filters { flex-direction: column; align-items: stretch; }
  .ro-selects { justify-content: space-between; }
}
</style>
