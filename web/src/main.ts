import { createApp } from 'vue';
import './styles.css';
import App from './App.vue';
import { initTheme } from './core/theme';

initTheme();
createApp(App).mount('#app');
