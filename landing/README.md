# landing/ — página de apresentação do Cockpit S3

Landing page estática, self-contained, num único arquivo `index.html` (HTML + CSS
+ JS inline, fontes via Google Fonts). Sem build, sem dependências.

```bash
# abrir localmente
xdg-open landing/index.html          # ou arraste pro navegador

# ou servir
cd landing && python -m http.server 8090   # ou: bunx serve .
```

O visual segue a identidade do console (tema *truck-cockpit*, ciano `#22e0ff`,
fontes Oxanium / Saira / JetBrains Mono). A matriz de permissões (usuário × bucket)
é interativa — clique nas células para alternar entre sem-acesso / leitura /
escrita / dono.

O design foi importado do projeto Claude Design **"cockpit landing page"**
(`Cockpit S3.dc.html`) e convertido para HTML estático — os blocos dinâmicos
(`sc-for`, `style-hover`) viraram markup + JS vanilla.

Os CTAs apontam para **cockpits3@pm.me** (`mailto:`), o contato oficial do projeto —
o checkout online ainda não está no ar. Para a lista de espera do Cloud, o assunto do
email é "Cloud waitlist". Não use outros endereços ou números de contato.
