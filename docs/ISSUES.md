# Backlog — issues do repositório

> Cada bloco abaixo vira uma issue. O título é o título da issue, "Status" diz onde está, e "Pronto quando" vai como critério de aceite.
> **Feito (não testado)** significa que o código existe, mas ainda não foi validado de ponta a ponta. A issue 25 traz o roteiro de teste.
> A numeração mudou em relação à versão anterior deste arquivo (o consumo de itens foi substituído pelo fluxo da demanda, e entraram as issues de multi-tenancy).
> **Verificado** quer dizer que foi coberto por um teste de integração (API real contra MariaDB 10.11, auth-service simulado). Esse teste ainda não está no CI (issue 25).
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
**Pronto quando:** o banco de produção e o do CI têm as mesmas tabelas e colunas (falta deixar o `.github/ci/schema.sql` igual ao `db/001_dominio.sql`).

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
A lista fixa de ações foi trocada por validação de formato. O log aceita `nivel` (informação ou erro), filtros na consulta e limite de tamanho do histórico. Eventos que a API registra, sempre com quem fez e a empresa (`org=` no detalhe): `empresa_criada`, `membro_cadastrado`, `codigo_empresa_renovado`, `projeto_criado`, `projeto_editado`, `projeto_excluido`, `projeto_concluido`, `demanda_criada`, `demanda_editada`, `demanda_excluida`, **`demanda_avancada`** (uma por passagem de etapa, com `de` e `para`), **`demanda_redirecionada`** (o Planejador destina a demanda a outro processo), `demanda_concluida`, `modelo_treinado`, `previsao_consultada`, `limite_plano_atingido` e `acesso_negado`; `assinatura_ativada`, `assinatura_cancelada`, `login` e `logout` vêm dos serviços de pagamento e autenticação.
**Pronto quando:** um evento de cada ação aparece na consulta do `admin`, e uma demanda que percorre o fluxo inteiro deixa um `demanda_avancada` por etapa.

### 11. Plano Expert único no Stripe
**Status:** Feito (webhook a validar) · **Labels:** `atividade-11` `backend`
Um só preço (`STRIPE_PRICE_EXPERT`). O webhook muda o papel de `professional` para `expert`, e o cancelamento devolve a `professional`. Se o `auth-service` recusar a promoção, o evento `assinatura_ativada` não é registrado.
**Pronto quando:** o pagamento com o cartão de teste promove o usuário, o cancelamento no painel do Stripe o rebaixa, e o webhook responde `200`.

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
Testes de cadastro, login, pagamentos e regressão ajustados ao papel `professional` e à nova API; o schema do CI deve ser igual ao `db/001_dominio.sql` (veja a issue 21); passo que cria um `garage.toml` descartável, já que o real não é versionado. Os testes de projetos, demandas, empresas e isolamento existem como teste de integração fora do CI (veja a issue 25).
**Pronto quando:** o pipeline passa de ponta a ponta, incluindo o serviço de regressão.

---

## Requisitos de SaaS multi-tenant

### 16. Isolamento entre empresas
**Status:** Feito (verificado) · **Labels:** `saas` `multi-tenancy` `backend` `banco` `seguranca`
Cada usuário pertence a uma empresa (`usuarios.organizacao_id`), e projetos e demandas carregam o mesmo `organizacao_id`. A empresa é lida **do banco** a cada requisição (nunca do cliente), conta sem empresa é barrada (`403`), e toda consulta e ação filtra por ela: projetos, demandas, fila, indicadores e perfis. ID de outra empresa responde `404`. O `organizacao_id` entra no detalhe de cada evento do log.
**Pronto quando:** um usuário da empresa B recebe `404` ao abrir, editar, excluir, concluir ou avançar qualquer projeto ou demanda da empresa A (coberto no teste de integração: 80 verificações, nenhuma falha), **e** o mesmo teste passa no CI (issue 25).

### 17. Cadastro com empresa e código da empresa
**Status:** Feito (verificado na API e no formulário) · **Labels:** `saas` `multi-tenancy` `backend` `frontend` `seguranca`
O cadastro recebe o nome da empresa. O **Superior** cria a empresa (nome único, sem diferenciar maiúsculas) e é o dono dela. Planejador, Almoxarife, Operador e Montador informam o nome **e o código** da empresa, que o Superior vê e renova no botão *Equipe* da lista de projetos (`GET /api/organizacao` e `POST /api/organizacao/codigo`). Nome ou código errado responde `403` com a mesma mensagem (não revela se a empresa existe). A empresa é criada antes de chamar o `auth-service` e desfeita se o cadastro falhar. Limite de 10 tentativas por minuto contra adivinhação de código. Isso substitui o convite por e-mail, que passou para as melhorias futuras.
O formulário de cadastro pede o **nome da empresa** (sempre) e o **código da empresa** (só quando a categoria não é Superior; o campo aparece e some conforme a categoria escolhida) e envia `empresa` e `codigo_empresa` em `POST /api/auth/cadastro`.
**Pronto quando:** o cadastro pelo formulário, no ambiente real, cria a empresa do Superior e só deixa um Planejador entrar com nome e código certos (a API e o formulário já foram verificados separadamente).

