<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import Icon from '../components/Icon.vue';
import { SHORTCUT_GROUPS } from './shortcuts';

defineProps<{ readonly?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const CONNECTORS = new Set(['+', 'ou', 'e']);

const isKey = (token: string) => !CONNECTORS.has(token) && token.length <= 9 && !token.includes(' ');
</script>

<template>
  <div class="sk-back" @click.stop="emit('close')">
    <div class="sk-panel" data-shortcuts @click.stop>
      <header class="sk-head">
        <Icon name="help" :size="18" />
        <span class="sk-title">Atalhos da planilha</span>
        <span v-if="readonly" class="sk-ro">nesta tela você só está lendo — os de edição não valem</span>
        <div class="sk-spacer" />
        <button class="iconbtn" title="Fechar (Esc)" @click="emit('close')">
          <Icon name="x" :size="17" />
        </button>
      </header>

      <div class="sk-groups">
        <section v-for="group in SHORTCUT_GROUPS" :key="group.title" class="sk-group">
          <h3 class="sk-group-title">{{ group.title }}</h3>
          <div
            v-for="(item, i) in group.items" :key="group.title + i"
            class="sk-row" :data-shortcut="item.what"
          >
            <div class="sk-keys">
              <template v-for="(token, k) in item.keys" :key="k">
                <kbd v-if="isKey(token)" class="sk-key">{{ token }}</kbd>
                <span v-else class="sk-plain">{{ token }}</span>
              </template>
            </div>
            <div class="sk-what">
              {{ item.what }}
              <span v-if="item.note" class="sk-note">{{ item.note }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sk-back {
  position: fixed; inset: 0; z-index: 9700;
  display: grid; place-items: center; padding: 24px;
  background: rgba(2, 4, 8, 0.78); backdrop-filter: blur(6px);
}
.sk-panel {
  width: min(920px, 100%); max-height: 88vh; display: flex; flex-direction: column;
  background: var(--bg-1); border: 1px solid var(--line-2); border-radius: 16px;
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.55); overflow: hidden;
}
.sk-head {
  display: flex; align-items: center; gap: 10px; flex: none;
  padding: 14px 16px; border-bottom: 1px solid var(--line);
}
.sk-head .ic { color: var(--neon); }
.sk-title {
  font-family: var(--display-font); font-weight: 700; font-size: 15px; letter-spacing: 0.6px;
}
.sk-ro { font-size: 11.5px; color: var(--amber); }
.sk-spacer { flex: 1; }

.sk-groups {
  overflow: auto; padding: 16px;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 18px 26px;
  align-content: start;
}
.sk-group { min-width: 0; }
.sk-group-title {
  font-family: var(--mono); font-size: 10px; letter-spacing: 1.6px; text-transform: uppercase;
  color: var(--text-3); margin-bottom: 9px; font-weight: 600;
}
.sk-row {
  display: grid; grid-template-columns: minmax(0, 128px) 1fr; gap: 12px;
  align-items: baseline; padding: 5px 0;
}
.sk-keys { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
.sk-key {
  display: inline-grid; place-items: center; min-width: 20px; padding: 2px 6px;
  border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: 5px;
  background: var(--bg-2); color: var(--text);
  font-family: var(--mono); font-size: 11px; line-height: 1.5;
}
.sk-plain { font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.sk-what { font-size: 12.5px; color: var(--text); min-width: 0; }
.sk-note { display: block; font-size: 11px; color: var(--text-3); margin-top: 2px; }
</style>
