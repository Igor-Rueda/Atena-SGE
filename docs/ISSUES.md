# Backlog — issues do repositório

> Cada bloco abaixo vira uma issue. O título é o título da issue, "Status" diz onde está, e "Pronto quando" vai como critério de aceite.
> **Feito (não testado)** significa que o código existe, mas ainda não foi validado de ponta a ponta. A issue 25 traz o roteiro de teste.
> A numeração mudou em relação à versão anterior deste arquivo (o consumo de itens foi substituído pelo fluxo da demanda, e entraram as issues de multi-tenancy). Nesta versão, as issues novas da assinatura (36 a 39) foram acrescentadas no fim, para não mudar os números já citados no README (25 e 26).
> **Verificado** quer dizer que foi coberto por um teste de integração (API real contra MariaDB 10.11, auth-service simulado). Uma versão enxuta do teste de isolamento roda no CI a cada push; o teste completo (80 verificações) continua fora do CI (issue 25).
> Labels sugeridos: `atividade-10`, `atividade-11`, `saas`, `multi-tenancy`, `backend`, `frontend`, `infra`, `regressao`, `seguranca`, `banco`.

---

## Já implementado

### 1. Papéis do plano: `professional`, `expert` e `admin`
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `seguranca`
Papéis cumulativos `professional < expert < admin` no `auth-service`, no `app` e no `pagamentos`. Todo usuário novo nasce `professional`; o `admin` só nasce por comando no banco. O `exigirNivel` bloqueia com `403` e registra `acesso_negado` no log. O plano decide limites e recursos de análise, **não** o CRUD.
**Pronto quando:** um `professional` que chama uma rota de Expert (análise, indicadores) recebe `403`, e o evento aparece na consulta de logs do `admin`.

### 2. Categorias de usuário e permissões por categoria
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `frontend` `seguranca`
Cinco categorias gravadas em `usuarios.categoria` e levadas no JWT (tokens antigos, sem o campo, valem como Superior): **Superior** (cadastra, edita, exclui e conclui projetos; sem fila e sem acesso a demandas), **Planejador** (cadastra, edita e exclui demandas), **Almoxarife**, **Operador** e **Montador** (cada um avança a demanda da sua etapa). A conferência é feita na API por `exigirCategoria` e pelo mapa `TRANSICAO`. A tela só esconde o que a pessoa não pode fazer.
**Pronto quando:** o Superior que tenta criar uma demanda recebe `403`; o Planejador que tenta criar um projeto recebe `403`; o Almoxarife que tenta avançar uma demanda da Montagem recebe `403`.

### 3. Modelagem: empresas, projetos e demandas
**Status:** Feito (verificado) · **Labels:** `atividade-10` `banco`
Tabelas `organizacoes`, `projetos`, `demandas` (que **unifica o antigo item e a demanda**: RG, material, quantidade e `etapa_atual`, com os responsáveis de cada etapa, `finalizado_em` e a exclusão lógica) e `modelos_regressao`, todas com chaves estrangeiras e índices, em `db/001_dominio.sql`. O script cria o banco do zero e atualiza um banco em uso sem apagar nada, e pode ser repetido. `db/002_seed.sql` traz duas empresas de exemplo. A tabela `itens` foi removida.
**Pronto quando:** o banco de produção e o do CI têm as mesmas tabelas e colunas (o `.github/ci/schema.sql` é a junção de `db/000_base.sql`, `db/001_dominio.sql` e `db/003_assinaturas.sql`; veja a issue 21).

### 4. Telas de projetos e demandas
**Status:** Feito (não testado no navegador) · **Labels:** `atividade-10` `frontend`
Lista de projetos em cartões (o botão de novo projeto só aparece para o Superior); página do projeto com os dados no topo, as demandas e, para o Planejador, o formulário de cadastro e edição, o seletor de processo e a aba **Excluídas**; página **Minhas demandas** só para Almoxarife, Operador e Montador (Superior e Planejador não veem o item no menu).
**Pronto quando:** o Superior cria um projeto, o Planejador cadastra demandas nele e as demais categorias as veem na fila.

