# Criptografia em repouso (at-rest encryption)

> **Nota:** este é um esboço criado na Fase 1 (implementação do núcleo de
> criptografia). O documento completo — modelo de chaves, modelo de ameaças e
> plano de disaster recovery — será escrito na Fase 5. Por enquanto este
> arquivo cobre apenas o essencial para rodar e entender os testes.

## Testes

### Requisito NixOS / libstdc++

`sodium-native` é um addon nativo N-API. No NixOS, o `bun test` (e o `bun run`
em geral) precisa encontrar `libstdc++.so` no loader path — isso não vem por
padrão no NixOS. Rode sempre dentro do devShell do flake:

```bash
nix develop
cd api && bun test
```

ou, sem entrar no shell interativo:

```bash
nix develop --command bash -c 'cd api && bun test src/crypto src/objects'
```

O `flake.nix` já resolve isso via `LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];`
no devShell. Em CI com glibc "normal" (ex.: runners Ubuntu) isso **não** é
necessário — o addon carrega nativamente.

Há um teste de fumaça dedicado a isso: `api/src/crypto/sodium.smoke.test.ts`.
É o go/no-go da Fase 0: se ele falhar, o ambiente não tem o `sodium-native`
utilizável e nenhum outro teste de criptografia vai funcionar.

### Testes unitários (não precisam de S3)

```bash
nix develop --command bash -c 'cd api && bun test src/crypto src/objects'
```

Cobre o módulo de criptografia (geração/derivação de chaves, wrap/unwrap de
DEK, streams de cifra/decifra) e as stores de objetos cifrados. Não tocam em
um S3 real — todo I/O de blob é mockado ou local.

Estado atual (verificado nesta task): **28 pass, 0 fail** (56 `expect()`
calls, 6 arquivos).

### Testes de integração e carga (precisam de um S3 real)

`api/src/storage/crypto-pipeline.test.ts` e `api/src/storage/load.test.ts`
são guardados por `describe.skip` quando `S3_TEST_ENDPOINT` não está setado —
ou seja, **pulam silenciosamente** em `bun test src/crypto src/objects` (que
nem os inclui) e também pulam se você rodar `bun test src/storage` sem essas
variáveis. Isso é esperado e não indica falha.

Para rodá-los de verdade, suba um MinIO local (ou aponte para um Garage/S3
compatível) e defina:

- `S3_TEST_ENDPOINT` — URL do endpoint S3 (ex.: `http://localhost:9000`)
- `S3_TEST_KEY` / `S3_TEST_SECRET` — credenciais de acesso
- `S3_TEST_BUCKET` — bucket de teste (deve existir)
- `S3_TEST_CID` — id da conexão de teste (usado por `crypto-pipeline.test.ts`
  para montar `bucketId = "${cid}:${bucket}"`)
- `S3_TEST_REGION` — opcional, default `us-east-1`
- `RSS_CAP_MB` — opcional, teto de RSS (memória residente) em MiB para o
  teste de carga verificar que não há vazamento por streaming; default `900`

Exemplo concreto para o teste de carga:

```bash
S3_TEST_ENDPOINT=http://localhost:9000 \
S3_TEST_KEY=minioadmin \
S3_TEST_SECRET=minioadmin \
S3_TEST_BUCKET=loadtest \
RSS_CAP_MB=900 \
nix develop --command bash -c 'cd api && bun test src/storage/load.test.ts'
```

E para o teste de pipeline (roundtrip cifrado ponta a ponta):

```bash
S3_TEST_ENDPOINT=http://localhost:9000 \
S3_TEST_KEY=minioadmin \
S3_TEST_SECRET=minioadmin \
S3_TEST_BUCKET=cryptotest \
S3_TEST_CID=test-conn \
nix develop --command bash -c 'cd api && bun test src/storage/crypto-pipeline.test.ts'
```

### KEK (Key Encryption Key) para rodar API/testes com criptografia habilitada

Sem uma KEK configurada, buckets cifrados não podem ser habilitados — o
restante do sistema (buckets não cifrados/legados) segue funcionando
normalmente. Para habilitar, configure uma das duas variáveis:

- `COCKPIT_KEK_FILE` — caminho para um arquivo contendo 32 bytes, crus ou em
  base64
- `COCKPIT_KEK` — os mesmos 32 bytes, diretamente em base64

Os próprios testes (`kek.test.ts`, `load.test.ts`, `crypto-pipeline.test.ts`)
geram uma KEK de teste automaticamente (32 bytes fixos) via essas variáveis —
não é preciso configurar nada manualmente para os testes unitários.

## Memória em upload/download cifrado

Os DOWNLOADS cifrados são feitos em streaming, com memória limitada
independente do tamanho do arquivo.

Os UPLOADS cifrados esbarram numa limitação do próprio servidor HTTP do Bun:
quando o cliente envia dados mais rápido do que conseguimos escrevê-los no
S3, o Bun bufferiza o corpo da requisição inteiro em RAM antes de entregá-lo
ao handler — algo que não controlamos diretamente no pipeline de streaming
para o S3. A solução é evitar esse cenário: em vez de consumir o corpo cru
direto para o S3, o handler primeiro **derrama (spool) o corpo para um
arquivo temporário local** — um sink rápido o bastante para o Bun nunca
acionar o buffer interno — e só então sobe o conteúdo do arquivo para o S3,
no ritmo do próprio pipeline (multipart, parte por parte).

Com isso a RAM do servidor fica baixa e praticamente constante durante o
upload (dezenas de MiB), independente do tamanho do arquivo — o limite
prático passa a ser o espaço em DISCO disponível no diretório de spool, não
mais a RAM nem um teto artificial de tamanho de objeto. O diretório de spool
é `os.tmpdir()` por padrão, configurável via `UPLOAD_SPOOL_DIR`. O arquivo
temporário é sempre apagado ao final do upload, com sucesso ou falha.
