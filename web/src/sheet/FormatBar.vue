<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref } from 'vue';
import Icon from '../components/Icon.vue';
import { NUM_FORMATS } from './format';
import type { CellStyle } from './model';

const props = defineProps<{ current: CellStyle; disabled?: boolean }>();
const emit = defineEmits<{ apply: [Partial<CellStyle>] }>();

/** Paleta de preenchimento: tons que funcionam com texto escuro. */
const FILLS = [
  'FFEB3B', 'FFC107', 'FF9800', 'FF7043',
  'EF5350', 'EC407A', 'AB47BC', '7E57C2',
  '5C6BC0', '42A5F5', '29B6F6', '26C6DA',
  '26A69A', '66BB6A', '9CCC65', 'D4E157',
  'FFFFFF', 'ECEFF1', 'B0BEC5', '78909C',
];

const TEXT_COLORS = ['000000', 'FFFFFF', 'C62828', '2E7D32', '1565C0', 'EF6C00', '6A1B9A', '546E7A'];

const openPicker = ref<'bg' | 'fg' | null>(null);

function toggle(prop: 'bold' | 'italic' | 'underline'): void {
  emit('apply', { [prop]: props.current[prop] ? undefined : true });
}

function pickFill(color: string | null): void {
  openPicker.value = null;
  emit('apply', { bg: color ?? undefined });
}

function pickText(color: string | null): void {
  openPicker.value = null;
  emit('apply', { fg: color ?? undefined });
}

function setAlign(align: 'left' | 'center' | 'right'): void {
  emit('apply', { align: props.current.align === align ? undefined : align });
}

function setFormat(code: string): void {
  emit('apply', { numFmt: code === '' ? undefined : code });
}

const clearAll = (): void => emit('apply', {
  bg: undefined, fg: undefined, bold: undefined, italic: undefined,
  underline: undefined, align: undefined, numFmt: undefined, border: undefined,
});
</script>

<template>
  <div class="fb" :class="{ 'is-off': disabled }">
    <div class="fb-group">
      <button class="fb-btn" :class="{ on: current.bold }" title="Negrito" :disabled="disabled" @click="toggle('bold')"><b>N</b></button>
      <button class="fb-btn" :class="{ on: current.italic }" title="Itálico" :disabled="disabled" @click="toggle('italic')"><i>I</i></button>
      <button class="fb-btn" :class="{ on: current.underline }" title="Sublinhado" :disabled="disabled" @click="toggle('underline')"><u>S</u></button>
    </div>

    <div class="fb-group">
      <div class="fb-pop-host">
        <button
          class="fb-btn fb-swatch-btn" title="Cor de preenchimento" :disabled="disabled"
          @click="openPicker = openPicker === 'bg' ? null : 'bg'"
        >
          <span class="fb-swatch" :style="{ background: current.bg ? '#' + current.bg : 'transparent' }" />
          <Icon name="palette" :size="14" />
        </button>
        <div v-if="openPicker === 'bg'" class="fb-pop">
          <div class="fb-pop-grid">
            <button
              v-for="c in FILLS" :key="c" class="fb-chip"
              :style="{ background: '#' + c }" :title="'#' + c" @click="pickFill(c)"
            />
          </div>
          <button class="fb-clear" @click="pickFill(null)">sem preenchimento</button>
        </div>
      </div>

      <div class="fb-pop-host">
        <button
          class="fb-btn fb-swatch-btn" title="Cor do texto" :disabled="disabled"
          @click="openPicker = openPicker === 'fg' ? null : 'fg'"
        >
          <span class="fb-letter" :style="{ color: current.fg ? '#' + current.fg : 'var(--text)' }">A</span>
        </button>
        <div v-if="openPicker === 'fg'" class="fb-pop">
          <div class="fb-pop-grid fb-pop-grid-sm">
            <button
              v-for="c in TEXT_COLORS" :key="c" class="fb-chip"
              :style="{ background: '#' + c }" :title="'#' + c" @click="pickText(c)"
            />
          </div>
          <button class="fb-clear" @click="pickText(null)">cor padrão</button>
        </div>
      </div>
    </div>

    <div class="fb-group">
      <button class="fb-btn" :class="{ on: current.align === 'left' }" title="Alinhar à esquerda" :disabled="disabled" @click="setAlign('left')">⇤</button>
      <button class="fb-btn" :class="{ on: current.align === 'center' }" title="Centralizar" :disabled="disabled" @click="setAlign('center')">↔</button>
      <button class="fb-btn" :class="{ on: current.align === 'right' }" title="Alinhar à direita" :disabled="disabled" @click="setAlign('right')">⇥</button>
      <button class="fb-btn" :class="{ on: current.border }" title="Borda" :disabled="disabled" @click="emit('apply', { border: current.border ? undefined : true })">▢</button>
    </div>

    <select
      class="fb-select" :value="current.numFmt ?? ''" :disabled="disabled"
      title="Formato do número" @change="setFormat(($event.target as HTMLSelectElement).value)"
    >
      <option v-for="f in NUM_FORMATS" :key="f.label" :value="f.code ?? ''">{{ f.label }}</option>
    </select>

    <button class="fb-btn fb-wide" title="Limpar formatação" :disabled="disabled" @click="clearAll">limpar</button>
  </div>
