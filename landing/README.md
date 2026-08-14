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

CTAs apontam para `contato@cockpits3.com.br` e um número de WhatsApp placeholder
(`wa.me/5500000000000`) — ajuste antes de publicar.
