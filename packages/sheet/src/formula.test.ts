// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
import { describe, expect, it } from 'bun:test';
import { dateToSerial, evaluate, isError, matchesCriterion, referencesOf, type SheetAccess } from './formula';
import { cellKey, type CellValue } from './model';

const TODAY = 46000;

/** Contexto a partir de um mapa "A1" -> valor. */
function ctx(cells: Record<string, CellValue> = {}): SheetAccess {
  const byKey = new Map<string, CellValue>();
  for (const [ref, v] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    let col = 0;
    for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
    byKey.set(cellKey(Number(m[2]) - 1, col - 1), v);
  }
  return {
    valueAt: (row, col) => byKey.get(cellKey(row, col)) ?? null,
    today: TODAY,
  };
}

const ev = (formula: string, cells?: Record<string, CellValue>) => evaluate(formula, ctx(cells));

describe('aritmética', () => {
  it('precedência e parênteses', () => {
    expect(ev('1+2*3')).toBe(7);
    expect(ev('(1+2)*3')).toBe(9);
    expect(ev('2^3^2')).toBe(512);
    expect(ev('-2^2')).toBe(4);
  });

  it('percentual é sufixo', () => {
    expect(ev('10%')).toBe(0.1);
    expect(ev('200*10%')).toBe(20);
  });

  it('divisão por zero vira #DIV/0!', () => {
    expect(ev('1/0')).toBe('#DIV/0!');
    expect(ev('MOD(5,0)')).toBe('#DIV/0!');
  });

  it('concatenação com &', () => {
    expect(ev('"a"&"b"&1')).toBe('ab1');
  });

  it('comparações devolvem booleano', () => {
    expect(ev('2>1')).toBe(true);
    expect(ev('"a"="A"')).toBe(true);
    expect(ev('1<>1')).toBe(false);
  });
});

describe('referências', () => {
  const cells = { A1: 10, A2: 20, B1: 'x', C3: 5 };

  it('célula simples e absoluta', () => {
    expect(ev('A1+A2', cells)).toBe(30);
    expect(ev('$A$1', cells)).toBe(10);
  });

  it('célula vazia vale zero na soma', () => {
    expect(ev('A1+Z9', cells)).toBe(10);
  });

  it('faixa em função de agregação', () => {
    expect(ev('SUM(A1:A2)', cells)).toBe(30);
    expect(ev('COUNT(A1:C3)', cells)).toBe(3);
    expect(ev('COUNTA(A1:C3)', cells)).toBe(4);
  });

  it('faixa onde se espera valor único usa a primeira célula', () => {
    expect(ev('A1:A2+0', cells)).toBe(10);
  });

  it('texto não entra na soma', () => {
    expect(ev('SUM(A1:B1)', cells)).toBe(10);
  });

  it('deslocamento relativo move a referência', () => {
    expect(evaluate('A1', ctx({ A1: 1, B3: 99 }), 2, 1)).toBe(99);
  });

  it('$ impede o deslocamento', () => {
    expect(evaluate('$A$1', ctx({ A1: 1, B3: 99 }), 2, 1)).toBe(1);
  });
});

describe('agregação', () => {
  const cells = { A1: 1, A2: 2, A3: 3, A4: 4 };

  it('SUM, AVERAGE, MIN, MAX', () => {
    expect(ev('SUM(A1:A4)', cells)).toBe(10);
    expect(ev('AVERAGE(A1:A4)', cells)).toBe(2.5);
    expect(ev('MIN(A1:A4)', cells)).toBe(1);
    expect(ev('MAX(A1:A4)', cells)).toBe(4);
  });

  it('aceita nomes em português', () => {
    expect(ev('SOMA(A1:A4)', cells)).toBe(10);
    expect(ev('MEDIA(A1:A4)', cells)).toBe(2.5);
  });

  it('média de faixa vazia é #DIV/0!', () => {
    expect(ev('AVERAGE(Z1:Z9)')).toBe('#DIV/0!');
  });

  it('argumentos soltos junto com faixa', () => {
    expect(ev('SUM(A1:A2,10,B9)', cells)).toBe(13);
  });
});

describe('condicionais', () => {
  it('IF com os dois ramos', () => {
    expect(ev('IF(1>0,"sim","nao")')).toBe('sim');
    expect(ev('IF(1<0,"sim","nao")')).toBe('nao');
  });

  it('IF sem o ramo falso devolve falso', () => {
    expect(ev('IF(1<0,"sim")')).toBe(false);
  });

  it('IFERROR captura o erro', () => {
    expect(ev('IFERROR(1/0,"zero")')).toBe('zero');
    expect(ev('IFERROR(2+2,"zero")')).toBe(4);
  });

  it('IFS pega a primeira condição verdadeira', () => {
    expect(ev('IFS(1<0,"a",1>0,"b")')).toBe('b');
    expect(ev('IFS(1<0,"a")')).toBe('#N/A');
  });

  it('AND, OR, NOT', () => {
    expect(ev('AND(1>0,2>1)')).toBe(true);
    expect(ev('OR(1<0,2>1)')).toBe(true);
    expect(ev('NOT(1>0)')).toBe(false);
  });
});

