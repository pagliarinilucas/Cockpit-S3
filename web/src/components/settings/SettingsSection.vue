<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
defineProps<{ group: string; title: string; desc: string }>();
</script>

<template>
  <section class="cfg-section">
    <header class="cfg-section-head">
      <div class="cfg-section-text">
        <div class="cfg-section-group">// {{ group }}</div>
        <h2 class="cfg-section-title">{{ title }}</h2>
        <p class="cfg-section-desc">{{ desc }}</p>
      </div>
      <div v-if="$slots.actions" class="cfg-section-actions"><slot name="actions"></slot></div>
    </header>
    <div class="cfg-section-body"><slot></slot></div>
  </section>
</template>

<style scoped>
.cfg-section { animation: cfg-in .32s cubic-bezier(.2, .7, .2, 1) both; }
.cfg-section-head {
  display: grid; grid-template-columns: 1fr auto; gap: 4px 18px; align-items: end;
  padding-bottom: 18px; margin-bottom: 20px; border-bottom: 1px solid var(--line);
}
.cfg-section-group {
  font-family: var(--mono); font-size: 10.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--neon);
}
.cfg-section-title {
  margin: 6px 0 0; font-family: var(--display-font); font-weight: 700; font-size: 24px; letter-spacing: .4px; line-height: 1.1;
  color: var(--text);
}
.cfg-section-desc { margin: 8px 0 0; max-width: 64ch; font-size: 13.5px; line-height: 1.55; color: var(--text-2); }
.cfg-section-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
@media (max-width: 720px) {
  .cfg-section-head { grid-template-columns: 1fr; }
  .cfg-section-actions { justify-content: flex-start; }
}
@keyframes cfg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .cfg-section { animation: none; } }
</style>
