<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { ObjectItem, Perm } from '../core/models';
import { api } from '../core/api';
import { fmtBytes, timeAgo, ICON_FOR } from '../core/util';
import Icon from '../components/Icon.vue';
import PermBadge from '../components/PermBadge.vue';

const props = defineProps<{
  bucketId: string; bucketPerm: Perm; path: string;
  items: ObjectItem[]; startKey: string; canWrite: boolean;
}>();
const emit = defineEmits<{ close: []; download: [ObjectItem]; copyLink: [ObjectItem]; delete: [ObjectItem] }>();

const idx = ref(0);
const url = ref<string | null>(null);
const loading = ref(false);
const failed = ref(false);
const wave = Array.from({ length: 64 }, (_, i) => 12 + Math.round((Math.sin(i * 0.7) * 0.5 + 0.5) * 80));

const item = computed<ObjectItem | null>(() => props.items[idx.value] ?? null);

async function load() {
  const it = item.value;
  if (!it) return;
  loading.value = true; failed.value = false; url.value = null;
  try { url.value = (await api.preview(props.bucketId, it.key)).url; }
  catch { failed.value = true; }
  finally { loading.value = false; }
}

function go(d: number) {
  if (!props.items.length) return;
  idx.value = (idx.value + d + props.items.length) % props.items.length;
  load();
}

watch(() => [props.startKey, props.items], () => {
  idx.value = Math.max(0, props.items.findIndex((x) => x.key === props.startKey));
  load();
}, { immediate: true });

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close');
  else if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

const fullPath = (it: ObjectItem) => props.bucketId + '/' + (props.path ? props.path : '') + it.name;
const iconFor = (it: ObjectItem) => ICON_FOR[it.type || 'file'];
</script>

<template>
  <div class="pv-back" @click="emit('close')">
    <button v-if="items.length > 1" class="pv-nav pv-prev" @click.stop="go(-1)"><Icon name="chevL" :size="26" /></button>

    <div class="pv-shell" @click.stop>
      <template v-if="item">
        <div class="pv-head">
          <div class="pv-head-l">
            <div :class="'pv-head-ic ft-' + (item.type || 'file')"><Icon :name="iconFor(item)" :size="18" /></div>
            <div class="pv-head-txt">
              <div class="pv-head-name">{{ item.name }}</div>
              <div class="pv-head-path">{{ fullPath(item) }}</div>
            </div>
          </div>
          <div class="pv-head-r">
            <button class="btn" @click="emit('download', item)"><Icon name="download" :size="16" />Download</button>
            <button class="btn" @click="emit('copyLink', item)"><Icon name="copy" :size="16" />Link</button>
            <button v-if="canWrite" class="iconbtn iconbtn-danger" title="Excluir" @click="emit('delete', item); emit('close')"><Icon name="trash" :size="17" /></button>
            <button class="iconbtn iconbtn-lg" @click="emit('close')"><Icon name="x" :size="18" /></button>
          </div>
        </div>

        <div class="pv-stage">
          <div class="pv-body">
            <div v-if="loading" class="pv-loading"><div class="spinner"></div>ABRINDO…</div>
            <div v-else-if="failed" class="pv-loading"><Icon name="alert" :size="34" />Não foi possível abrir a prévia.</div>
            <template v-else-if="url">
              <img v-if="item.type === 'image'" :src="url" :alt="item.name" />
              <video v-else-if="item.type === 'video'" :src="url" controls autoplay></video>
              <iframe v-else-if="item.type === 'pdf' || item.type === 'text' || item.type === 'code'" :src="url"></iframe>
              <div v-else-if="item.type === 'audio'" class="pv-audio-stage">
                <div class="pv-wave"><span v-for="(h, i) in wave" :key="i" :style="{ height: h + '%' }"></span></div>
                <audio :src="url" controls autoplay></audio>
              </div>
              <div v-else class="pv-loading"><Icon name="file" :size="34" />Sem prévia para este tipo.</div>
            </template>
          </div>

          <aside class="pv-info">
            <div class="pv-info-row"><span>TIPO</span><b>{{ (item.type || 'file').toUpperCase() }}</b></div>
            <div class="pv-info-row"><span>TAMANHO</span><b>{{ fmtBytes(item.size) }}</b></div>
            <div v-if="item.modified" class="pv-info-row"><span>MODIFICADO</span><b>{{ timeAgo(item.modified) }} atrás</b></div>
            <div v-if="item.by" class="pv-info-row"><span>AUTOR</span><b>{{ item.by }}</b></div>
            <div class="pv-info-sep"></div>
            <div><PermBadge :perm="bucketPerm" :small="true" /></div>
            <div class="pv-info-counter">{{ idx + 1 }} de {{ items.length }} · use ← →</div>
          </aside>
        </div>
      </template>
    </div>

    <button v-if="items.length > 1" class="pv-nav pv-next" @click.stop="go(1)"><Icon name="chevR" :size="26" /></button>
  </div>
</template>