### 5. Regras de acesso do CRUD (por categoria, não por plano)
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `seguranca`
Projetos: só o Superior cadastra; só o Superior **dono** edita, exclui ou conclui. Demandas: só o Planejador cadastra; só o Planejador que a criou edita ou exclui, e só enquanto não está finalizada. Excluir não exige mais o plano Expert.
**Pronto quando:** um `professional` com a categoria certa edita e exclui normalmente; um Planejador não edita a demanda de outro Planejador (`403`).

### 6. Fluxo da demanda e finalização
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `frontend`
A demanda entra no Almoxarifado e avança Almoxarifado → Operação → Montagem → Finalizada, cada passo pela categoria dona da etapa, com proteção contra dois cliques simultâneos (`409`). Ao finalizar na Montagem grava `finalizado_em`, que é a base da "demanda do mês" da previsão. O Planejador pode destinar a demanda a outro processo ao editar (os responsáveis das etapas posteriores são apagados).
**Pronto quando:** uma demanda percorre as quatro etapas com um usuário de cada categoria e termina com `finalizado_em` preenchido.

### 7. Exclusão lógica e aba Excluídas
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `frontend`
Excluir demanda preenche `excluida_em` e `excluida_por`. A demanda some da fila, do projeto, das contagens, dos indicadores e do limite do plano, e aparece na aba *Excluídas* do Planejador que a excluiu.
**Pronto quando:** a demanda excluída aparece só na aba Excluídas e deixa de contar no limite de 50 demandas abertas.

### 8. Aviso ao concluir ou excluir projeto com demandas pendentes
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `frontend`
Com demandas que a Montagem ainda não concluiu, concluir ou excluir o projeto abre um aviso pedindo confirmação, e a API só segue com `?confirmar=1` (sem isso responde `409`). Concluir não pede mais o número de funcionários. As pendentes são encerradas sem `finalizado_em`, para não entrar na "demanda do mês".
**Pronto quando:** concluir um projeto com 2 pendentes mostra o aviso, e a API recusa a chamada direta sem confirmação.

### 9. Identidade visual e redesenho da interface
**Status:** Feito (visual a validar) · **Labels:** `atividade-10` `frontend`
Paleta tirada do logo (bege pastel e bronze), CSS dividido em `tokens`, `base`, `componentes`, `layout`, `auth` e um arquivo por página, menu lateral montado por `js/layout.js`, página inicial com guia da interface, modais e notificações próprios.
**Pronto quando:** as telas são conferidas no navegador e os ajustes de cor e espaçamento são feitos nos arquivos de estilo.

### 10. Log-service: ações do produto, nível e filtros
**Status:** Feito (verificado nos eventos da API) · **Labels:** `atividade-10` `backend`
A lista fixa de ações foi trocada por validação de formato. O log aceita `nivel` (informação ou erro), filtros na consulta e limite de tamanho do histórico. Eventos que a API registra, sempre com quem fez e a empresa (`org=` no detalhe):
- **Empresa e equipe:** `empresa_criada`, `membro_cadastrado`, `codigo_empresa_consultado`, `codigo_empresa_renovado`.
- **Projetos:** `projeto_criado`, `projeto_editado`, `projeto_excluido`, `projeto_concluido`.
- **Demandas:** `demanda_criada`, `demanda_editada`, `demanda_excluida`, **`demanda_avancada`** (uma por passagem de etapa, com `de` e `para`), **`demanda_redirecionada`** (o Planejador destina a demanda a outro processo) e `demanda_concluida`.
- **Análise:** `indicadores_consultados`, `csv_previsualizado`, `modelo_treinado`, `previsao_consultada`, `modelo_descartado`.
- **Perfil:** `perfil_atualizado`, `foto_atualizada`.
- **Plano e segurança:** `limite_plano_atingido`, `acesso_negado`, `cadastro_recusado`, `login_falhou`, `logout` e `erro_interno`, registrados pelo `app`.
- **Assinatura (serviço `pagamentos`):** `assinatura_ativada`, `assinatura_atualizada`, `assinatura_cancelada`, `pagamento_falhou` e `portal_aberto`; o `app` registra `checkout_iniciado` e `painel_admin_consultado`.
- **Autenticação:** `login` vem do `auth-service`.

