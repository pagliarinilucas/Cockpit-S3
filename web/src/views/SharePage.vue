<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { SharePublicMeta } from '../core/models';
import { api, ApiError, sharePreviewUrl, shareDownloadUrl } from '../core/api';
import { fmtBytes, typeFromName } from '../core/util';
import Icon from '../components/Icon.vue';

const props = defineProps<{ token: string }>();

const meta = ref<SharePublicMeta | null>(null);
const loading = ref(true);
const errStatus = ref<number | null>(null);
const textBody = ref<string | null>(null);

const previewUrl = computed(() => sharePreviewUrl(props.token));
const downloadUrl = computed(() => shareDownloadUrl(props.token));

/** Which inline preview to render, derived from the extension + previewable flag. */
const kind = computed<'image' | 'pdf' | 'text' | 'none'>(() => {
  const m = meta.value;
  if (!m || !m.previewable) return 'none';
  const t = typeFromName('f.' + (m.ext || '').replace(/^\./, ''));
  if (t === 'image') return 'image';
  if (t === 'pdf') return 'pdf';
  if (t === 'text' || t === 'code') return 'text';
  return 'none';
});

const errMsg = computed(() => {
  switch (errStatus.value) {
    case 410: return { title: 'Link expirado', sub: 'Este link expirou ou foi revogado pelo autor.' };
    case 404: return { title: 'Link não encontrado', sub: 'Este link não existe ou já foi removido.' };
    case 403: return { title: 'Acesso bloqueado', sub: 'Este link está travado a outro dispositivo/IP e não pode ser aberto aqui.' };
    case 0:   return { title: 'Sem conexão', sub: 'Não foi possível contactar o servidor. Tente novamente.' };
    default:  return { title: 'Não foi possível abrir', sub: 'Ocorreu um erro ao abrir este link.' };
  }
});

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR');
}

async function load() {
  loading.value = true; errStatus.value = null; textBody.value = null;
  try {
    meta.value = await api.shareMeta(props.token);
    if (kind.value === 'text') {
      try {
        const res = await fetch(previewUrl.value);
        textBody.value = res.ok ? await res.text() : null;
      } catch { textBody.value = null; }
    }
  } catch (e) {
    errStatus.value = e instanceof ApiError ? e.status : -1;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div class="sp-wrap">
    <div class="sp-grid"></div>

    <div class="sp-topbar">
      <div class="sp-brand">
        <div class="brand-mark"><Icon name="gauge" :size="20" /></div>
        <div>
          <div class="sp-brand-name">COCKPIT S3</div>
          <div class="sp-brand-sub">ARQUIVO COMPARTILHADO</div>
        </div>
      </div>
    </div>

    <div class="sp-body">
      <div v-if="loading" class="loading" style="min-height:200px"><div class="spinner"></div>ABRINDO LINK…</div>

      <div v-else-if="errStatus !== null" class="sp-card sp-err">
        <div class="sp-err-ic"><Icon name="alert" :size="34" /></div>
        <div class="sp-err-title">{{ errMsg.title }}</div>
        <div class="sp-err-sub">{{ errMsg.sub }}</div>
      </div>

      <div v-else-if="meta" class="sp-card">
        <div class="sp-file">
          <div class="sp-file-ic"><Icon name="file" :size="24" /></div>
          <div class="sp-file-txt">
            <div class="sp-file-name" :title="meta.filename">{{ meta.filename }}</div>
            <div class="sp-file-meta">
              <span v-if="meta.size != null">{{ fmtBytes(meta.size) }}</span>
              <span v-if="meta.size != null && meta.ext" class="dot-sep">·</span>
              <span v-if="meta.ext">{{ meta.ext.replace(/^\./, '').toUpperCase() }}</span>
            </div>
          </div>
          <a class="btn btn-primary" :href="downloadUrl" :download="meta.filename"><Icon name="download" :size="16" />Baixar</a>
        </div>

        <div class="sp-preview">
          <img v-if="kind === 'image'" :src="previewUrl" :alt="meta.filename" />
          <iframe v-else-if="kind === 'pdf'" :src="previewUrl" title="preview"></iframe>
          <pre v-else-if="kind === 'text' && textBody != null" class="sp-text">{{ textBody }}</pre>
          <div v-else class="sp-noprev">
            <Icon name="file" :size="40" />
            <div class="sp-noprev-name">Sem prévia para este arquivo</div>
            <a class="btn" :href="downloadUrl" :download="meta.filename"><Icon name="download" :size="16" />Baixar arquivo</a>
          </div>
        </div>

        <div class="sp-foot">
          <span><Icon name="clock" :size="13" /> Expira em {{ fmtDate(meta.expiresAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sp-wrap { position: relative; min-height: 100vh; background: var(--bg-0); color: var(--text); display: flex; flex-direction: column; overflow: hidden; }
.sp-grid { position: absolute; inset: 0; background-image: linear-gradient(color-mix(in srgb, var(--neon) 6%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--neon) 6%, transparent) 1px, transparent 1px); background-size: 40px 40px; opacity: .4; pointer-events: none; }
.sp-topbar { position: relative; padding: 20px 24px; border-bottom: 1px solid var(--line-2); }
.sp-brand { display: flex; align-items: center; gap: 12px; }
.sp-brand-name { font-family: var(--display-font); font-weight: 800; font-size: 16px; letter-spacing: 1px; }
.sp-brand-sub { font-family: var(--mono); font-size: 10.5px; color: var(--text-3); letter-spacing: 1.5px; }
.sp-body { position: relative; flex: 1; display: flex; justify-content: center; align-items: flex-start; padding: 40px 20px; }
.sp-card { width: 100%; max-width: 900px; background: var(--bg-1); border: 1px solid var(--line-2); border-radius: 16px; overflow: hidden; }
.sp-file { display: flex; align-items: center; gap: 14px; padding: 18px 20px; border-bottom: 1px solid var(--line); }
.sp-file-ic { width: 46px; height: 46px; flex: none; display: grid; place-items: center; border-radius: 12px; background: color-mix(in srgb, var(--neon) 12%, transparent); color: var(--neon); }
.sp-file-txt { flex: 1; min-width: 0; }
.sp-file-name { font-family: var(--display-font); font-weight: 600; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-file-meta { font-family: var(--mono); font-size: 12px; color: var(--text-3); margin-top: 3px; }
.sp-preview { display: flex; justify-content: center; align-items: center; padding: 16px; min-height: 320px; max-height: 70vh; background: var(--bg-0); }
.sp-preview img { max-width: 100%; max-height: 66vh; object-fit: contain; border-radius: 8px; }
.sp-preview iframe { width: 100%; height: 66vh; border: none; border-radius: 8px; background: #fff; }
.sp-text { width: 100%; max-height: 66vh; overflow: auto; margin: 0; padding: 14px; font-family: var(--mono); font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; color: var(--text-2); }
.sp-noprev { display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--text-3); text-align: center; }
.sp-noprev-name { font-size: 14px; }
.sp-foot { padding: 14px 20px; border-top: 1px solid var(--line); font-family: var(--mono); font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 6px; }
.sp-err { padding: 48px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.sp-err-ic { color: var(--amber); }
.sp-err-title { font-family: var(--display-font); font-weight: 700; font-size: 18px; }
.sp-err-sub { color: var(--text-3); font-size: 14px; max-width: 420px; }
</style>
