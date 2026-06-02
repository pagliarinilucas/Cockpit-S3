<script setup lang="ts">
import { computed } from 'vue';
import type { UploadItem } from '../core/ui';
import type { FileType } from '../core/models';
import { fmtBytes, ICON_FOR } from '../core/util';
import Icon from '../components/Icon.vue';
import LevelBar from '../components/LevelBar.vue';

const props = defineProps<{ uploads: UploadItem[] }>();
defineEmits<{ clear: [] }>();

const active = computed(() => props.uploads.filter((u) => u.progress < 1 && !u.error).length);
const iconFor = (t: FileType) => ICON_FOR[t];
const pct = (p: number) => Math.round(p * 100) + '%';
</script>

<template>
  <div v-if="uploads.length" class="updock">
    <div class="updock-head">
      <span><Icon name="upload" :size="14" /> {{ active > 0 ? 'Enviando ' + active : 'Concluído' }}</span>
      <button class="iconbtn" @click="$emit('clear')"><Icon name="x" :size="14" /></button>
    </div>
    <div class="updock-list">
      <div v-for="u in uploads" :key="u.id" class="upitem">
        <div :class="'upitem-ic ft-' + u.type"><Icon :name="iconFor(u.type)" :size="15" /></div>
        <div class="upitem-body">
          <div class="upitem-row">
            <span class="upitem-name">{{ u.name }}</span>
            <span class="upitem-pct" :class="{ err: u.error }">{{ u.error ? '✕' : (u.progress >= 1 ? '✓' : pct(u.progress)) }}</span>
          </div>
          <LevelBar :value="u.progress" :height="4" :color="u.error ? 'var(--danger)' : (u.progress >= 1 ? 'var(--green)' : 'var(--neon)')" />
          <div class="upitem-sub">{{ fmtBytes(u.size) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