**Pronto quando:** um evento de cada ação aparece na consulta do `admin`, e uma demanda que percorre o fluxo inteiro deixa um `demanda_avancada` por etapa.

### 11. Plano Expert único no Stripe
**Status:** Feito (ver a issue 36 para a assinatura completa) · **Labels:** `atividade-11` `backend`
Um só preço (`STRIPE_PRICE_EXPERT`). O pagamento muda o papel de `professional` para `expert`, e o cancelamento devolve a `professional`, sempre pelo webhook. Se o `auth-service` recusar a promoção, o evento `assinatura_ativada` não é registrado. O ciclo de vida completo (renovação, inadimplência, cancelamento agendado) está na issue 36.
**Pronto quando:** o pagamento com o cartão de teste promove o usuário, o cancelamento promovido pelo Stripe o rebaixa, e o webhook responde `200`.

### 12. Limites de uso do plano Professional
**Status:** Feito (não testado) · **Labels:** `atividade-11` `backend` `frontend` `seguranca`
Até 3 projetos ativos e 50 demandas abertas, contados por conta. O que é concluído, finalizado ou excluído sai da contagem. Os valores ficam na constante `LIMITES` do `app/routes.js`. Ao estourar, a API responde `403` com `codigo: "limite_plano"` e o front abre o convite para assinar. Expert e `admin` não têm limite. (O limite de itens por projeto deixou de existir junto com a tabela `itens`.)
**Pronto quando:** um `professional` com 3 projetos ativos recebe `403` ao criar o quarto; ao concluir um, consegue criar outro; um `expert` cria sem limite.

### 13. Serviço de regressão: treino a partir de CSV
**Status:** Feito (testes escritos, ainda não executados nesta versão) · **Labels:** `atividade-11` `regressao` `backend`
Serviço interno em Python, sem porta pública, protegido por `INTERNAL_API_KEY`. Endpoints (todos via `app`, só `expert` e `admin`): prévia do CSV com sugestão de papel por coluna, treino (regressão linear múltipla por mínimos quadrados, com R², R² ajustado, MAE, RMSE, validação cruzada "deixa um de fora", coeficientes, importância e avisos), consulta do modelo, previsão e descarte. O modelo fica guardado por usuário na tabela `modelos_regressao`. Aceita CSV com `;`, `,` ou tabulação, decimal com vírgula ou ponto, UTF-8 ou ANSI, até 2 MB e 5.000 linhas, e recusa `.xlsx` com orientação. Há testes unitários e de API (`regressao/tests`) e o passo de teste no CI.
**Pronto quando:** o CI executa os testes do serviço e um `expert` treina com um CSV e recebe previsão; um `professional` recebe `403`.

### 14. Página Análise: previsão de equipe e indicadores
**Status:** Feito (não testado no navegador) · **Labels:** `atividade-11` `frontend` `backend`
A página tem duas abas, bloqueadas para o `professional` (com a trava real no backend). **Previsão de equipe:** envio do CSV, escolha de colunas no estilo Orange, aviso de carregamento durante o treino, métricas, coeficientes, gráfico real × previsto e formulário de previsão. **Indicadores:** gráfico de barras verticais com as demandas por processo (Almoxarifado, Operação e Montagem) e gráfico de pizza de concluídas × pendentes, em SVG, com botão **Imprimir** e estilo de impressão próprio. A rota `GET /api/indicadores` ignora demandas excluídas. O endereço `analise.html#indicadores` abre direto na aba.
**Pronto quando:** um `expert` treina e prevê, abre a aba Indicadores, confere os números contra o banco e imprime só os gráficos; um `professional` vê o bloqueio.

