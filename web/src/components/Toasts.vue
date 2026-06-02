<script setup lang="ts">
import { useToast } from '../core/toast';
import Icon from './Icon.vue';
const { toasts } = useToast();
</script>

<template>
  <div class="toast-wrap">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="'toast-' + t.kind">
      <Icon :name="t.kind === 'error' ? 'x' : t.kind === 'success' ? 'check' : 'activity'" :size="15" />
      <span>{{ t.msg }}</span>
    </div>
  </div>
</template>
