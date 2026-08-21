// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Recálculo das fórmulas de uma aba.
 *
 * A ordem importa: se B1 é =A1*2 e C1 é =B1+1, C1 só pode ser calculado depois
 * de B1. Por isso as fórmulas são ordenadas topologicamente pelas dependências.
 * Referência circular não trava nem estoura a pilha — as células envolvidas
 * ficam com #CYCLE!, como o Excel avisa em vez de calcular.
 */
import { cellKey, parseCellKey, type Cell, type CellValue } from './model';
import { evaluate, referencesOf, type SheetAccess, type Value } from './formula';

export interface RecalcResult {
  /** Valor calculado de cada célula com fórmula, por chave R{linha}C{coluna}. */
  values: Map<string, Value>;
  /** Células que participam de referência circular. */
  cycles: Set<string>;
}

/**
 * Calcula todas as fórmulas do mapa. `cells` não é modificado — quem chama
 * decide o que fazer com os valores (gravar no documento, só exibir…).
 */
export function recalc(cells: Map<string, Cell>, today: number, now?: number): RecalcResult {
  const formulas = new Map<string, string>();
  for (const [key, cell] of cells) if (cell?.f) formulas.set(key, cell.f);

  const values = new Map<string, Value>();
  const cycles = new Set<string>();
  if (!formulas.size) return { values, cycles };

  // Dependências entre células com fórmula (referência a célula sem fórmula é
  // constante e não entra na ordenação).
  const deps = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const [key, formula] of formulas) {
    const own = new Set<string>();
    const pos = parseCellKey(key)!;
    for (const ref of referencesOf(formula)) {
      const refKey = cellKey(ref.row, ref.col);
      if (refKey === key) { cycles.add(key); continue; }   // auto-referência
      if (!formulas.has(refKey)) continue;
      own.add(refKey);
      const back = dependents.get(refKey) ?? new Set<string>();
      back.add(key);
      dependents.set(refKey, back);
    }
    deps.set(key, own);
    void pos;
  }

  // Kahn: quem não depende de ninguém sai primeiro.
  const pending = new Map<string, number>();
  for (const [key, set] of deps) pending.set(key, set.size);
  const queue = [...pending.entries()].filter(([, n]) => n === 0).map(([k]) => k);
  const order: string[] = [];
  while (queue.length) {
    const key = queue.shift()!;
    order.push(key);
    for (const dependent of dependents.get(key) ?? []) {
      const left = (pending.get(dependent) ?? 0) - 1;
      pending.set(dependent, left);
      if (left === 0) queue.push(dependent);
    }
  }

  // Sobrou fórmula sem sair da fila = ciclo.
  for (const [key, left] of pending) if (left > 0) cycles.add(key);

  const access: SheetAccess = {
    today,
    ...(now === undefined ? {} : { now }),
    valueAt: (row, col) => {
      const key = cellKey(row, col);
      if (cycles.has(key)) return '#CYCLE!';
      if (values.has(key)) return values.get(key)!;
      const cell = cells.get(key);
      // Fórmula ainda não calculada (fora de ordem) devolve o valor em cache.
      return cell?.v ?? null;
    },
  };

  for (const key of order) {
    const pos = parseCellKey(key);
    if (!pos) continue;
    values.set(key, evaluate(formulas.get(key)!, access));
  }
  for (const key of cycles) values.set(key, '#CYCLE!');

  return { values, cycles };
}

/** Valor de exibição de uma célula: o recalculado quando existe. */
export const valueOf = (cell: Cell | undefined, computed: Map<string, Value> | undefined, key: string): Value => {
  const fresh = computed?.get(key);
  if (fresh !== undefined) return fresh;
  return (cell?.v ?? null) as CellValue;
};
