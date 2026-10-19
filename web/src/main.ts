// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { createApp } from 'vue';
import './styles.css';
import App from './App.vue';
import { initTheme } from './core/theme';
import { initLocale } from './i18n';

initTheme();
initLocale();
createApp(App).mount('#app');
