<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { User, Group, Bucket, Perm, Role, UserGrant } from '../core/models';
import { api, apiErrMsg, ApiError } from '../core/api';
import { useToast } from '../core/toast';
import { timeAgo } from '../core/util';
import { PERM_META, PERM_CYCLE } from '../core/perm';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import PermBadge from '../components/PermBadge.vue';
import FolderPicker from '../components/FolderPicker.vue';

const toast = useToast();
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
  if (!username.trim()) { newErr.value = 'Informe o nome de usuário.'; return; }
  if (password.length < 6) { newErr.value = 'A senha deve ter ao menos 6 caracteres.'; return; }
  try {
    await api.createUser(username.trim(), password, role);
    toast.success(`Usuário "${username}" criado`);
    showNew.value = false; reload();
  } catch (e) {
    newErr.value = e instanceof ApiError && e.status === 409 ? 'Já existe um usuário com esse nome.' : 'Falha ao criar usuário.';
  }
}

// ── reset / delete user ──
const resetUser = ref<string | null>(null);
const resetPwd = ref('');
const delUser = ref<string | null>(null);
function openReset(username: string) { resetPwd.value = ''; resetUser.value = username; }
async function confirmReset() {
  const u = resetUser.value; if (!u) return;
  if (resetPwd.value.length < 6) { toast.error('A senha deve ter ao menos 6 caracteres'); return; }
  try { await api.resetPassword(u, resetPwd.value); toast.success(`Senha de ${u} redefinida`); resetUser.value = null; }
  catch { toast.error('Falha ao redefinir senha'); }
}
async function confirmDelete() {
  const u = delUser.value; if (!u) return;
  delUser.value = null;
  try { await api.deleteUser(u); toast.success(`Usuário ${u} excluído`); reload(); }
  catch { toast.error('Falha ao excluir usuário'); }
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
  try { refreshEditUser(await api.setUserGroup(u.username, g.id, member)); }
  catch { toast.error('Falha ao alterar grupo'); }
}
async function cycleUserGrant(gr: UserGrant) {
  const u = editUser.value; if (!u) return;
  const next = PERM_CYCLE[(PERM_CYCLE.indexOf(gr.perm) + 1) % PERM_CYCLE.length];
  try { refreshEditUser(await api.setUserGrant(u.username, gr.bucketId, gr.prefix, next)); }
  catch { toast.error('Falha ao alterar permissão'); }
}
async function removeUserGrant(gr: UserGrant) {
  const u = editUser.value; if (!u) return;
  try { refreshEditUser(await api.setUserGrant(u.username, gr.bucketId, gr.prefix, null)); }
  catch { toast.error('Falha ao remover'); }
}
async function removeUserBlock(b: { bucketId: string; prefix: string }) {
  const u = editUser.value; if (!u) return;
  try { refreshEditUser(await api.setUserBlock(u.username, b.bucketId, b.prefix, false)); }
  catch { toast.error('Falha ao remover bloqueio'); }
}

// ── add grant / block flow (shared picker) ──
// mode: 'user-grant' | 'user-block' | 'group-grant'
const picker = ref<{ mode: string; subjectId: string; bucketId: string } | null>(null);
function startAdd(mode: string, subjectId: string) {
  const bucketId = buckets.value[0]?.id;
  if (!bucketId) { toast.error('Nenhum bucket disponível.'); return; }
  picker.value = { mode, subjectId, bucketId };
}
async function onPick(prefix: string) {
  const p = picker.value; if (!p) return;
  picker.value = null;
  try {
    if (p.mode === 'user-grant') refreshEditUser(await api.setUserGrant(p.subjectId, p.bucketId, prefix, 'read-only'));
    else if (p.mode === 'user-block') refreshEditUser(await api.setUserBlock(p.subjectId, p.bucketId, prefix, true));
    else if (p.mode === 'group-grant') { await api.setGroupGrant(p.subjectId, p.bucketId, prefix, 'read-only'); await reloadGroupsKeepEditor(); }
  } catch { toast.error('Falha ao adicionar'); }
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
  catch (e) { toast.error(e instanceof ApiError && e.status === 409 ? 'Já existe um grupo com esse nome.' : 'Falha ao criar grupo'); }
}
const delGroup = ref<Group | null>(null);
async function confirmDeleteGroup() {
  const g = delGroup.value; if (!g) return; delGroup.value = null;
  try { await api.deleteGroup(g.id); toast.success(`Grupo ${g.name} excluído`); if (editGroup.value?.id === g.id) editGroup.value = null; await reload(); }
  catch { toast.error('Falha ao excluir grupo'); }
}
async function cycleGroupGrant(g: Group, gr: { bucketId: string; prefix: string; perm: Perm }) {
  const next = PERM_CYCLE[(PERM_CYCLE.indexOf(gr.perm) + 1) % PERM_CYCLE.length];
  try { await api.setGroupGrant(g.id, gr.bucketId, gr.prefix, next); await reloadGroupsKeepEditor(); }
  catch { toast.error('Falha ao alterar permissão'); }
}
async function removeGroupGrant(g: Group, gr: { bucketId: string; prefix: string }) {
  try { await api.setGroupGrant(g.id, gr.bucketId, gr.prefix, null); await reloadGroupsKeepEditor(); }
  catch { toast.error('Falha ao remover'); }
}

