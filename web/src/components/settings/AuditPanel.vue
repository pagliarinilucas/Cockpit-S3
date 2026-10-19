<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 Lucas Pagliarini
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { AuditSettings, AuditSettingsInput, AuditForwardResult, SyslogProtocol } from '../../core/models';
import { api, apiErrMsg, ApiError } from '../../core/api';
import { useToast } from '../../core/toast';
import Icon from '../Icon.vue';
import Modal from '../Modal.vue';
import ProGate from '../ProGate.vue';
import { t } from '../../i18n';

const toast = useToast();
const settings = ref<AuditSettings | null>(null);
const editing = ref(false);
const saving = ref(false);
const testing = ref(false);
const formError = ref<string | null>(null);

const retentionDays = ref(0);
const webhookUrl = ref('');
const webhookSecret = ref('');
const webhookBearer = ref('');
const clearSecret = ref(false);
const clearBearer = ref(false);
const syslogHost = ref('');
const syslogPort = ref(514);
const syslogProtocol = ref<SyslogProtocol>('udp');

const retentionLabel = computed(() => {
  const days = settings.value?.retentionDays ?? 0;
  return days ? t('settings.audit.retention', { count: days }) : t('settings.audit.keptForever');
});

const targetsLabel = computed(() => {
  const s = settings.value;
  if (!s) return '';
  const targets: string[] = [];
  if (s.webhookUrl) targets.push(`webhook ${new URL(s.webhookUrl).host}`);
  if (s.syslogHost) targets.push(`syslog ${s.syslogProtocol.toUpperCase()} ${s.syslogHost}:${s.syslogPort}`);
  return targets.length ? t('settings.audit.forwardingTo', { targets: targets.join(t('settings.audit.and')) }) : t('settings.audit.noForwarding');
});

const hasTargets = computed(() => !!(settings.value?.webhookUrl || settings.value?.syslogHost));

async function load() {
  try { settings.value = await api.auditSettings(); } catch { settings.value = null; }
}
onMounted(load);

function openEdit() {
  const s = settings.value;
  retentionDays.value = s?.retentionDays ?? 0;
  webhookUrl.value = s?.webhookUrl ?? '';
  webhookSecret.value = '';
  webhookBearer.value = '';
  clearSecret.value = false;
  clearBearer.value = false;
  syslogHost.value = s?.syslogHost ?? '';
  syslogPort.value = s?.syslogPort ?? 514;
  syslogProtocol.value = s?.syslogProtocol ?? 'udp';
  formError.value = null;
  editing.value = true;
}

function secretPatch(value: string, clear: boolean): string | undefined {
  if (clear) return '';
  return value ? value : undefined;
}

async function save() {
  saving.value = true; formError.value = null;
  const body: AuditSettingsInput = {
    retentionDays: Math.max(0, Math.floor(Number(retentionDays.value) || 0)),
    webhookUrl: webhookUrl.value.trim(),
    webhookSecret: secretPatch(webhookSecret.value, clearSecret.value),
    webhookBearer: secretPatch(webhookBearer.value, clearBearer.value),
    syslogHost: syslogHost.value.trim(),
    syslogPort: Math.floor(Number(syslogPort.value) || 514),
    syslogProtocol: syslogProtocol.value,
  };
  try {
    settings.value = await api.saveAuditSettings(body);
    editing.value = false;
    toast.success(t('settings.audit.saved'));
  } catch (e) {
    formError.value = e instanceof ApiError && e.status === 400
      ? t('settings.audit.invalid')
      : apiErrMsg(e, 'save');
  } finally { saving.value = false; }
}

function describe(name: string, result: AuditForwardResult | null): string | null {
  if (!result) return null;
  if (result.ok) return `${name}: ok`;
  return `${name}: ${result.error ?? t('settings.audit.failed')}`;
}

async function testForward() {
  testing.value = true;
  try {
    const result = await api.testAuditForward();
    const parts = [describe('Webhook', result.webhook), describe('Syslog', result.syslog)].filter(Boolean);
    const allOk = [result.webhook, result.syslog].every((r) => !r || r.ok);
    if (allOk) toast.success(t('settings.audit.testSent', { details: parts.join(' · ') }));
    else toast.error(t('settings.audit.testFailed', { details: parts.join(' · ') }));
  } catch (e) { toast.error(apiErrMsg(e, 'testSend')); }
  finally { testing.value = false; }
}
</script>

