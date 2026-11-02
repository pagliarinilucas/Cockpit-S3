<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { computed, inject } from 'vue';
import type { LicenseFeature } from '../core/models';
import { useEdition, PRICING_URL, OPEN_LICENSE_KEY } from '../core/edition';
import Icon from './Icon.vue';
import { t } from '../i18n';

const props = defineProps<{ feature: LicenseFeature; title: string; pitch: string }>();
const { has } = useEdition();
const openLicense = inject<(() => void) | null>(OPEN_LICENSE_KEY, null);
const unlocked = computed(() => has(props.feature));
const tier = computed(() => (props.feature === 'white-label' ? 'Enterprise' : 'Pro'));
const benefits = computed(() => (['b1', 'b2', 'b3'] as const).map((b) => t(`settingsLayout.locked.${props.feature}.${b}`)));
</script>

<template>
  <slot v-if="unlocked"></slot>
  <div v-else class="gate">
    <div class="gate-stripe" aria-hidden="true"></div>
    <div class="gate-body">
      <div class="gate-main">
        <div class="gate-badge"><Icon name="lock" :size="13" />{{ t('settingsLayout.locked.badge', { tier }) }}</div>
        <h3 class="gate-title">{{ title }}</h3>
        <p class="gate-pitch">{{ pitch }}</p>
        <div class="gate-actions">
          <button v-if="openLicense" class="btn btn-primary" @click="openLicense()">
            <Icon name="key" :size="15" />{{ t('settingsLayout.locked.activate') }}
          </button>
          <a class="btn" :href="PRICING_URL" target="_blank" rel="noopener">
            <Icon name="share" :size="15" />{{ openLicense ? t('settingsLayout.locked.plans') : t('ui.proGate.upgrade', { tier }) }}
          </a>
        </div>
      </div>
      <div class="gate-list">
        <div class="gate-list-head">{{ t('settingsLayout.locked.included', { tier }) }}</div>
        <ul>
          <li v-for="(benefit, i) in benefits" :key="i"><Icon name="check" :size="14" />{{ benefit }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gate {
  position: relative; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--amber) 32%, var(--line-2)); border-radius: 14px;
  background:
    radial-gradient(420px 180px at 100% 0%, color-mix(in srgb, var(--amber) 9%, transparent), transparent 70%),
    var(--bg-1);
}
.gate-stripe {
  height: 6px;
  background: repeating-linear-gradient(-45deg, var(--amber) 0 10px, transparent 10px 20px);
  opacity: .55;
}
.gate-body {
  display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 28px;
  padding: 22px 24px 24px;
}
.gate-badge {
  display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 999px;
  font-family: var(--mono); font-size: 10.5px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
  color: var(--amber); border: 1px solid color-mix(in srgb, var(--amber) 45%, transparent);
  background: color-mix(in srgb, var(--amber) 8%, transparent);
}
.gate-title { margin: 14px 0 0; font-family: var(--display-font); font-weight: 700; font-size: 20px; letter-spacing: .3px; color: var(--text); }
.gate-pitch { margin: 8px 0 0; font-size: 13.5px; line-height: 1.55; color: var(--text-2); max-width: 46ch; }
.gate-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
.gate-actions .btn { text-decoration: none; }
.gate-list {
  align-self: start; padding: 16px 18px; border-radius: 11px;
  border: 1px solid var(--line); background: var(--bg-0);
}
.gate-list-head {
  font-family: var(--mono); font-size: 9.5px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--text-3);
}
.gate-list ul { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.gate-list li { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; line-height: 1.45; color: var(--text); }
.gate-list li .ic { flex: none; margin-top: 2px; color: var(--amber); }
@media (max-width: 760px) { .gate-body { grid-template-columns: 1fr; gap: 18px; } }
</style>
