# RPSappII

Refatoracao estrutural do app RPS original, preservando o modelo sem bundler e separando a logica em arquivos por dominio.

## Estrutura

- `index.html`: casca da aplicacao e ordem de carregamento dos scripts
- `style.css`: estilos da interface
- `supabase-config.js`: configuracao do cliente Supabase
- `js/core.js`: constantes, estado global, helpers e utilitarios
- `js/auth-sync.js`: autenticacao, administracao, sincronizacao e lembretes
- `js/data.js`: formulas, calculos e anexos
- `js/render.js`: renderizacao da grade principal e modo apresentacao
- `js/bootstrap.js`: inicializacao da aplicacao
- `supabase/functions/send-rps-reminder/index.ts`: funcao de envio de lembretes

## Melhorias aplicadas

- Quebra do antigo `app.js` monolitico em arquivos menores
- Ajustes de escaping em pontos de HTML dinamico
- Remocao de alguns trechos com `innerHTML` contendo dados editaveis
- Revisao de encoding na nova copia para evitar strings corrompidas
- Migracao dos anexos para Supabase Storage usando o bucket `rps-attachments`

## Observacao

## Storage

Os anexos agora usam Supabase Storage. O app espera um bucket chamado `rps-attachments`.

Recomendacao:

- criar o bucket como publico para manter preview e links simples no front atual
- aplicar politicas de upload e exclusao alinhadas aos usuarios autenticados do app

## Dominio

O dominio publico do app esta centralizado em `APP_PUBLIC_URL` dentro de `js/core.js`.
Hoje ele aponta para `https://rps.marcher.com.br/`.

Se mudar o dominio no futuro, ajuste esse valor e revise no Supabase:

- Authentication > Site URL
- Authentication > Redirect URLs
- Edge Function secrets, se `APP_BASE_URL` estiver em uso nos lembretes