</template>

<style scoped>
.fb {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 14px; background: var(--bg-1); border-bottom: 1px solid var(--line-2);
}
.fb.is-off { opacity: 0.45; }
.fb-group { display: flex; gap: 2px; align-items: center; }
.fb-group + .fb-group { padding-left: 10px; border-left: 1px solid var(--line); }

.fb-btn {
  min-width: 28px; height: 28px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  border: 1px solid transparent; border-radius: 7px;
  background: transparent; color: var(--text-2);
  font-family: var(--body); font-size: 13px; cursor: pointer;
}
.fb-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--text); }
.fb-btn:disabled { cursor: default; }
.fb-btn.on { background: color-mix(in srgb, var(--neon) 16%, var(--bg-2)); color: var(--neon); border-color: color-mix(in srgb, var(--neon) 40%, transparent); }
.fb-wide { font-family: var(--mono); font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; }

.fb-swatch-btn { padding: 0 5px; }
.fb-swatch {
  width: 14px; height: 14px; border-radius: 3px;
  border: 1px solid var(--line-2);
  background-image: linear-gradient(45deg, var(--bg-3) 25%, transparent 25%, transparent 75%, var(--bg-3) 75%);
  background-size: 8px 8px;
}
.fb-letter { font-weight: 700; font-size: 14px; }

.fb-pop-host { position: relative; }
.fb-pop {
  position: absolute; top: 34px; left: 0; z-index: 20;
  background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 10px;
  padding: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.fb-pop-grid { display: grid; grid-template-columns: repeat(4, 20px); gap: 5px; }
.fb-pop-grid-sm { grid-template-columns: repeat(4, 20px); }
.fb-chip { width: 20px; height: 20px; border-radius: 4px; border: 1px solid var(--line-2); cursor: pointer; }
.fb-chip:hover { transform: scale(1.12); }
.fb-clear {
  display: block; width: 100%; margin-top: 8px; padding: 5px;
  border: 1px solid var(--line-2); border-radius: 6px;
  background: var(--bg-1); color: var(--text-2);
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.6px; cursor: pointer;
}
.fb-clear:hover { color: var(--text); background: var(--bg-3); }

.fb-select {
  height: 28px; padding: 0 8px; border-radius: 7px;
  border: 1px solid var(--line-2); background: var(--bg-2); color: var(--text);
  font-family: var(--body); font-size: 12.5px; cursor: pointer;
}
.fb-select:disabled { cursor: default; }
</style>
