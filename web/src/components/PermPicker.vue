<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { Perm } from '../core/models';
import Icon from './Icon.vue';

const LEVELS = [
  { value: 'view-only', label: 'Ver', icon: 'eye', tag: 'PODE VER', tagCls: 'muted', desc: 'Só visualiza a lista de arquivos.' },
  { value: 'read-only', label: 'Baixar', icon: 'download', tag: 'PODE BAIXAR', tagCls: 'ok', desc: 'Visualiza e baixa os arquivos.' },
  { value: 'read-write', label: 'Enviar', icon: 'upload', tag: 'PODE ENVIAR', tagCls: 'cyan', desc: 'Visualiza, baixa e envia novos arquivos.' },
  { value: 'owner', label: 'Dono', icon: 'shield', tag: 'DONO', tagCls: 'amber', desc: 'Controle total: também renomeia e exclui.' },
] as const;

const props = defineProps<{ perm: Perm }>();
const emit = defineEmits<{ change: [perm: Perm] }>();
const activeIdx = computed(() => { const i = LEVELS.findIndex((l) => l.value === props.perm); return i < 0 ? 0 : i; });
const current = computed(() => LEVELS[activeIdx.value]!);
const segCls = (i: number) => (i === activeIdx.value ? 'on' : i < activeIdx.value ? 'below' : '');
</script>

<template>
  <div class="pp">
    <div class="pp-seg" role="group" aria-label="Nível de acesso">
      <button v-for="(l, i) in LEVELS" :key="l.value" type="button" class="pp-opt" :class="segCls(i)"
              :aria-pressed="l.value === perm" @click="emit('change', l.value)">
        <Icon :name="l.icon" :size="14" /><span>{{ l.label }}</span>
      </button>
    </div>
    <div class="pp-cap">
      <span class="pp-tag" :class="current.tagCls">{{ current.tag }}</span>
      <span class="pp-desc">{{ current.desc }}</span>
    </div>
  </div>
</template>

<style scoped>
.pp { display: flex; flex-direction: column; gap: 12px; }
.pp-seg { display: flex; width: 100%; border: 1px solid var(--line-2); border-radius: 9px; overflow: hidden; background: rgba(0, 0, 0, .28); }
.pp-opt {
  display: flex; align-items: center; justify-content: center; gap: 7px; flex: 1;
  border: none; border-right: 1px solid var(--line); cursor: pointer; padding: 8px 12px;
  font-family: inherit; font-size: 13.5px; font-weight: 500; background: transparent; color: var(--text-2);
  transition: background .15s, color .15s, box-shadow .15s;
}
.pp-opt:last-child { border-right: none; }
.pp-opt:hover:not(.on) { color: var(--text); background: color-mix(in srgb, var(--neon) 6%, transparent); }
.pp-opt.below { background: color-mix(in srgb, var(--neon) 9%, transparent); color: var(--text); }
.pp-opt.on { background: var(--neon); color: #04252c; font-weight: 700; box-shadow: 0 0 14px color-mix(in srgb, var(--neon) 38%, transparent); }
.pp-cap { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pp-tag { font-family: var(--mono); font-size: 10.5px; font-weight: 700; letter-spacing: 1.5px; border-radius: 999px; padding: 4px 11px; white-space: nowrap; flex: none; }
.pp-tag.muted { color: var(--text-2); background: color-mix(in srgb, var(--text-2) 12%, transparent); border: 1px solid color-mix(in srgb, var(--text-2) 26%, transparent); }
.pp-tag.ok { color: var(--green); background: color-mix(in srgb, var(--green) 11%, transparent); border: 1px solid color-mix(in srgb, var(--green) 34%, transparent); }
.pp-tag.cyan { color: var(--neon); background: color-mix(in srgb, var(--neon) 10%, transparent); border: 1px solid color-mix(in srgb, var(--neon) 34%, transparent); }
.pp-tag.amber { color: var(--amber); background: color-mix(in srgb, var(--amber) 11%, transparent); border: 1px solid color-mix(in srgb, var(--amber) 36%, transparent); }
.pp-desc { font-size: 13px; color: var(--text-2); }
</style>
