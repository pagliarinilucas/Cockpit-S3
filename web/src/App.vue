<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { Bucket, Me } from './core/models';
import { api, setOnUnauthorized } from './core/api';
import Icon from './components/Icon.vue';
import Toasts from './components/Toasts.vue';
import ThemePanel from './components/ThemePanel.vue';
import Login from './views/Login.vue';
import Buckets from './views/Buckets.vue';
import Files from './views/Files.vue';
import Activity from './views/Activity.vue';
import Users from './views/Users.vue';
import Cluster from './views/Cluster.vue';
import Settings from './views/Settings.vue';

type View = 'buckets' | 'files' | 'activity' | 'users' | 'cluster' | 'settings';
interface Reloadable { reload: () => void }

// Buckets is for everyone; cluster/activity/users/settings are admin-only.
const NAV_BUCKETS = { id: 'buckets' as View, label: 'Buckets', icon: 'database' };
const NAV_ADMIN = [
  { id: 'cluster' as View, label: 'Cluster', icon: 'gauge' },
  { id: 'activity' as View, label: 'Atividade', icon: 'activity' },
  { id: 'users' as View, label: 'Usuários', icon: 'shield' },
  { id: 'settings' as View, label: 'Configurações', icon: 'cpu' },
];

const me = ref<Me | null>(null);
const booting = ref(true);
const view = ref<View>('buckets');
const activeBucket = ref<Bucket | null>(null);
const filePath = ref<string[]>([]);   // current folder path inside the active bucket
const query = ref('');
const autoOpened = ref(false);   // single-bucket auto-open happens once per session
const bucketCount = ref(0);      // how many buckets this user can reach
const homeBucket = ref<Bucket | null>(null);   // the lone bucket of a basic single-bucket user

const bucketsRef = ref<Reloadable | null>(null);
const filesRef = ref<Reloadable | null>(null);
const activityRef = ref<Reloadable | null>(null);
const usersRef = ref<Reloadable | null>(null);
const settingsRef = ref<Reloadable | null>(null);
const clusterRef = ref<Reloadable | null>(null);

const isAdmin = computed(() => me.value?.role === 'admin');
// A basic user only reaches the bucket list if they can see more than one bucket;
// with a single bucket their home IS that bucket and there's no list to browse.
const canBrowseBuckets = computed(() => isAdmin.value || bucketCount.value > 1);
const minimalSidebar = computed(() => !!me.value && !isAdmin.value);

const nav = computed(() => {
  if (isAdmin.value) return [NAV_BUCKETS, ...NAV_ADMIN];
  return canBrowseBuckets.value ? [NAV_BUCKETS] : [];
});

// ── Browser-history sync ──────────────────────────────────────────────────
// The whole in-app location (view + active bucket + folder path) is mirrored in
// history.state, so the browser Back/Forward buttons step through navigation.
interface Loc { view: View; bucket: Bucket | null; path: string[] }
// NOTE: spread the bucket into a *plain* object — a Vue reactive Proxy can't be
// structured-cloned, which makes history.pushState throw and silently lose the entry.
function snapshot(): Loc {
  const b = activeBucket.value;
  return { view: view.value, bucket: b ? { ...b } : null, path: [...filePath.value] };
}
function applyLoc(loc: Loc) {
  view.value = loc.view;
  activeBucket.value = loc.bucket;
  filePath.value = [...(loc.path ?? [])];
  query.value = '';
}
// Reflect the location in the URL hash too — guarantees a distinct, visible
// history entry per folder and lets a reload (F5) land back in the same place.
function locHash(): string {
  if (view.value === 'files' && activeBucket.value) {
    const segs = filePath.value.map(encodeURIComponent).join('/');
    return `#/b/${encodeURIComponent(activeBucket.value.id)}${segs ? '/' + segs : ''}`;
  }
  return view.value === 'buckets' ? '#/' : `#/${view.value}`;
}
function pushLoc() { history.pushState(snapshot(), '', locHash()); }
function resetLoc() { history.replaceState(snapshot(), '', locHash()); }   // set the base entry

