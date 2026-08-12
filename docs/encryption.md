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

### Habilitar criptografia exige bucket vazio

`POST /api/buckets/:id/encryption {enabled:true}` só é aceito se o bucket
estiver **vazio** no momento (zero objetos no S3 e zero metadados cifrados);
caso contrário responde `409 bucket_not_empty` e a criptografia NÃO é ligada.
Isso evita um bucket "cifrado" contendo objetos plaintext legados que
continuariam legíveis — exatamente a estrutura que a feature promete esconder.
**Desligar** a criptografia não exige bucket vazio (objetos já cifrados
continuam legíveis; apenas uploads novos deixam de ser cifrados). Para cifrar
um bucket que já tem dados, migre/mova os objetos para um bucket cifrado novo
(a migração automática de legados fica para a Fase 4).

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
para o S3. O handler evita esse cenário roteando por tamanho:

- **Arquivos grandes** (acima de `UPLOAD_SPOOL_THRESHOLD`, default **2 GiB**):
  o corpo é **derramado (spool) para um arquivo temporário local** — um sink
  rápido o bastante para o Bun nunca acionar o buffer interno — e só então
  sobe do arquivo para o S3 no ritmo do pipeline (multipart, parte por parte).
  A RAM fica baixa e constante (dezenas de MiB), independente do tamanho.
  Antes de derramar, o servidor **confere se o disco do spool tem espaço**
  para o arquivo; se não tiver, responde `507 insufficient_storage`.
- **Arquivos pequenos** (até o threshold): ficam em memória (mais rápido, sem
  I/O de disco).

**Não há teto artificial de tamanho de upload** — o único limite real é a
capacidade do bucket de destino (o `maxRequestBodySize` do Bun é configurado
como praticamente ilimitado). O diretório de spool é `os.tmpdir()` por padrão,
configurável via `UPLOAD_SPOOL_DIR`; o arquivo temporário é sempre apagado ao
final, com sucesso ou falha.

**merge-pdf:** o combinador de PDFs carrega cada arquivo inteiro em memória
(o pdf-lib exige os bytes completos), então a soma dos selecionados é limitada
por `MERGE_PDF_MAX_TOTAL_BYTES` (default **2 GiB**); acima disso responde `413`.

## Backup de recuperação (escrow/DR)

O backup de recuperação é um mecanismo separado da criptografia de objetos:
ele protege a **capacidade de recuperar o cockpit em si** (a KEK e o banco de
metadados/configuração), não os arquivos armazenados nos buckets. Sem ele,
perder o host que guarda a KEK e o banco significa perder o acesso a todos os
objetos cifrados, mesmo que eles continuem intactos no S3.

O que é incluído em cada snapshot: a KEK ativa (se configurada) e o arquivo do
banco de dados. Os arquivos dos buckets nunca são copiados pelo escrow.

O bundle é cifrado antes de subir para o destino, com até duas rotas de
abertura ("custódia híbrida"), configuráveis independentemente em
`Configurações`:

- **Cliente**: cifrado com uma chave derivada do **código de recuperação**
  (gerado ou definido manualmente, mín. 12 caracteres) mostrado **uma única
  vez** na hora da geração. Perdê-lo sem ter uma cópia offline torna esse
  caminho de abertura irrecuperável — o servidor não guarda o código em texto
  claro nem consegue reexibi-lo.
- **Vendor (gerenciado)**: se habilitado e disponível na instalação, o mesmo
  bundle também é cifrado para uma chave pública do vendor, permitindo
  recuperação assistida sem depender do código de recuperação do cliente.
  Só existe se `vendorAvailable` for `true` (chave do vendor provisionada na
  instalação); o fingerprint da chave é exibido na UI.

O destino de backup do cliente é um bucket S3 (endpoint, region, access/secret
key, bucket, prefixo) configurado em `Configurações`, independente dos
buckets de dados do cockpit. Snapshots antigos são retidos por uma política
de retenção; cada backup bem-sucedido pode remover snapshots expirados no
mesmo destino.

### Restauração (CLI)

Não há restauração pela UI — é sempre via linha de comando, a partir de uma
máquina de recuperação (não do host comprometido/perdido). Rode:

```bash
ESCROW_ENDPOINT=... \
ESCROW_KEY=... \
ESCROW_SECRET=... \
ESCROW_BUCKET=... \
ESCROW_REGION=garage \
ESCROW_PREFIX= \
ESCROW_RECOVERY_CODE=... \
COCKPIT_KEK_FILE=/caminho/de/saida/kek.bin \
DB_PATH=/caminho/de/saida/cockpit.db \
nix develop --command bash -c 'cd api && bun run restore'
```

- `ESCROW_ENDPOINT` / `ESCROW_KEY` / `ESCROW_SECRET` / `ESCROW_BUCKET` (e
  opcionalmente `ESCROW_REGION`, `ESCROW_PREFIX`) apontam para o mesmo destino
  S3 configurado no cockpit de origem.
- A abertura do bundle usa **ou** `ESCROW_RECOVERY_CODE` (o código gerado pelo
  cliente) **ou** o par `ESCROW_VENDOR_PUBKEY` + `ESCROW_VENDOR_PRIVKEY`
  (modo vendor, base64) — nunca os dois ao mesmo tempo são necessários.
- `COCKPIT_KEK_FILE` e `DB_PATH` são os caminhos de saída onde a KEK e o banco
  restaurados serão gravados; use `--force` para sobrescrever arquivos
  existentes nesses caminhos.

### Aviso de custódia

O **código de recuperação** e a **KEK** juntos são suficientes para decifrar
o backup do lado do cliente. Guarde os dois **offline e separados do storage
S3** (ex.: cofre físico, gerenciador de segredos fora da infraestrutura
coberta pelo próprio backup) — se ambos forem perdidos junto com o host
original, e o modo vendor não estiver habilitado, a recuperação por essa via
não é possível.