<template>
  <ProGate feature="audit-export" :title="t('settings.audit.gateTitle')"
           :pitch="t('settings.audit.pitch')">
    <div class="aud-card">
      <div class="aud-ic"><Icon name="activity" :size="20" /></div>
      <div class="aud-main">
        <div class="aud-title">{{ t('settings.audit.title') }}</div>
        <div class="aud-desc">{{ retentionLabel }}</div>
        <div class="aud-desc">{{ targetsLabel }}</div>
        <div v-if="settings && settings.forward.dropped" class="aud-desc aud-warn">
          {{ t('settings.audit.dropped', { count: settings.forward.dropped }) }}
        </div>
      </div>
      <div class="aud-acts">
        <button v-if="hasTargets" class="btn" :disabled="testing" @click="testForward">
          <Icon name="share" :size="15" />{{ testing ? t('settings.audit.sending') : t('settings.audit.testSend') }}
        </button>
        <button class="btn btn-primary" @click="openEdit"><Icon name="edit" :size="15" />{{ t('settings.configure') }}</button>
      </div>
    </div>

    <Modal v-if="editing" :title="t('settings.audit.title')" icon="activity" wide @close="editing = false">
      <div class="field">
        <label class="field-label" for="aud-retention">{{ t('settings.audit.retentionLabel') }}</label>
        <input id="aud-retention" v-model.number="retentionDays" class="field-input" type="number" min="0" max="36500" />
        <div class="aud-hint">{{ t('settings.audit.retentionHint') }}</div>
      </div>

      <div class="aud-section">Webhook</div>
      <div class="field">
        <label class="field-label" for="aud-webhook">URL</label>
        <input id="aud-webhook" v-model="webhookUrl" class="field-input" :placeholder="t('settings.audit.webhookPlaceholder')" spellcheck="false" />
      </div>
      <div class="aud-row">
        <div class="field">
          <label class="field-label" for="aud-secret">{{ t('settings.audit.hmacSecret') }}</label>
          <input id="aud-secret" v-model="webhookSecret" class="field-input" type="password" autocomplete="new-password"
                 :placeholder="settings?.webhookSecretSet ? t('settings.audit.kept') : t('settings.audit.optional')" :disabled="clearSecret" />
          <label v-if="settings?.webhookSecretSet" class="aud-check"><input v-model="clearSecret" type="checkbox" /> {{ t('settings.audit.removeSecret') }}</label>
        </div>
        <div class="field">
          <label class="field-label" for="aud-bearer">{{ t('settings.audit.bearerToken') }}</label>
          <input id="aud-bearer" v-model="webhookBearer" class="field-input" type="password" autocomplete="new-password"
                 :placeholder="settings?.webhookBearerSet ? t('settings.audit.kept') : t('settings.audit.optional')" :disabled="clearBearer" />
          <label v-if="settings?.webhookBearerSet" class="aud-check"><input v-model="clearBearer" type="checkbox" /> {{ t('settings.audit.removeToken') }}</label>
        </div>
      </div>
      <div class="aud-hint" v-html="t('settings.audit.signatureHint')"></div>

      <div class="aud-section">Syslog (RFC 5424)</div>
      <div class="aud-row">
        <div class="field aud-grow">
          <label class="field-label" for="aud-syslog-host">Host</label>
          <input id="aud-syslog-host" v-model="syslogHost" class="field-input" :placeholder="t('settings.audit.syslogHostPlaceholder')" spellcheck="false" />
        </div>
        <div class="field">
          <label class="field-label" for="aud-syslog-port">{{ t('settings.audit.port') }}</label>
          <input id="aud-syslog-port" v-model.number="syslogPort" class="field-input" type="number" min="1" max="65535" />
        </div>
        <div class="field">
          <label class="field-label" for="aud-syslog-proto">{{ t('settings.audit.protocol') }}</label>
          <select id="aud-syslog-proto" v-model="syslogProtocol" class="field-input">
            <option value="udp">UDP</option>
            <option value="tcp">TCP</option>
          </select>
        </div>
      </div>
      <div class="aud-hint">{{ t('settings.audit.disableHint') }}</div>

      <div v-if="formError" class="aud-error">{{ formError }}</div>
      <template #foot>
        <button class="btn" @click="editing = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? t('settings.saving') : t('common.save') }}</button>
      </template>
    </Modal>
  </ProGate>
</template>

<style scoped>
.aud-card {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 14px 16px; margin-bottom: 18px;
  border: 1px solid var(--line-2, rgba(255,255,255,.1)); border-radius: 12px;
  background: var(--bg-0, rgba(255,255,255,.02));
}
.aud-ic {
  flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center;
  color: var(--neon, #2dd4ff); background: color-mix(in srgb, var(--neon, #2dd4ff) 14%, transparent);
}
.aud-main { flex: 1; min-width: 220px; }
.aud-title { font-weight: 600; margin-bottom: 3px; }
.aud-desc { font-size: 12.5px; line-height: 1.5; color: var(--text-3, #9aa4b2); }
.aud-warn { color: var(--amber); }
.aud-acts { display: flex; gap: 8px; flex-wrap: wrap; flex: none; }
.aud-section { margin: 16px 0 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-2); }
.aud-row { display: flex; gap: 12px; flex-wrap: wrap; }
.aud-row .field { flex: 1; min-width: 140px; }
.aud-grow { flex: 2 !important; }
.aud-hint { font-size: 12px; color: var(--text-3); margin-top: -4px; margin-bottom: 8px; }
.aud-hint code { font-family: var(--mono); font-size: 11.5px; }
.aud-check { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; color: var(--text-3); }
.aud-error { color: var(--danger); font-size: 13px; }
</style>