// On reload, rebuild a real back-stack (bucket root → folder → subfolder) so the
// browser Back button still walks up one folder at a time instead of being a no-op.
function rebuildStack(bucket: Bucket, segs: string[]) {
  activeBucket.value = bucket; view.value = 'files'; query.value = ''; filePath.value = [];
  resetLoc();                                  // base entry: bucket root
  for (let i = 0; i < segs.length; i++) {
    filePath.value = segs.slice(0, i + 1);
    pushLoc();                                 // one entry per folder level
  }
}
function onPop(e: PopStateEvent) {
  if (!me.value) return;            // ignore while logged out
  const loc: Loc = (e.state && (e.state as Loc).view) ? (e.state as Loc) : { view: 'buckets', bucket: null, path: [] };
  // A basic single-bucket user has no bucket list to go back to — re-anchor them
  // in their bucket so Back never exposes the buckets screen.
  if (loc.view === 'buckets' && !canBrowseBuckets.value && homeBucket.value) {
    openBucket(homeBucket.value);   // pushes a fresh files entry, keeping them in the bucket
    return;
  }
  applyLoc(loc);
}

onMounted(async () => {
  // if a refresh token mid-session goes invalid, drop to the login screen
  setOnUnauthorized(() => { me.value = null; activeBucket.value = null; });
  window.addEventListener('popstate', onPop);
  try { me.value = await api.restore(); } catch { me.value = null; }
  finally {
    booting.value = false;
    if (me.value) {
      // Restore the exact folder on reload (history.state survives a refresh) and
      // rebuild the back-stack so Back still walks up the folder chain.
      const st = history.state as Loc | null;
      if (st && st.view === 'files' && st.bucket) {
        autoOpened.value = true;
        rebuildStack(st.bucket, st.path ?? []);
        api.buckets().then(noteBuckets).catch(() => {});   // populate counts in the background
      } else {
        resetLoc();
      }
    }
  }
});
onBeforeUnmount(() => window.removeEventListener('popstate', onPop));

async function onLogin() {
  try { me.value = await api.me(); } catch { me.value = null; }
  view.value = 'buckets'; filePath.value = []; activeBucket.value = null; autoOpened.value = false; homeBucket.value = null;
  resetLoc();
}
async function logout() {
  try { await api.logout(); } catch { /* ignore */ }
  me.value = null; activeBucket.value = null; filePath.value = []; view.value = 'buckets'; query.value = ''; autoOpened.value = false; homeBucket.value = null;
}

// Buckets emits its loaded list. If the user can reach exactly one bucket, that
// bucket is their home: open it and *replace* the history entry so Back doesn't
// land on the (off-limits) bucket list. Done once per session.
function noteBuckets(list: Bucket[]) {
  bucketCount.value = list.length;
  homeBucket.value = (!isAdmin.value && list.length === 1) ? list[0]! : null;
}
function onBucketsLoaded(list: Bucket[]) {
  noteBuckets(list);
  if (!autoOpened.value && list.length === 1) { autoOpened.value = true; openBucket(list[0]!, true); }
}

const isOn = (id: View) => view.value === id || (id === 'buckets' && view.value === 'files');
function goNav(id: View) {
  view.value = id; query.value = '';
  if (id === 'buckets') { activeBucket.value = null; filePath.value = []; }
  pushLoc();
}
function openBucket(b: Bucket, replace = false) {
  activeBucket.value = b; view.value = 'files'; filePath.value = []; query.value = '';
  replace ? resetLoc() : pushLoc();
}
function backToBuckets() { view.value = 'buckets'; activeBucket.value = null; filePath.value = []; query.value = ''; pushLoc(); }
function openFolder(name: string) { filePath.value = [...filePath.value, name]; pushLoc(); }
function gotoCrumb(i: number) { filePath.value = filePath.value.slice(0, i + 1); pushLoc(); }