### 15. CI: testes, schema e Garage de teste
**Status:** Feito (a validar no pipeline) · **Labels:** `atividade-11` `infra`
O pipeline (`.github/workflows/ci-cd.yml`) sobe a stack com um MariaDB efêmero e roda, nesta ordem: cadastro e login; **pagamentos** (webhook sem assinatura e com assinatura forjada → `400`, assinatura válida → `200`, evento gravado em `eventos_stripe`, reenvio do mesmo evento → `duplicate`, checkout sem login → `401`, renovação de token); **assinatura** (`/api/assinatura`, `/portal` e `/admin/resumo` sem login → `401`, conta nova sem assinatura, portal sem cliente → `404`, checkout com plano inválido → `400`, painel admin com conta comum → `403`); **isolamento entre empresas**; e **regressão** (testes unitários e de API). O schema do CI (`.github/ci/schema.sql`) é a junção de `db/000_base.sql`, `db/001_dominio.sql` e `db/003_assinaturas.sql`. Há ainda um passo que cria um `garage.toml` descartável, já que o real não é versionado. No `docker-compose.ci.yml`, o `auth-service` recebe `RATE_LIMIT_SENSIVEL_MAX` (o limite de login por IP, 5 em produção, é elevado só no CI, porque todos os testes chegam do mesmo IP). O teste completo de projetos, demandas, empresas e papéis (80 verificações) continua fora do CI (veja a issue 25).
**Pronto quando:** o pipeline passa de ponta a ponta, incluindo o serviço de regressão, e as imagens são publicadas.

---

## Requisitos de SaaS multi-tenant

### 16. Isolamento entre empresas
**Status:** Feito (verificado; também no CI, em versão enxuta) · **Labels:** `saas` `multi-tenancy` `backend` `banco` `seguranca`
Cada usuário pertence a uma empresa (`usuarios.organizacao_id`), e projetos e demandas carregam o mesmo `organizacao_id`. A empresa é lida **do banco** a cada requisição (nunca do cliente), conta sem empresa é barrada (`403`), e toda consulta e ação filtra por ela: projetos, demandas, fila, indicadores e perfis. ID de outra empresa responde `404`. O `organizacao_id` entra no detalhe de cada evento do log.
**Pronto quando:** um usuário da empresa B recebe `404` ao abrir, editar, excluir, concluir ou avançar qualquer projeto ou demanda da empresa A (coberto no teste de integração: 80 verificações, nenhuma falha), **e** o teste de isolamento do CI passa a cada push (já existe, para projetos e perfis; falta cobrir demandas no CI, veja a issue 25).

### 17. Cadastro com empresa e código da empresa
**Status:** Feito (verificado na API e no formulário) · **Labels:** `saas` `multi-tenancy` `backend` `frontend` `seguranca`
O cadastro recebe o nome da empresa. O **Superior** cria a empresa (nome único, sem diferenciar maiúsculas) e é o dono dela. Planejador, Almoxarife, Operador e Montador informam o nome **e o código** da empresa, que o Superior vê e renova no botão *Equipe* da lista de projetos (`GET /api/organizacao` e `POST /api/organizacao/codigo`). Nome ou código errado responde `403` com a mesma mensagem (não revela se a empresa existe). A empresa é criada antes de chamar o `auth-service` e desfeita se o cadastro falhar. Limite de 10 tentativas por minuto contra adivinhação de código. Isso substitui o convite por e-mail, que passou para as melhorias futuras.
O formulário de cadastro pede o **nome da empresa** (sempre) e o **código da empresa** (só quando a categoria não é Superior; o campo aparece e some conforme a categoria escolhida) e envia `empresa` e `codigo_empresa` em `POST /api/auth/cadastro`.
**Pronto quando:** o cadastro pelo formulário, no ambiente real, cria a empresa do Superior e só deixa um Planejador entrar com nome e código certos (a API e o formulário já foram verificados separadamente).

### 18. Anexo de demanda
**Status:** Dispensada · **Labels:** `saas` `backend` `frontend`
O requisito de upload ligado ao domínio é atendido pelo perfil corporativo (foto e bio, no storage S3). O anexo por demanda (desenho técnico, foto da peça) fica nas melhorias futuras.

