<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { useBranding } from '../core/branding';

const { showPoweredBy } = useBranding();
</script>

<template>
  <a v-if="showPoweredBy" class="powered-by" href="https://github.com/pagliarinilucas/Cockpit-S3" target="_blank" rel="noopener">
    Powered by Cockpit S3
  </a>
</template>

<style scoped>
.powered-by {
  display: block; text-align: center; margin-top: 18px;
  font-family: var(--mono); font-size: 10.5px; letter-spacing: 1px;
  color: var(--text-3); text-decoration: none; opacity: .75;
}
.powered-by:hover { opacity: 1; color: var(--neon); }
</style>
