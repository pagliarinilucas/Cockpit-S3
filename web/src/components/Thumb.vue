<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../core/api';
import Icon from './Icon.vue';

const props = defineProps<{ bucketId: string; objKey: string; icon: string; size?: number }>();

const root = ref<HTMLElement | null>(null);
const src = ref<string | null>(null);
const failed = ref(false);
let obs: IntersectionObserver | null = null;
let loaded = false;

async function load() {
  if (loaded) return; loaded = true;
  try {
    const blob = await api.thumbBlob(props.bucketId, props.objKey);
    src.value = URL.createObjectURL(blob);
  } catch { failed.value = true; }   // 415/erro → mostra o ícone
}

onMounted(() => {
  // só busca a miniatura quando o card entra na viewport (evita baixar tudo de uma vez)
  obs = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { obs?.disconnect(); obs = null; load(); }
  }, { rootMargin: '200px' });
  if (root.value) obs.observe(root.value);
});
onBeforeUnmount(() => {
  obs?.disconnect();
  if (src.value) URL.revokeObjectURL(src.value);
});
</script>

<template>
  <span ref="root" class="thumb">
    <img v-if="src" :src="src" alt="" class="thumb-img" draggable="false" @error="failed = true; src = null" />
    <Icon v-else :name="icon" :size="size ?? 34" />
  </span>
</template>

<style scoped>
/* preenche o box-pai (que é position:relative; overflow:hidden) sem depender da altura herdada */
.thumb { position: absolute; inset: 0; display: grid; place-items: center; }
.thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
