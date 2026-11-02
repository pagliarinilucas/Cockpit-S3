<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { LOCALES, locale, setLocale, t } from '../i18n';
</script>

<template>
  <div class="locale-switch" role="group" :aria-label="t('ui.locale.label')" :title="t('ui.locale.label')">
    <button v-for="option in LOCALES" :key="option.id" type="button" class="locale-opt"
            :class="{ on: locale === option.id }" :aria-pressed="locale === option.id" :lang="option.tag"
            :title="option.label" @click="setLocale(option.id)">
      {{ option.short }}
    </button>
  </div>
</template>

<style scoped>
.locale-switch {
  display: inline-flex; flex: none; border: 1px solid var(--line-2); border-radius: 7px; overflow: hidden;
  background: rgba(0, 0, 0, .22);
}
.locale-opt {
  border: 0; background: transparent; cursor: pointer; padding: 3px 7px;
  font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 1px; color: var(--text-3);
  transition: background .15s, color .15s;
}
.locale-opt + .locale-opt { border-left: 1px solid var(--line-2); }
.locale-opt:hover:not(.on) { color: var(--text); }
.locale-opt.on { background: color-mix(in srgb, var(--neon) 16%, transparent); color: var(--neon); }
</style>
