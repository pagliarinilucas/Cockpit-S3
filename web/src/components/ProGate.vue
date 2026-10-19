<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { LicenseFeature } from '../core/models';
import { useEdition, PRICING_URL } from '../core/edition';
import Icon from './Icon.vue';
import { t } from '../i18n';

const props = defineProps<{ feature: LicenseFeature; title: string; pitch: string }>();
const { has } = useEdition();
const unlocked = computed(() => has(props.feature));
const tier = computed(() => (props.feature === 'white-label' ? 'Enterprise' : 'Pro'));
</script>

<template>
  <slot v-if="unlocked"></slot>
  <div v-else class="pro-gate">
    <div class="pro-gate-ic"><Icon name="lock" :size="18" /></div>
    <div class="pro-gate-main">
      <div class="pro-gate-title">{{ title }} <span class="pro-gate-tag">{{ tier }}</span></div>
      <div class="pro-gate-desc">{{ pitch }}</div>
    </div>
    <a class="btn btn-primary" :href="PRICING_URL" target="_blank" rel="noopener">
      <Icon name="key" :size="15" />{{ t('ui.proGate.upgrade', { tier }) }}
    </a>
  </div>
</template>

<style scoped>
.pro-gate {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 14px 16px; margin-bottom: 18px;
  border: 1px dashed color-mix(in srgb, var(--amber, #ffb02e) 45%, transparent); border-radius: 12px;
  background: color-mix(in srgb, var(--amber, #ffb02e) 5%, transparent);
}
.pro-gate-ic {
  flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center;
  color: var(--amber, #ffb02e); background: color-mix(in srgb, var(--amber, #ffb02e) 14%, transparent);
}
.pro-gate-main { flex: 1; min-width: 200px; }
.pro-gate-title { font-weight: 600; margin-bottom: 3px; display: flex; align-items: center; gap: 8px; }
.pro-gate-tag {
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
  padding: 2px 7px; border-radius: 999px; border: 1px solid currentColor; color: var(--amber, #ffb02e);
}
.pro-gate-desc { font-size: 12.5px; line-height: 1.5; color: var(--text-3, #9aa4b2); }
.btn { text-decoration: none; }
</style>
