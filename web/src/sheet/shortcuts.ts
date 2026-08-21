// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
export interface Shortcut {
  keys: string[];
  what: string;
  note?: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const NAVIGATION: ShortcutGroup = {
  title: 'Andar pela planilha',
  items: [
    { keys: ['↑', '↓', '←', '→'], what: 'Move uma célula' },
    { keys: ['Ctrl', '+', 'setas'], what: 'Pula 10 células', note: 'no Excel isso vai até a borda dos dados; aqui é um salto fixo' },
    { keys: ['Tab'], what: 'Vai para a direita' },
    { keys: ['Shift', '+', 'Tab'], what: 'Vai para a esquerda' },
    { keys: ['Home'], what: 'Primeira coluna da linha' },
  ],
};

export const SELECTION: ShortcutGroup = {
  title: 'Selecionar',
  items: [
    { keys: ['Shift', '+', 'setas'], what: 'Estende a seleção' },
    { keys: ['clique', '+', 'arrastar'], what: 'Seleciona uma faixa' },
    { keys: ['clique no cabeçalho'], what: 'Linha ou coluna inteira' },
    { keys: ['Ctrl', '+', 'clique'], what: 'Junta faixas separadas', note: 'guarda a seleção anterior e começa outra' },
    { keys: ['Ctrl', '+', 'A'], what: 'Tudo o que tem conteúdo' },
  ],
};

export const EDITING: ShortcutGroup = {
  title: 'Editar',
  items: [
    { keys: ['Enter'], what: 'Abre a célula' },
    { keys: ['F2'], what: 'Abre a célula' },
    { keys: ['duplo clique'], what: 'Abre a célula' },
    { keys: ['digitar'], what: 'Escreve por cima do que estava lá' },
    { keys: ['='], what: 'Começa uma fórmula', note: 'SOMA, SE, SOMASE, CONT.SE, ÍNDICE e outras 40' },
    { keys: ['Delete', 'ou', 'Backspace'], what: 'Limpa o conteúdo da seleção', note: 'o formato da célula fica' },
    { keys: ['Ctrl', '+', 'C'], what: 'Copia a faixa ativa' },
    { keys: ['Ctrl', '+', 'V'], what: 'Cola', note: 'bloco de várias linhas e colunas de uma vez' },
  ],
};

export const WHILE_EDITING: ShortcutGroup = {
  title: 'Com a célula aberta',
  items: [
    { keys: ['Enter'], what: 'Confirma e desce' },
    { keys: ['Tab'], what: 'Confirma e vai para a direita' },
    { keys: ['Esc'], what: 'Cancela e mantém o valor antigo' },
  ],
};

export const SIZING: ShortcutGroup = {
  title: 'Largura e altura',
  items: [
    { keys: ['arrastar a alça'], what: 'Muda a largura da coluna ou a altura da linha', note: 'a alça fica na borda do cabeçalho' },
    { keys: ['duplo clique na alça'], what: 'Ajusta ao conteúdo' },
  ],
};

export const PANEL: ShortcutGroup = {
  title: 'Esta lista',
  items: [
    { keys: ['Ctrl', '+', '/'], what: 'Abre e fecha os atalhos' },
    { keys: ['F1'], what: 'Abre e fecha os atalhos' },
    { keys: ['Esc'], what: 'Fecha' },
  ],
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  NAVIGATION, SELECTION, EDITING, WHILE_EDITING, SIZING, PANEL,
];

export const isShortcutPanelKey = (ev: KeyboardEvent): boolean =>
  ev.key === 'F1' || ((ev.ctrlKey || ev.metaKey) && ev.key === '/');
