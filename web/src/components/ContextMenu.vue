<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import Icon from './Icon.vue';

export interface MenuItem { key: string; label: string; icon?: string; danger?: boolean; disabled?: boolean }

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>();
const emit = defineEmits<{ select: [key: string]; close: [] }>();

const el = ref<HTMLElement | null>(null);
// reposiciona se estourar a viewport (mede após render)
const pos = ref({ left: props.x, top: props.y });
onMounted(() => {
  const r = el.value?.getBoundingClientRect();
  if (r) {
    const left = props.x + r.width > window.innerWidth ? Math.max(4, window.innerWidth - r.width - 4) : props.x;
    const top = props.y + r.height > window.innerHeight ? Math.max(4, window.innerHeight - r.height - 4) : props.y;
    pos.value = { left, top };
  }
});

const style = computed(() => ({ left: pos.value.left + 'px', top: pos.value.top + 'px' }));

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

function pick(it: MenuItem) { if (!it.disabled) emit('select', it.key); }
</script>

<template>
  <teleport to="body">
    <div class="ctx-back" @click="emit('close')" @contextmenu.prevent="emit('close')" @wheel="emit('close')">
      <div ref="el" class="ctx-menu" :style="style" @click.stop>
        <button v-for="it in items" :key="it.key" class="ctx-item" :class="{ 'is-danger': it.danger }"
                :disabled="it.disabled" @click="pick(it)">
          <Icon v-if="it.icon" :name="it.icon" :size="15" />
          <span>{{ it.label }}</span>
        </button>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.ctx-back { position: fixed; inset: 0; z-index: 1000; }
.ctx-menu {
  position: fixed; min-width: 200px; padding: 5px;
  background: var(--panel, #12161c); border: 1px solid var(--border, #2a2f3a);
  border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.45);
  display: flex; flex-direction: column; gap: 2px;
}
.ctx-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 8px 10px; border: 0; background: transparent; cursor: pointer;
  color: var(--text, #d7dce3); font: inherit; font-size: 13px; text-align: left; border-radius: 7px;
}
.ctx-item:hover:not(:disabled) { background: var(--hover, rgba(255,255,255,.06)); }
.ctx-item.is-danger { color: var(--danger, #ff6b6b); }
.ctx-item:disabled { opacity: .4; cursor: not-allowed; }
</style>