describe('texto', () => {
  it('LEFT, RIGHT, MID, LEN', () => {
    expect(ev('LEFT("cockpit",4)')).toBe('cock');
    expect(ev('RIGHT("cockpit",3)')).toBe('pit');
    expect(ev('MID("cockpit",2,3)')).toBe('ock');
    expect(ev('LEN("cockpit")')).toBe(7);
  });

  it('UPPER, LOWER, TRIM', () => {
    expect(ev('UPPER("abc")')).toBe('ABC');
    expect(ev('LOWER("ABC")')).toBe('abc');
    expect(ev('TRIM("  a   b  ")')).toBe('a b');
  });

  it('CONCAT junta faixa', () => {
    expect(ev('CONCAT(A1:A2)', { A1: 'a', A2: 'b' })).toBe('ab');
  });
});

describe('datas', () => {
  it('TODAY vem do contexto', () => {
    expect(ev('TODAY()')).toBe(TODAY);
    expect(ev('TODAY()-7')).toBe(TODAY - 7);
  });

  it('DATE, YEAR, MONTH, DAY', () => {
    const serial = dateToSerial(2026, 8, 20);
    expect(ev('DATE(2026,8,20)')).toBe(serial);
    expect(ev(`YEAR(${serial})`)).toBe(2026);
    expect(ev(`MONTH(${serial})`)).toBe(8);
    expect(ev(`DAY(${serial})`)).toBe(20);
  });

  it('DAYS entre dois seriais', () => {
    expect(ev('DAYS(46010,46000)')).toBe(10);
  });
});

describe('procura', () => {
  const cells = { A1: 'ana', A2: 'bia', A3: 'caio', B1: 10, B2: 20, B3: 30 };

  it('MATCH exato e INDEX', () => {
    expect(ev('MATCH("bia",A1:A3,0)', cells)).toBe(2);
    expect(ev('INDEX(B1:B3,2)', cells)).toBe(20);
  });

  it('INDEX+MATCH é o VLOOKUP na prática', () => {
    expect(ev('INDEX(B1:B3,MATCH("caio",A1:A3,0))', cells)).toBe(30);
  });

  it('MATCH sem achar devolve #N/A', () => {
    expect(ev('MATCH("zed",A1:A3,0)', cells)).toBe('#N/A');
  });

  it('INDEX fora da faixa devolve #REF!', () => {
    expect(ev('INDEX(B1:B3,9)', cells)).toBe('#REF!');
  });
});

describe('SOMASE / CONT.SE', () => {
  const cells = {
    A1: 'x', A2: 'y', A3: 'x', A4: 'z',
    B1: 10, B2: 20, B3: 30, B4: 40,
  };

  it('SUMIF com critério literal', () => {
    expect(ev('SUMIF(A1:A4,"x",B1:B4)', cells)).toBe(40);
  });

  it('SUMIF com comparação', () => {
    expect(ev('SUMIF(B1:B4,">15")', cells)).toBe(90);
  });

  it('COUNTIF conta o que casa', () => {
    expect(ev('COUNTIF(A1:A4,"x")', cells)).toBe(2);
    expect(ev('COUNTIF(B1:B4,">=30")', cells)).toBe(2);
  });

  it('SUMIFS e COUNTIFS com dois critérios', () => {
    expect(ev('SUMIFS(B1:B4,A1:A4,"x",B1:B4,">15")', cells)).toBe(30);
    expect(ev('COUNTIFS(A1:A4,"x",B1:B4,"<20")', cells)).toBe(1);
  });

  it('critério com curinga', () => {
    expect(matchesCriterion('cockpit', 'cock*')).toBe(true);
    expect(matchesCriterion('cockpit', 'c?ck*')).toBe(true);
    expect(matchesCriterion('outro', 'cock*')).toBe(false);
  });
});

describe('erros', () => {
  it('função desconhecida vira #NAME?', () => {
    expect(ev('XPTO(1)')).toBe('#NAME?');
  });

  it('sintaxe inválida vira #VALUE! em vez de derrubar', () => {
    expect(ev('1+')).toBe('#VALUE!');
    expect(ev('SUM(')).toBe('#VALUE!');
    expect(ev('=)')).toBe('#VALUE!');
  });

  it('texto onde se espera número vira #VALUE!', () => {
    expect(ev('A1+1', { A1: 'abc' })).toBe('#VALUE!');
  });

  it('erro se propaga pela conta', () => {
    expect(ev('1/0+5')).toBe('#DIV/0!');
    expect(ev('SUM(A1:A2)', { A1: '#N/A' as unknown as CellValue })).toBe('#N/A');
  });

  it('erro literal na fórmula é reconhecido', () => {
    expect(ev('IFERROR(#N/A,"ok")')).toBe('ok');
  });

  it('isError identifica os valores de erro', () => {
    expect(isError('#DIV/0!')).toBe(true);
    expect(isError('texto')).toBe(false);
    expect(isError(5)).toBe(false);
  });

  it('raiz de negativo vira #NUM!', () => {
    expect(ev('SQRT(-1)')).toBe('#NUM!');
  });
});

describe('referencesOf', () => {
  it('lista as células lidas', () => {
    expect(referencesOf('A1+B2')).toEqual([{ row: 0, col: 0 }, { row: 1, col: 1 }]);
  });

  it('expande a faixa', () => {
    expect(referencesOf('SUM(A1:A3)')).toEqual([
      { row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 },
    ]);
  });

  it('faixa gigante entra pelos limites, sem explodir', () => {
    const refs = referencesOf('SUM(A1:A100000)');
    expect(refs).toHaveLength(2);
  });

  it('fórmula inválida não quebra a extração', () => {
    expect(referencesOf('SUM(')).toEqual([]);
  });

  it('ignora números e texto', () => {
    expect(referencesOf('1+"A1"')).toEqual([]);
  });
});
