<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { useToast } from '../core/toast';
import Icon from './Icon.vue';
const { toasts } = useToast();
</script>

<template>
  <div class="toast-wrap">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="'toast-' + toast.kind">
      <Icon :name="toast.kind === 'error' ? 'x' : toast.kind === 'success' ? 'check' : 'activity'" :size="15" />
      <span>{{ toast.msg }}</span>
    </div>
  </div>
</template>