const searchable = computed(() => view.value === 'buckets' || view.value === 'activity');
const searchPlaceholder = computed(() => {
  if (view.value === 'files') return 'use a busca da pasta abaixo…';
  if (view.value === 'users' || view.value === 'cluster' || view.value === 'settings') return 'busca indisponível aqui';
  if (view.value === 'activity') return 'Buscar eventos…';
  return 'Buscar buckets…';
});

function refresh() {
  bucketsRef.value?.reload();
  filesRef.value?.reload();
  activityRef.value?.reload();
  usersRef.value?.reload();
  clusterRef.value?.reload();
  settingsRef.value?.reload();
}
const initials = computed(() => (me.value?.username || '').slice(0, 2).toUpperCase() || 'VC');
</script>

<template>
  <div v-if="booting" class="loading" style="height:100vh;justify-content:center"><div class="spinner"></div>INICIANDO COCKPIT…</div>

  <template v-else-if="!me">
    <Login @logged-in="onLogin" />
    <ThemePanel />
  </template>

  <template v-else>
    <div class="app" :class="{ 'app-min': minimalSidebar }">
      <aside class="sidebar" :class="{ 'sidebar-min': minimalSidebar }">
        <div class="brand">
          <div class="brand-mark"><Icon name="gauge" :size="22" /></div>
          <div class="brand-text">
            <div class="brand-name">COCKPIT</div>
            <div class="brand-sub">STORAGE · S3</div>
          </div>
        </div>

        <nav v-if="nav.length" class="nav">
          <button v-for="n in nav" :key="n.id" class="navitem" :class="{ 'navitem-on': isOn(n.id) }" @click="goNav(n.id)">
            <Icon :name="n.icon" :size="18" />
            <span>{{ n.label }}</span>
            <span v-if="isOn(n.id)" class="navitem-glow"></span>
          </button>
        </nav>

        <div class="sidebar-foot">
          <div v-if="!minimalSidebar" class="ignition">
            <span class="ign-light"></span>
            <div class="ign-text">
              <div class="ign-status">CONECTADO</div>
              <div class="ign-sub">cluster garage</div>
            </div>
            <Icon name="power" :size="16" />
          </div>
          <div class="user">
            <div class="user-av">{{ initials }}</div>
            <div class="user-info">
              <div class="user-name">{{ me.username }}</div>
              <div class="user-role">{{ me.role || 'usuário' }}</div>
            </div>
            <button class="iconbtn user-logout" title="Sair" @click="logout"><Icon name="logout" :size="17" /></button>
          </div>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <div v-if="searchable || view === 'files'" class="searchbox searchbox-global">
            <Icon name="search" :size="16" />
            <input v-model="query" :disabled="!searchable" :placeholder="searchPlaceholder" />
          </div>
          <div class="topbar-right">
            <div class="env-pill"><span class="env-dot"></span> garage</div>
            <button class="iconbtn iconbtn-lg" title="Atualizar" @click="refresh"><Icon name="refresh" :size="17" /></button>
          </div>
        </header>

        <main class="content">
          <Buckets v-if="view === 'buckets'" ref="bucketsRef" :query="query" :is-admin="me?.role === 'admin'"
                   @open="openBucket" @go-settings="view = 'settings'" @loaded="onBucketsLoaded" />
          <Files v-else-if="view === 'files' && activeBucket" ref="filesRef" :bucket="activeBucket" :path="filePath"
                 :can-back="canBrowseBuckets" @back="backToBuckets" @open-folder="openFolder" @crumb="gotoCrumb" />
          <Activity v-else-if="view === 'activity'" ref="activityRef" :query="query" />
          <Users v-else-if="view === 'users'" ref="usersRef" />
          <Cluster v-else-if="view === 'cluster'" ref="clusterRef" />
          <Settings v-else-if="view === 'settings'" ref="settingsRef" />
        </main>
      </div>
    </div>

    <ThemePanel />
  </template>

  <Toasts />
</template>
