// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import {
  conditionalStyle, contextFrom, evalFormula, inRanges,
  parseConditionalFormatting, ruleMatches, todaySerial, type CfRule, type EvalContext,
} from './conditional';
import { cellKey, type Cell } from './model';
import type { CellStyle } from './styles';

/** Trecho real do "Controle de Conciliação Bancária". */
const SHEET_CF = `<worksheet><sheetData/><conditionalFormatting sqref="F2:F26 F28:F51"><cfRule type="cellIs" dxfId="9" priority="21" operator="greaterThan"><formula>0</formula></cfRule><cfRule type="cellIs" priority="22" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="M2:M51"><cfRule type="expression" dxfId="3" priority="5"><formula>M2&lt;=TODAY()-8</formula></cfRule><cfRule type="expression" dxfId="2" priority="6"><formula>AND(M2&gt;=TODAY()-7,M2&lt;=TODAY()-6)</formula></cfRule><cfRule type="expression" dxfId="1" priority="7"><formula>AND(M2&gt;=TODAY()-5,M2&lt;=TODAY())</formula></cfRule></conditionalFormatting></worksheet>`;

const TODAY = 46000;
const ctx = (cells: [string, Cell][] = []): EvalContext =>
  contextFrom(new Map<string, Cell>(cells), TODAY);

describe('parseConditionalFormatting', () => {
  const rules = parseConditionalFormatting(SHEET_CF);

  it('lê todas as regras dos blocos', () => {
    expect(rules).toHaveLength(5);
  });

  it('quebra o sqref em faixas', () => {
    expect(rules[0]!.ranges).toEqual(['F2:F26', 'F28:F51']);
  });

  it('lê tipo, operador, dxfId e prioridade', () => {
    expect(rules[0]!.type).toBe('cellIs');
    expect(rules[0]!.operator).toBe('greaterThan');
    expect(rules[0]!.dxfId).toBe(9);
    expect(rules[0]!.priority).toBe(21);
  });

  it('regra sem dxfId é lida sem formato, não descartada', () => {
    expect(rules[1]!.dxfId).toBeUndefined();
    expect(rules[1]!.priority).toBe(22);
  });

  it('desescapa a fórmula do XML', () => {
    expect(rules[2]!.formulas[0]).toBe('M2<=TODAY()-8');
    expect(rules[3]!.formulas[0]).toBe('AND(M2>=TODAY()-7,M2<=TODAY()-6)');
  });

  it('a âncora é a primeira célula da primeira faixa', () => {
    expect(rules[0]!.anchor).toEqual({ row: 1, col: 5 });
    expect(rules[2]!.anchor).toEqual({ row: 1, col: 12 });
  });
});

describe('inRanges', () => {
  it('cobre faixa múltipla e respeita o buraco', () => {
    const ranges = ['F2:F26', 'F28:F51'];
    expect(inRanges(ranges, 1, 5)).toBe(true);
    expect(inRanges(ranges, 25, 5)).toBe(true);
    expect(inRanges(ranges, 26, 5)).toBe(false);
    expect(inRanges(ranges, 27, 5)).toBe(true);
    expect(inRanges(ranges, 1, 6)).toBe(false);
  });

  it('aceita faixa de uma célula só', () => {
    expect(inRanges(['G27'], 26, 6)).toBe(true);
    expect(inRanges(['G27'], 27, 6)).toBe(false);
  });

  it('aceita faixa invertida', () => {
    expect(inRanges(['C5:A1'], 2, 1)).toBe(true);
  });
});

describe('evalFormula', () => {
  it('aritmética e comparação', () => {
    expect(evalFormula('1+2*3', 0, 0, ctx())).toBe(7);
    expect(evalFormula('(1+2)*3', 0, 0, ctx())).toBe(9);
    expect(evalFormula('2>1', 0, 0, ctx())).toBe(true);
    expect(evalFormula('2<>2', 0, 0, ctx())).toBe(false);
  });

  it('TODAY() e AND()', () => {
    expect(evalFormula('TODAY()', 0, 0, ctx())).toBe(TODAY);
    expect(evalFormula('AND(1>0,2>1)', 0, 0, ctx())).toBe(true);
    expect(evalFormula('AND(1>0,0>1)', 0, 0, ctx())).toBe(false);
    expect(evalFormula('OR(0>1,1>0)', 0, 0, ctx())).toBe(true);
    expect(evalFormula('NOT(1>0)', 0, 0, ctx())).toBe(false);
  });

  it('referência resolve o valor da célula', () => {
    const c = ctx([[cellKey(1, 12), { v: 45990 }]]);
    expect(evalFormula('M2', 0, 0, c)).toBe(45990);
  });

  it('desloca referência relativa pela distância da âncora', () => {
    const c = ctx([[cellKey(5, 12), { v: 123 }]]);
    expect(evalFormula('M2', 4, 0, c)).toBe(123);
  });

  it('$ fixa a coordenada', () => {
    const c = ctx([[cellKey(1, 12), { v: 7 }], [cellKey(5, 12), { v: 99 }]]);
    expect(evalFormula('M$2', 4, 0, c)).toBe(7);
  });

  it('texto entre aspas e concatenação', () => {
    expect(evalFormula('"a"&"b"', 0, 0, ctx())).toBe('ab');
  });

  it('fórmula fora do suportado devolve null em vez de lançar', () => {
    expect(evalFormula('VLOOKUP(A1,Outra!A:B,2,0)', 0, 0, ctx())).toBeNull();
    expect(evalFormula('SUMIFS(A:A,B:B,"x")', 0, 0, ctx())).toBeNull();
    expect(evalFormula('1+', 0, 0, ctx())).toBeNull();
  });
});