### 18. Anexo de demanda
**Status:** Dispensada · **Labels:** `saas` `backend` `frontend`
O requisito de upload ligado ao domínio é atendido pelo perfil corporativo (foto e bio, no storage S3). O anexo por demanda (desenho técnico, foto da peça) fica nas melhorias futuras.

### 19. Landing page pública
**Status:** Feito (confirmado) · **Labels:** `atividade-10` `saas` `frontend`

### 20. Publicar no mesmo domínio e na mesma stack do Portainer
**Status:** Feito (confirmado) · **Labels:** `atividade-10` `infra`
Falta apenas rodar `db/001_dominio.sql` no banco de produção **antes** de subir esta versão da API: ela exige `organizacao_id`.

### 21. Scripts de banco reproduzíveis
**Status:** Feito (verificado) · **Labels:** `saas` `banco` `infra`
`db/001_dominio.sql` cria do zero e atualiza um banco em uso (idempotente, sem comandos destrutivos). Num banco com dados, as contas existentes entram numa "Empresa de teste (legado)". `db/002_seed.sql` cria duas empresas de exemplo e não duplica se rodar de novo. Testados em banco novo, em banco legado e repetindo a execução. Os scripts antigos de `banco/` não devem mais ser usados.
**Pronto quando:** o `.github/ci/schema.sql` é idêntico ao `db/001_dominio.sql` e o CI passa com ele.

### 22. Limpeza do projeto antigo (nada de filmes)
**Status:** Feito (confirmado) · **Labels:** `atividade-10` `saas` `banco` `infra`

### 23. Log das movimentações
**Status:** Feito (verificado) · **Labels:** `saas` `backend`
Cada passagem de etapa registra `demanda_avancada` (de → para, com quem fez e a empresa), e o Planejador que destina a demanda a outro processo registra `demanda_redirecionada`. A finalização continua registrando também `demanda_concluida`.
**Falta conferir:** que `login`, `logout` e erros continuam sendo registrados pelo `auth-service` e pela API.

### 24. Documentação das rotas (Swagger) — extra
**Status:** Pendente (opcional) · **Labels:** `saas` `backend`
Documentar no Swagger as rotas de projetos, demandas, empresa, indicadores e análise, com os códigos `403` e `404` de cada uma.

### 25. Roteiro de teste de ponta a ponta e testes de isolamento no CI
**Status:** Parcial · **Labels:** `atividade-11` `saas` `infra` `seguranca`
O teste de integração de isolamento, papéis, cadastro e log existe (API real contra MariaDB, auth-service simulado, 80 verificações) e passou, mas ainda não está no CI. Falta levá-lo ao pipeline e executar o roteiro no ambiente real:
1. Rodar `db/001_dominio.sql` e `db/002_seed.sql` e subir tudo com `docker compose up --build`.
2. Cadastrar pelo formulário um Superior (criando a empresa) e as demais categorias com o código; conferir categoria e empresa no menu.
3. **Superior:** criar, editar e concluir um projeto; conferir que o menu não mostra "Minhas demandas" e que criar demanda dá `403`.
4. **Planejador:** cadastrar, editar (inclusive trocando o processo), excluir e achar a demanda na aba Excluídas; criar projeto dá `403`.
5. **Fluxo:** Almoxarife, Operador e Montador avançam até Finalizada; conferir `finalizado_em` e um `demanda_avancada` por etapa no log.
6. **Concluir e excluir projeto** com demandas pendentes: ver o aviso, e conferir que a API recusa sem confirmação.
7. **Isolamento:** com duas empresas, tentar abrir, editar, excluir e avançar IDs da outra, pela tela e por chamada direta à API: tudo deve dar `404`.
8. **Limites:** estourar o 4º projeto ativo e a 51ª demanda aberta e ver o convite para assinar.
9. **Expert:** assinar com o cartão de teste (sair e entrar de novo), treinar e prever em Análise, abrir Indicadores e imprimir.
10. Conferir os eventos no log como `admin`.
**Pronto quando:** todos os passos funcionam no ambiente real e o CI executa os testes de isolamento.

### 26. Plano por empresa
**Status:** Decisão pendente · **Labels:** `saas` `multi-tenancy` `backend`
Hoje o plano (Professional/Expert) é da conta, e os limites do Professional contam por conta. Como a empresa é quem paga, o mais coerente é o plano ser da empresa, com os membros herdando o papel (o Stripe cobraria a empresa). Hoje, se o Superior assina o Expert, o Planejador da mesma empresa continua Professional.

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
(a) Deixar o Superior destravar uma etapa quando a pessoa responsável faltar. (b) Bloquear a conclusão do projeto enquanto houver demanda pendente, em vez de encerrá-las. (c) Escolher entre "Operação" e "Fabricação" como nome único da etapa na tela, no banco e na documentação.

### 35. Dependências do profile-service
Atualizado o `package.json` (sem `audit`, `fix` e `s3-request-presigner`, com `multer` 2.x). Falta regenerar o `package-lock.json` com `npm install` dentro de `upload-profile/profile-service/`.