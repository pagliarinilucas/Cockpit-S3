<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { User, Bucket, Perm, Role } from '../core/models';
import { api, apiErrMsg, ApiError } from '../core/api';
import { useToast } from '../core/toast';
import { timeAgo } from '../core/util';
import { PERM_META, PERM_CYCLE } from '../core/perm';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';

const toast = useToast();
const users = ref<User[]>([]);
const buckets = ref<Bucket[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const showNew = ref(false);
const newErr = ref<string | null>(null);
const nu = ref<{ username: string; password: string; role: Role }>({ username: '', password: '', role: 'user' });

const resetUser = ref<string | null>(null);
const resetPwd = ref('');
const delUser = ref<string | null>(null);

const cols = computed(() => `260px repeat(${buckets.value.length || 1}, 1fr)`);

async function reload() {
  loading.value = true; error.value = null;
  try {
    users.value = (await api.users()) ?? [];           // primary — must succeed
    try { buckets.value = (await api.buckets()) ?? []; } // optional — empty if Garage not set up
    catch { buckets.value = []; }
  } catch (e) { error.value = apiErrMsg(e); }
  finally { loading.value = false; }
}
onMounted(reload);
defineExpose({ reload });

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

async function cycle(u: User, bucketId: string) {
  const cur = u.grants[bucketId] ?? null;
  const next = PERM_CYCLE[(PERM_CYCLE.indexOf(cur) + 1) % PERM_CYCLE.length];
  users.value = users.value.map((x) => x.username === u.username ? { ...x, grants: { ...x.grants, [bucketId]: next } } : x);
  try { await api.setUserGrant(u.username, bucketId, next); }
  catch { toast.error('Falha ao alterar permissão'); reload(); }
}

const cellCls = (u: User, bucketId: string) => { const p = u.grants[bucketId]; return p ? PERM_META[p].cls : 'kmcell-none'; };
const cellTitle = (u: User, b: Bucket) => `${u.username} → ${b.name ?? b.id}: ${u.grants[b.id] ?? 'sem acesso'}`;
const iconFor = (p: Perm) => PERM_META[p].icon;
</script>

<template>
  <div class="view">
    <div class="view-head">
      <div>
        <h1 class="view-title">Usuários</h1>
        <p class="view-sub">{{ users.length }} contas · permissões por bucket (clique numa célula para alternar)</p>
      </div>
      <button class="btn btn-primary" @click="openNew"><Icon name="plus" :size="16" />Novo usuário</button>
    </div>

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
      <p v-else class="modal-hint">A conta começa sem permissões. Conceda acesso por bucket na matriz.</p>
      <template #foot>
        <button class="btn" @click="showNew = false">Cancelar</button>
        <button class="btn btn-primary" @click="create"><Icon name="check" :size="16" />Criar usuário</button>
      </template>
    </Modal>

    <Modal v-if="resetUser" title="Redefinir senha" icon="shield" @close="resetUser = null">
      <p class="modal-text">Nova senha para <strong>{{ resetUser }}</strong>:</p>
      <input class="modal-input" style="margin-top:12px" type="password" v-model="resetPwd" autocomplete="new-password" @keydown.enter="confirmReset" />
      <template #foot>
        <button class="btn" @click="resetUser = null">Cancelar</button>
        <button class="btn btn-primary" @click="confirmReset"><Icon name="check" :size="16" />Salvar senha</button>
      </template>
    </Modal>

    <Modal v-if="delUser" title="Excluir usuário" icon="trash" @close="delUser = null">
      <p class="modal-text">Excluir a conta <strong>{{ delUser }}</strong>?</p>
      <p class="modal-warn"><Icon name="shield" :size="14" /> O usuário perde o acesso imediatamente. Esta ação não pode ser desfeita.</p>
      <template #foot>
        <button class="btn" @click="delUser = null">Cancelar</button>
        <button class="btn btn-danger" @click="confirmDelete"><Icon name="trash" :size="16" />Excluir conta</button>
      </template>
    </Modal>

    <div v-if="loading" class="loading"><div class="spinner"></div>CARREGANDO USUÁRIOS…</div>
    <div v-else-if="error" class="errbox">
      <Icon name="alert" :size="32" />
      <div class="errbox-title">Não foi possível carregar os usuários</div>
      <div class="errbox-sub">{{ error }}</div>
      <button class="btn" @click="reload"><Icon name="refresh" :size="15" />Tentar de novo</button>
    </div>
    <template v-else>
      <div class="keymatrix">
        <div class="kmatrix-head" :style="{ gridTemplateColumns: cols }">
          <div class="kmh-key">USUÁRIO</div>
          <div v-for="b in buckets" :key="b.id" class="kmh-bucket" :title="(b.connection ? b.connection + ' · ' : '') + (b.name ?? b.id)">{{ b.name ?? b.id }}</div>
        </div>
        <div v-for="u in users" :key="u.username" class="kmrow" :style="{ gridTemplateColumns: cols }">
          <div class="kmrow-key">
            <div class="kmrow-top">
              <div class="kmrow-name"><Icon name="key" :size="15" /> {{ u.username }}</div>
              <div class="kmrow-acts">
                <button class="iconbtn" title="Redefinir senha" @click="openReset(u.username)"><Icon name="shield" :size="15" /></button>
                <button class="iconbtn iconbtn-danger" title="Excluir" @click="delUser = u.username"><Icon name="trash" :size="15" /></button>
              </div>
            </div>
            <div style="margin-top:7px">
              <span class="role-badge" :class="u.role === 'admin' ? 'role-admin' : 'role-user'">{{ u.role === 'admin' ? 'ADMIN' : 'USUÁRIO' }}</span>
            </div>
            <div class="kmrow-meta">{{ u.lastLogin ? 'entrou ' + timeAgo(u.lastLogin) : 'nunca entrou' }}{{ u.created ? ' · criado ' + u.created : '' }}</div>
          </div>
          <button v-for="b in buckets" :key="b.id" :class="'kmcell ' + cellCls(u, b.id)" @click="cycle(u, b.id)" :title="cellTitle(u, b)">
            <Icon v-if="u.grants[b.id]" :name="iconFor(u.grants[b.id]!)" :size="15" />
            <span v-else class="kmcell-dash">—</span>
          </button>
        </div>
      </div>
      <div class="keymatrix-legend">
        <span><span class="lg lg-none"></span> sem acesso</span>
        <span><span class="lg lg-ro"></span> read-only</span>
        <span><span class="lg lg-rw"></span> read/write</span>
        <span><span class="lg lg-owner"></span> owner</span>
      </div>
    </template>
  </div>
</template>
