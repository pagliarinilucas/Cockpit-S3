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
import { t, type MessageKey } from '../i18n';

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

    <div class="tabs">
      <button class="tab" :class="{ 'tab-on': tab === 'users' }" @click="tab = 'users'"><Icon name="key" :size="15" /> {{ t('users.tabUsers') }}</button>
      <button class="tab" :class="{ 'tab-on': tab === 'groups' }" @click="tab = 'groups'"><Icon name="shield" :size="15" /> {{ t('users.tabGroups') }}</button>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>{{ t('users.loading') }}</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">{{ t('users.loadError') }}</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />{{ t('users.tryAgain') }}</button>
    </div>

    <!-- USERS -->
    <template v-else-if="tab === 'users'">
      <div class="card" v-for="u in users" :key="u.username" style="margin-bottom:10px">
        <div class="kmrow-top">
          <div class="kmrow-name"><Icon name="key" :size="15" /> {{ u.username }}
            <span class="role-badge" :class="u.role === 'admin' ? 'role-admin' : 'role-user'" style="margin-left:8px">{{ u.role === 'admin' ? t('users.roleAdminBadge') : t('users.roleUserBadge') }}</span>
          </div>
          <div class="row-acts">
            <button v-if="u.role !== 'admin'" class="chip" :class="{ 'chip-on': u.canShare }"
                    :title="u.canShare ? t('users.canShareTitle') : t('users.cannotShareTitle')" @click="toggleCanShare(u)">
              <Icon name="share" :size="13" /> {{ u.canShare ? t('users.sharing') : t('users.share') }}
            </button>
            <button class="btn" @click="openPerms(u)"><Icon name="shield" :size="15" /> {{ t('users.permissions') }}</button>
            <button class="iconbtn" :title="t('users.resetPassword')" @click="openReset(u.username)"><Icon name="shield" :size="15" /></button>
            <button class="iconbtn iconbtn-danger" :title="t('users.delete')" @click="delUser = u.username"><Icon name="trash" :size="15" /></button>
          </div>
        </div>
        <div class="kmrow-meta" style="margin-top:6px">
          <template v-if="u.role === 'admin'">{{ t('users.fullAccessAdmin') }}</template>
          <template v-else>
            {{ t('users.groupCount', { count: u.groups.length }) }} · {{ t('users.directGrantCount', { count: u.grants.length }) }} · {{ t('users.blockCount', { count: u.blocks.length }) }}
          </template>
        </div>
        <div v-if="u.role !== 'admin' && u.groups.length" style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap">
          <span v-for="gid in u.groups" :key="gid" class="chip">{{ groupName(gid) }}</span>
        </div>
      </div>
      <p v-if="!users.length" class="modal-hint">{{ t('users.noUsers') }}</p>
    </template>

    <!-- GROUPS -->
    <template v-else>
      <div class="card" v-for="g in groups" :key="g.id" style="margin-bottom:10px">
        <div class="kmrow-top">
          <div class="kmrow-name"><Icon name="shield" :size="15" /> {{ g.name }}</div>
          <div class="row-acts">
            <button class="btn" @click="editGroup = g"><Icon name="database" :size="15" /> {{ t('users.grants') }}</button>
            <button class="iconbtn iconbtn-danger" :title="t('users.delete')" @click="delGroup = g"><Icon name="trash" :size="15" /></button>
          </div>
        </div>
        <div class="kmrow-meta" style="margin-top:6px">{{ t('users.memberCount', { count: g.members ?? 0 }) }} · {{ t('users.grantCount', { count: g.grants.length }) }}</div>
        <div v-if="g.grants.length" style="margin-top:10px; display:flex; flex-direction:column; gap:10px">
          <div v-for="gr in g.grants" :key="gr.bucketId + gr.prefix" class="grant-card">
            <div class="grant-card-top">
              <span class="grant-loc"><Icon name="folder" :size="14" /><strong>{{ bucketName(gr.bucketId) }}</strong><span class="muted">{{ prefixLabel(gr.prefix) }}</span></span>
              <button class="iconbtn iconbtn-danger" :title="t('users.removeGrant')" @click="removeGroupGrant(g, gr)"><Icon name="trash" :size="14" /></button>
            </div>
            <PermPicker :perm="gr.perm" @change="setGroupGrantPerm(g, gr, $event)" />
          </div>
        </div>
      </div>
      <p v-if="!groups.length" class="modal-hint">{{ t('users.noGroupsYet') }}</p>
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

.card { background: var(--bg-1); border: 1px solid var(--line-2); border-radius: 14px; padding: 16px 18px; }
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
</style>
