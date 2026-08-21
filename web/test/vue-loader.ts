// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Lucas Pagliarini
/**
 * Carregador de componentes .vue para o `bun test`. Sem isto não existe teste de
 * DOM neste projeto: o bun não compila Single File Components, e o vite compila
 * para SSR, que não serve para montar o componente e olhar o resultado.
 *
 * Duas regressões visuais do grid (a primeira linha nascendo debaixo do
 * cabeçalho e a coluna estreita demais para ler) chegaram ao usuário porque a
 * suíte só cobria os módulos puros. É isso que este arquivo destrava.
 */
import { plugin, type BunPlugin } from 'bun';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { compileScript, compileTemplate, parse, rewriteDefault } from '@vue/compiler-sfc';

if (!globalThis.document) GlobalRegistrator.register();

const vueLoader: BunPlugin = {
  name: 'vue-sfc',
  setup(build) {
    build.onLoad({ filter: /\.vue$/ }, ({ path }) => {
      const source = readFileSync(path, 'utf8');
      const id = basename(path);
      const { descriptor } = parse(source, { filename: id });

      const script = descriptor.script || descriptor.scriptSetup
        ? compileScript(descriptor, { id, inlineTemplate: false })
        : null;

      const template = descriptor.template
        ? compileTemplate({
          id,
          filename: id,
          source: descriptor.template.content,
          compilerOptions: { bindingMetadata: script?.bindings },
        })
        : null;

      const isTs = (descriptor.scriptSetup?.lang ?? descriptor.script?.lang) === 'ts';
      const scriptCode = script
        ? rewriteDefault(script.content, '__sfc__', isTs ? ['typescript'] : [])
        : 'const __sfc__ = {};';

      const bind = template
        ? `${template.code}\n__sfc__.render = render;`
        : '';

      return {
        contents: `${scriptCode}\n${bind}\n__sfc__.__file = ${JSON.stringify(id)};\nexport default __sfc__;`,
        loader: 'ts',
      };
    });
  },
};

plugin(vueLoader);