### 19. Landing page pública
**Status:** Feito (texto atualizado para o README; visual a validar) · **Labels:** `atividade-10` `saas` `frontend`
Página pública, aberta sem login, com a proposta de valor, o fluxo Almoxarifado → Operação → Montagem → Finalizada, os recursos, a previsão de equipe, os planos (Professional grátis e Expert a R$ 149/mês), as perguntas frequentes e a chamada para cadastro. Os textos seguem o README: limites de 3 projetos ativos e 50 demandas abertas, categorias, isolamento entre empresas e código da equipe.
**Pronto quando:** a página é conferida no navegador (inclusive as áreas do fluxo, da previsão e do resultado de exemplo, que dependem de regras de estilo que podem estar em `componentes.css`).

### 20. Publicar no mesmo domínio e na mesma stack do Portainer
**Status:** Feito (confirmado) · **Labels:** `atividade-10` `infra`
Antes de subir esta versão da API, rodar no banco de produção `db/001_dominio.sql` (a API exige `organizacao_id`) e `db/003_assinaturas.sql` (sem as tabelas `assinaturas` e `eventos_stripe`, o webhook responde `500` e o painel admin falha). No Portainer, conferir as variáveis do Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_EXPERT`) e a `INTERNAL_API_KEY`.

### 21. Scripts de banco reproduzíveis
**Status:** Feito (verificado) · **Labels:** `saas` `banco` `infra`
`db/000_base.sql` cria as tabelas base; `db/001_dominio.sql` cria do zero e atualiza um banco em uso (idempotente, sem comandos destrutivos); `db/003_assinaturas.sql` cria a cópia local das assinaturas e a lista de webhooks processados. Num banco com dados, as contas existentes entram numa "Empresa de teste (legado)". `db/002_seed.sql` cria duas empresas de exemplo e não duplica se rodar de novo. Testados em banco novo, em banco legado e repetindo a execução. Os scripts antigos de `banco/` não devem mais ser usados.
**Pronto quando:** o `.github/ci/schema.sql` é igual à junção `cat db/000_base.sql db/001_dominio.sql db/003_assinaturas.sql` e o CI passa com ele.

### 22. Limpeza do projeto antigo (nada de filmes)
**Status:** Feito (confirmado) · **Labels:** `atividade-10` `saas` `banco` `infra`

### 23. Log das movimentações
**Status:** Feito (verificado) · **Labels:** `saas` `backend`
Cada passagem de etapa registra `demanda_avancada` (de → para, com quem fez e a empresa), e o Planejador que destina a demanda a outro processo registra `demanda_redirecionada`. A finalização continua registrando também `demanda_concluida`.
**Falta conferir:** que `login` (`auth-service`) e `logout` e `erro_interno` (`app`) continuam sendo registrados.

### 24. Documentação das rotas (Swagger) — extra
**Status:** Pendente (opcional) · **Labels:** `saas` `backend`
Documentar no Swagger as rotas de projetos, demandas, empresa, indicadores, análise e assinatura, com os códigos `403` e `404` de cada uma.

### 25. Roteiro de teste de ponta a ponta e testes de isolamento no CI
**Status:** Parcial · **Labels:** `atividade-11` `saas` `infra` `seguranca`
O teste de integração de isolamento, papéis, cadastro e log existe (API real contra MariaDB, auth-service simulado, 80 verificações) e passou. No CI já roda uma versão enxuta (duas empresas, código errado → `403`, empresa B recebe `404` ao abrir, editar, concluir e excluir projeto da A, ao listar projetos e ao pedir o perfil de um usuário da A). Falta levar ao pipeline o que cobre **demandas** (abrir, editar, excluir e avançar demanda de outra empresa) e executar o roteiro no ambiente real:
1. Rodar `db/000_base.sql`, `db/001_dominio.sql`, `db/003_assinaturas.sql` e (só em teste) `db/002_seed.sql`, e subir tudo com `docker compose up --build`.
2. Cadastrar pelo formulário um Superior (criando a empresa) e as demais categorias com o código; conferir categoria e empresa no menu.
3. **Superior:** criar, editar e concluir um projeto; conferir que o menu não mostra "Minhas demandas" e que criar demanda dá `403`.
4. **Planejador:** cadastrar, editar (inclusive trocando o processo), excluir e achar a demanda na aba Excluídas; criar projeto dá `403`.
5. **Fluxo:** Almoxarife, Operador e Montador avançam até Finalizada; conferir `finalizado_em` e um `demanda_avancada` por etapa no log.
6. **Concluir e excluir projeto** com demandas pendentes: ver o aviso, e conferir que a API recusa sem confirmação.
7. **Isolamento:** com duas empresas, tentar abrir, editar, excluir e avançar IDs da outra, pela tela e por chamada direta à API: tudo deve dar `404`.
8. **Limites:** estourar o 4º projeto ativo e a 51ª demanda aberta e ver o convite para assinar.
9. **Expert:** assinar com o cartão de teste (o plano só muda quando o webhook chega; se preciso, sair e entrar de novo), treinar e prever em Análise, abrir Indicadores e imprimir.
10. **Assinatura:** abrir *Gerenciar assinatura*, cancelar no portal (cancelamento imediato, para testar na hora) e conferir que a conta volta ao Professional; se possível, simular uma renovação recusada (issue 39).
11. Conferir os eventos no log como `admin`, e o painel admin (assinaturas ativas, MRR de teste, últimos webhooks).
**Pronto quando:** todos os passos funcionam no ambiente real e o CI executa os testes de isolamento de projetos **e** de demandas.

### 26. Plano por empresa
**Status:** Decisão pendente · **Labels:** `saas` `multi-tenancy` `backend`
Hoje o plano (Professional/Expert) é da conta, e os limites do Professional contam por conta. Como a empresa é quem paga, o mais coerente é o plano ser da empresa, com os membros herdando o papel (o Stripe cobraria a empresa). Hoje, se o Superior assina o Expert, o Planejador da mesma empresa continua Professional. A mudança mexe também no Stripe e nas tabelas `clientes_stripe` e `assinaturas`, que hoje são por `usuario_id`, e nos limites, que hoje contam por usuário.

---

## Assinatura (Stripe)

### 36. Assinatura recorrente e webhooks
**Status:** Feito (testado com o Stripe simulado; a validar no Stripe em modo de teste) · **Labels:** `atividade-11` `saas` `backend`
Checkout em `mode=subscription` com preço recorrente mensal de R$ 149, ligado a um customer do Stripe guardado por usuário (`clientes_stripe`). O Stripe é a fonte da verdade: o papel do usuário é recalculado a partir das assinaturas que ele informa, e o banco guarda uma cópia (`assinaturas`). Quatro webhooks, todos com assinatura validada e sem efeito duplicado (`eventos_stripe`):
- `checkout.session.completed`: guarda customer e subscription e promove para Expert (cancela assinaturas anteriores do cliente).
- `customer.subscription.updated`: atualiza o status e recalcula o papel.
- `customer.subscription.deleted`: a conta volta ao Professional.
- `invoice.payment_failed`: marca como inadimplente e suspende o plano pago; ao regularizar, o acesso volta sozinho.

A promoção só acontece quando o `auth-service` aceita; admin nunca é rebaixado nem vendido. Eventos: `assinatura_ativada`, `assinatura_atualizada`, `assinatura_cancelada`, `pagamento_falhou`.
**Pronto quando:** com o cartão `4242`, a conta vira Expert pelo webhook; ao cancelar, volta a Professional; reenviar o mesmo evento não duplica o efeito; e os quatro webhooks respondem `200` no painel do Stripe.

### 37. Portal do cliente e estado da assinatura na página Planos
**Status:** Feito (a validar no Stripe) · **Labels:** `atividade-11` `saas` `backend` `frontend`
`POST /api/assinatura/portal` abre o portal do cliente do Stripe (troca de plano e cancelamento), só para quem já passou pelo checkout (senão, `404`). `GET /api/assinatura` devolve a cópia local do estado, e a página Planos mostra o botão **Gerenciar assinatura** e os avisos de cobrança recusada e de cancelamento agendado. O portal precisa estar configurado no painel do Stripe (troca de plano e cancelamento, este imediato para teste).
**Pronto quando:** o botão abre o portal, o cancelamento chega pelo webhook e a conta volta ao Free; uma cobrança recusada mostra o aviso na página Planos.

### 38. Painel admin
**Status:** Feito (a validar no ambiente) · **Labels:** `atividade-11` `saas` `backend` `frontend`
Só para o papel `admin`: usuários por plano, assinaturas ativas e inadimplentes, MRR de teste (planos anuais entram divididos por 12), últimos webhooks recebidos e últimos eventos do log. É um resumo do produto inteiro, de propósito (o `admin` administra o produto, não uma empresa).
**Pronto quando:** logado como `admin`, o painel mostra números coerentes com o dashboard do Stripe; qualquer outra conta recebe `403`.

### 39. Evidências e testes no Stripe em modo de teste
**Status:** Pendente · **Labels:** `atividade-11` `saas` `infra`
Registrar os testes da assinatura no Stripe em modo de teste e colar os prints na seção 14 do README (itens 14.1 a 14.15): landing, listagem, `403` por papel, `404` entre empresas, eventos no log, arquivo no storage S3, stack no Portainer, CI aprovado, assinatura com o cartão `4242`, dashboard do Stripe, webhook recebido, limite bloqueando no Free, painel admin, portal e cancelamento, e (opcional) cobrança recusada simulada com um relógio de teste. Preencher o domínio, a data e as contas usadas, sem expor `.env`, tokens, senhas nem chaves. Por fim, abrir a issue de entrega *Entrega — SaaS completo*, mencionando `@siriani`.
**Pronto quando:** todos os itens da seção 14 estão marcados e a issue de entrega foi aberta com o link do commit e os prints.

---

## Melhorias futuras

### 27. Convite por e-mail e gestão de membros
Substituir (ou somar a) o código da empresa por convite por e-mail, com link de uso único e validade, e uma tela do Superior para listar e remover membros.

### 28. Anexo de demanda
O Planejador anexa o desenho técnico ou a foto da peça à demanda: nova tabela de anexos ligada à demanda e à empresa, arquivo no storage S3 e download pelo `app`, que confere a empresa antes de entregar.

### 29. Restaurar demandas excluídas
A aba Excluídas hoje é só consulta. Permitir restaurar, conferindo o limite do plano Professional na hora.

### 30. Exportar o histórico mensal em CSV pelo app
Gerar, a partir do banco, a série mensal de quantidades de demandas finalizadas pela Montagem (`finalizado_em`) para o cliente completar com funcionários e horas e treinar a previsão.

### 31. Aceitar planilhas `.xlsx` direto
Hoje o serviço pede para salvar como CSV. Ler o `.xlsx` evitaria esse passo.

### 32. Novas análises e módulo de gestão de processos
A página Análise foi pensada para crescer: novas funcionalidades entram como abas. O módulo de gestão de processos aparece como "em breve" na página inicial. Os indicadores podem ganhar filtro por período e por projeto, e uma barra de Planejamento (definindo o que ela conta).

### 33. Melhorias do modelo de previsão
Tratamento de valores atípicos, divisão em treino e teste, comparação de modelos e seleção automática de entradas.

### 34. Regras do fluxo a decidir
(a) Deixar o Superior destravar uma etapa quando a pessoa responsável faltar. (b) Bloquear a conclusão do projeto enquanto houver demanda pendente, em vez de encerrá-las. (c) Escolher entre "Operação" e "Fabricação" como nome único da etapa na tela, no banco, na landing e na documentação (hoje o README e a landing usam "Operação").

### 35. Dependências do profile-service
Atualizado o `package.json` (sem `audit`, `fix` e `s3-request-presigner`, com `multer` 2.x). Falta regenerar o `package-lock.json` com `npm install` dentro de `upload-profile/profile-service/`.

### 40. Builds reproduzíveis do serviço `pagamentos`
Commitar o `package-lock.json` do `pagamentos` e trocar o `npm install --omit=dev` do `Dockerfile` por `npm ci --omit=dev`, para que a versão do `stripe` (`^23.0.0`) seja a mesma no CI e em produção.