describe('ruleMatches — cellIs', () => {
  const rule: CfRule = {
    ranges: ['F2:F51'], type: 'cellIs', operator: 'greaterThan',
    formulas: ['0'], dxfId: 9, priority: 21, anchor: { row: 1, col: 5 },
  };

  it('casa com valor acima do limite', () => {
    expect(ruleMatches(rule, 1, 5, 10, ctx())).toBe(true);
    expect(ruleMatches(rule, 1, 5, 0, ctx())).toBe(false);
    expect(ruleMatches(rule, 1, 5, -3, ctx())).toBe(false);
  });

  it('célula vazia não casa', () => {
    expect(ruleMatches(rule, 1, 5, null, ctx())).toBe(false);
  });

  it('between usa as duas fórmulas', () => {
    const between: CfRule = { ...rule, operator: 'between', formulas: ['10', '20'] };
    expect(ruleMatches(between, 1, 5, 15, ctx())).toBe(true);
    expect(ruleMatches(between, 1, 5, 21, ctx())).toBe(false);
  });
});

describe('ruleMatches — expression com data (caso do arquivo real)', () => {
  const rules = parseConditionalFormatting(SHEET_CF);
  const atrasado = rules[2]!;   // M2<=TODAY()-8
  const semana = rules[3]!;     // AND(M2>=TODAY()-7, M2<=TODAY()-6)

  it('data antiga dispara a regra de atraso, na própria linha da âncora', () => {
    const c = ctx([[cellKey(1, 12), { v: TODAY - 20 }]]);
    expect(ruleMatches(atrasado, 1, 12, TODAY - 20, c)).toBe(true);
  });

  it('a regra vale nas outras linhas por referência relativa', () => {
    const c = ctx([[cellKey(30, 12), { v: TODAY - 9 }]]);
    expect(ruleMatches(atrasado, 30, 12, TODAY - 9, c)).toBe(true);
  });

  it('data de hoje não dispara atraso', () => {
    const c = ctx([[cellKey(10, 12), { v: TODAY }]]);
    expect(ruleMatches(atrasado, 10, 12, TODAY, c)).toBe(false);
  });

  it('faixa intermediária cai na regra do meio', () => {
    const c = ctx([[cellKey(4, 12), { v: TODAY - 7 }]]);
    expect(ruleMatches(semana, 4, 12, TODAY - 7, c)).toBe(true);
    expect(ruleMatches(atrasado, 4, 12, TODAY - 7, c)).toBe(false);
  });
});

describe('conditionalStyle', () => {
  const dxfs: CellStyle[] = Array.from({ length: 10 }, (_, i) => ({ bg: `00000${i}` }));
  const rules = parseConditionalFormatting(SHEET_CF);

  it('devolve o dxf da regra que casa', () => {
    const cells = new Map<string, Cell>([[cellKey(1, 5), { v: 5 }]]);
    const style = conditionalStyle(rules, dxfs, 1, 5, 5, contextFrom(cells, TODAY));
    expect(style).toEqual({ bg: '000009' });
  });

  it('fora das faixas não pinta nada', () => {
    expect(conditionalStyle(rules, dxfs, 1, 0, 5, ctx())).toBeNull();
  });

  it('valor que não satisfaz nenhuma regra não pinta', () => {
    expect(conditionalStyle(rules, dxfs, 1, 5, -1, ctx())).toBeNull();
  });

  it('vence a regra de menor prioridade entre as que casam', () => {
    const cells = new Map<string, Cell>([[cellKey(1, 12), { v: TODAY - 30 }]]);
    const style = conditionalStyle(rules, dxfs, 1, 12, TODAY - 30, contextFrom(cells, TODAY));
    // prioridade 5 (dxf 3) vence a 6 e a 7
    expect(style).toEqual({ bg: '000003' });
  });

  it('regra sem dxfId não pinta, mas não impede as outras', () => {
    const semFormato: CfRule[] = [
      { ranges: ['A1'], type: 'cellIs', operator: 'greaterThan', formulas: ['0'], priority: 1, anchor: { row: 0, col: 0 } },
      { ranges: ['A1'], type: 'cellIs', operator: 'greaterThan', formulas: ['0'], dxfId: 2, priority: 2, anchor: { row: 0, col: 0 } },
    ];
    expect(conditionalStyle(semFormato, dxfs, 0, 0, 1, ctx())).toEqual({ bg: '000002' });
  });

  it('stopIfTrue em regra sem formato interrompe a avaliação', () => {
    const paraAqui: CfRule[] = [
      { ranges: ['A1'], type: 'cellIs', operator: 'greaterThan', formulas: ['0'], priority: 1, stopIfTrue: true, anchor: { row: 0, col: 0 } },
      { ranges: ['A1'], type: 'cellIs', operator: 'greaterThan', formulas: ['0'], dxfId: 2, priority: 2, anchor: { row: 0, col: 0 } },
    ];
    expect(conditionalStyle(paraAqui, dxfs, 0, 0, 1, ctx())).toBeNull();
  });

  it('tipo não suportado é ignorado sem quebrar', () => {
    const barras: CfRule[] = [
      { ranges: ['A1'], type: 'unsupported', formulas: [], dxfId: 1, priority: 1, anchor: { row: 0, col: 0 } },
    ];
    expect(conditionalStyle(barras, dxfs, 0, 0, 1, ctx())).toBeNull();
  });
});

describe('todaySerial', () => {
  it('converte a data local para serial do Excel', () => {
    expect(todaySerial(new Date(2023, 2, 15, 13, 45))).toBe(45000);
  });

  it('ignora a hora', () => {
    expect(todaySerial(new Date(2023, 2, 15, 0, 0))).toBe(todaySerial(new Date(2023, 2, 15, 23, 59)));
  });
});