const prefixLabel = (prefix: string) => prefix ? '/' + prefix : '(bucket inteiro)';
</script>

<template>
  <div class="view">
    <div class="view-head">
      <div>
        <h1 class="view-title">Acesso</h1>
        <p class="view-sub">Permissões por pasta via grupos reutilizáveis e concessões diretas.</p>
      </div>
      <button v-if="tab === 'users'" class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />Novo usuário</button>
      <button v-else class="btn btn-primary" @click="showNewGroup = true"><Icon name="plus" :size="16" />Novo grupo</button>
    </div>

    <div class="seg" style="margin-bottom:16px">
      <button class="seg-btn" :class="{ 'seg-on': tab === 'users' }" @click="tab = 'users'"><Icon name="key" :size="15" /> Usuários</button>
      <button class="seg-btn" :class="{ 'seg-on': tab === 'groups' }" @click="tab = 'groups'"><Icon name="shield" :size="15" /> Grupos</button>
    </div>

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO…</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">Não foi possível carregar</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />Tentar de novo</button>
    </div>

    <!-- USERS -->
    <template v-else-if="tab === 'users'">
      <div class="card" v-for="u in users" :key="u.username" style="margin-bottom:10px">
        <div class="kmrow-top">
          <div class="kmrow-name"><Icon name="key" :size="15" /> {{ u.username }}
            <span class="role-badge" :class="u.role === 'admin' ? 'role-admin' : 'role-user'" style="margin-left:8px">{{ u.role === 'admin' ? 'ADMIN' : 'USUÁRIO' }}</span>
          </div>
          <div class="kmrow-acts">
            <button class="btn" @click="openPerms(u)"><Icon name="shield" :size="15" /> Permissões</button>
            <button class="iconbtn" title="Redefinir senha" @click="openReset(u.username)"><Icon name="shield" :size="15" /></button>
            <button class="iconbtn iconbtn-danger" title="Excluir" @click="delUser = u.username"><Icon name="trash" :size="15" /></button>
          </div>
        </div>
        <div class="kmrow-meta" style="margin-top:6px">
          <template v-if="u.role === 'admin'">acesso total (admin)</template>
          <template v-else>
            {{ u.groups.length }} grupo(s) · {{ u.grants.length }} concessão(ões) direta(s) · {{ u.blocks.length }} bloqueio(s)
          </template>
        </div>
        <div v-if="u.role !== 'admin' && u.groups.length" style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap">
          <span v-for="gid in u.groups" :key="gid" class="chip">{{ groupName(gid) }}</span>
        </div>
      </div>
      <p v-if="!users.length" class="modal-hint">Nenhum usuário.</p>
    </template>

    <!-- GROUPS -->
    <template v-else>
      <div class="card" v-for="g in groups" :key="g.id" style="margin-bottom:10px">
        <div class="kmrow-top">
          <div class="kmrow-name"><Icon name="shield" :size="15" /> {{ g.name }}</div>
          <div class="kmrow-acts">
            <button class="btn" @click="editGroup = g"><Icon name="database" :size="15" /> Grants</button>
            <button class="iconbtn iconbtn-danger" title="Excluir" @click="delGroup = g"><Icon name="trash" :size="15" /></button>
          </div>
        </div>
        <div class="kmrow-meta" style="margin-top:6px">{{ g.members ?? 0 }} membro(s) · {{ g.grants.length }} concessão(ões)</div>
        <div v-if="g.grants.length" style="margin-top:8px; display:flex; flex-direction:column; gap:6px">
          <div v-for="gr in g.grants" :key="gr.bucketId + gr.prefix" class="grant-row">
            <span class="grant-loc"><strong>{{ bucketName(gr.bucketId) }}</strong> <span class="muted">{{ prefixLabel(gr.prefix) }}</span></span>
            <button class="perm-btn" @click="cycleGroupGrant(g, gr)"><PermBadge :perm="gr.perm" small /></button>
            <button class="iconbtn iconbtn-danger" @click="removeGroupGrant(g, gr)"><Icon name="x" :size="14" /></button>
          </div>
        </div>
      </div>
      <p v-if="!groups.length" class="modal-hint">Nenhum grupo ainda.</p>
    </template>

    <!-- new user modal -->
    <Modal v-if="showNew" title="Novo usuário" icon="key" @close="showNew = false">
      <div class="field">
        <label class="field-label">Usuário</label>
        <input class="field-input" v-model="nu.username" placeholder="ex: joao.silva" autocomplete="off" />
      </div>
      <div class="modal-row">
        <div class="field">
          <label class="field-label">Senha</label>
          <input class="field-input" type="password" v-model="nu.password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label class="field-label">Papel</label>
          <select class="modal-input" v-model="nu.role">
            <option value="user">usuário</option>
            <option value="admin">administrador</option>
          </select>
        </div>
      </div>
      <p v-if="newErr" class="modal-hint" style="color:var(--danger)">{{ newErr }}</p>
      <p v-else class="modal-hint">A conta começa sem permissões. Conceda acesso por grupos ou concessões diretas.</p>
      <template #foot>
        <button class="btn" @click="showNew = false">Cancelar</button>
        <button class="btn btn-primary" @click="create"><Icon name="check" :size="16" />Criar usuário</button>
      </template>
    </Modal>

    <!-- reset password modal -->
    <Modal v-if="resetUser" title="Redefinir senha" icon="shield" @close="resetUser = null">
      <p class="modal-text">Nova senha para <strong>{{ resetUser }}</strong>:</p>
      <input class="modal-input" style="margin-top:12px" type="password" v-model="resetPwd" autocomplete="new-password" @keydown.enter="confirmReset" />
      <template #foot>
        <button class="btn" @click="resetUser = null">Cancelar</button>
        <button class="btn btn-primary" @click="confirmReset"><Icon name="check" :size="16" />Salvar senha</button>
      </template>
    </Modal>

    <!-- delete user modal -->
    <Modal v-if="delUser" title="Excluir usuário" icon="trash" @close="delUser = null">
      <p class="modal-text">Excluir a conta <strong>{{ delUser }}</strong>?</p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> O usuário perde o acesso imediatamente. Esta ação não pode ser desfeita.</p>
      <template #foot>
        <button class="btn" @click="delUser = null">Cancelar</button>
        <button class="btn btn-danger" @click="confirmDelete"><Icon name="trash" :size="16" />Excluir conta</button>
      </template>
    </Modal>

    <!-- new group modal -->
    <Modal v-if="showNewGroup" title="Novo grupo" icon="shield" @close="showNewGroup = false">
      <div class="field">
        <label class="field-label">Nome do grupo</label>
        <input class="field-input" v-model="newGroupName" placeholder="ex: Financeiro" @keydown.enter="createGroup" />
      </div>
      <template #foot>
        <button class="btn" @click="showNewGroup = false">Cancelar</button>
        <button class="btn btn-primary" @click="createGroup"><Icon name="check" :size="16" />Criar grupo</button>
      </template>
    </Modal>

    <!-- delete group modal -->
    <Modal v-if="delGroup" title="Excluir grupo" icon="trash" @close="delGroup = null">
      <p class="modal-text">Excluir o grupo <strong>{{ delGroup.name }}</strong>?</p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> Os membros perdem o acesso que vinha deste grupo.</p>
      <template #foot>
        <button class="btn" @click="delGroup = null">Cancelar</button>
        <button class="btn btn-danger" @click="confirmDeleteGroup"><Icon name="trash" :size="16" />Excluir grupo</button>
      </template>
    </Modal>

    <!-- user permissions editor -->
    <Modal v-if="editUser" :title="`Permissões — ${editUser.username}`" icon="shield" @close="editUser = null">
      <template v-if="editUser.role === 'admin'">
        <p class="modal-text">Administradores têm acesso total a todos os buckets.</p>
      </template>
      <template v-else>
        <h3 class="field-label">Grupos</h3>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px">
          <button v-for="g in groups" :key="g.id" class="chip" :class="{ 'chip-on': editUser.groups.includes(g.id) }" @click="toggleGroup(g)">
            {{ g.name }}
          </button>
          <span v-if="!groups.length" class="muted">Nenhum grupo criado.</span>
        </div>

        <h3 class="field-label">Concessões diretas</h3>
        <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px">
          <div v-for="gr in editUser.grants" :key="gr.bucketId + gr.prefix" class="grant-row">
            <span class="grant-loc"><strong>{{ bucketName(gr.bucketId) }}</strong> <span class="muted">{{ prefixLabel(gr.prefix) }}</span></span>
            <button class="perm-btn" @click="cycleUserGrant(gr)"><PermBadge :perm="gr.perm" small /></button>
            <button class="iconbtn iconbtn-danger" @click="removeUserGrant(gr)"><Icon name="x" :size="14" /></button>
          </div>
          <p v-if="!editUser.grants.length" class="muted">Nenhuma concessão direta.</p>
        </div>
        <button class="btn" @click="startAdd('user-grant', editUser.username)"><Icon name="plus" :size="15" /> Conceder pasta</button>

        <h3 class="field-label" style="margin-top:16px">Bloqueios</h3>
        <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px">
          <div v-for="b in editUser.blocks" :key="b.bucketId + b.prefix" class="grant-row">
            <span class="grant-loc"><strong>{{ bucketName(b.bucketId) }}</strong> <span class="muted">{{ prefixLabel(b.prefix) }}</span></span>
            <span class="perm perm-ro perm-sm">BLOQUEADO</span>
            <button class="iconbtn iconbtn-danger" @click="removeUserBlock(b)"><Icon name="x" :size="14" /></button>
          </div>
          <p v-if="!editUser.blocks.length" class="muted">Nenhum bloqueio.</p>
        </div>
        <button class="btn btn-danger" @click="startAdd('user-block', editUser.username)"><Icon name="x" :size="15" /> Bloquear pasta</button>
      </template>
      <template #foot>
        <button class="btn btn-primary" @click="editUser = null"><Icon name="check" :size="16" />Fechar</button>
      </template>
    </Modal>

    <!-- group grants editor -->
    <Modal v-if="editGroup" :title="`Grants — ${editGroup.name}`" icon="database" @close="editGroup = null">
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:8px">
        <div v-for="gr in editGroup.grants" :key="gr.bucketId + gr.prefix" class="grant-row">
          <span class="grant-loc"><strong>{{ bucketName(gr.bucketId) }}</strong> <span class="muted">{{ prefixLabel(gr.prefix) }}</span></span>
          <button class="perm-btn" @click="cycleGroupGrant(editGroup, gr)"><PermBadge :perm="gr.perm" small /></button>
          <button class="iconbtn iconbtn-danger" @click="removeGroupGrant(editGroup, gr)"><Icon name="x" :size="14" /></button>
        </div>
        <p v-if="!editGroup.grants.length" class="muted">Nenhuma concessão.</p>
      </div>
      <button class="btn" @click="startAdd('group-grant', editGroup.id)"><Icon name="plus" :size="15" /> Conceder pasta</button>
      <template #foot>
        <button class="btn btn-primary" @click="editGroup = null"><Icon name="check" :size="16" />Fechar</button>
      </template>
    </Modal>

    <!-- bucket choice + folder picker for add flow -->
    <Modal v-if="picker" title="Bucket" icon="database" @close="picker = null">
      <div class="field">
        <label class="field-label">Bucket</label>
        <select class="modal-input" v-model="picker.bucketId">
          <option v-for="b in buckets" :key="b.id" :value="b.id">{{ b.name ?? b.id }}</option>
        </select>
      </div>
      <p class="modal-hint">Escolha o bucket; em seguida selecione a pasta.</p>
      <template #foot>
        <button class="btn" @click="picker = null">Cancelar</button>
      </template>
    </Modal>
    <FolderPicker v-if="picker" :bucket-id="picker.bucketId" :bucket-name="bucketName(picker.bucketId)"
      @pick="onPick" @close="picker = null" />
  </div>
</template>

<style scoped>
.card { background:var(--surface-2,#161616); border:1px solid var(--border,#2a2a2a); border-radius:10px; padding:14px; }
.chip { background:var(--surface-3,#222); border:1px solid var(--border,#333); border-radius:999px; padding:3px 10px; font-size:12px; cursor:pointer; color:inherit; }
.chip-on { background:var(--accent,#3b82f6); border-color:var(--accent,#3b82f6); color:#fff; }
.grant-row { display:flex; align-items:center; gap:8px; }
.grant-loc { flex:1; font-size:13px; }
.muted { opacity:.6; }
.perm-btn { background:none; border:none; cursor:pointer; padding:0; }
</style>
