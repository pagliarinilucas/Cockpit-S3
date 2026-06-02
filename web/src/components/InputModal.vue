<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Modal from './Modal.vue';
import Icon from './Icon.vue';

withDefaults(defineProps<{
  title: string; icon?: string; placeholder?: string; hint?: string; confirmLabel?: string;
}>(), { placeholder: '', hint: '', confirmLabel: 'Confirmar' });

const emit = defineEmits<{ confirm: [value: string]; close: [] }>();
const value = ref('');
const box = ref<HTMLInputElement | null>(null);
onMounted(() => box.value?.focus());
</script>

<template>
  <Modal :title="title" :icon="icon" @close="emit('close')">
    <input ref="box" class="modal-input" v-model="value" :placeholder="placeholder"
           @keydown.enter="emit('confirm', value)" />
    <p v-if="hint" class="modal-hint">{{ hint }}</p>
    <template #foot>
      <button class="btn" @click="emit('close')">Cancelar</button>
      <button class="btn btn-primary" @click="emit('confirm', value)"><Icon name="check" :size="16" />{{ confirmLabel }}</button>
    </template>
  </Modal>
</template>
