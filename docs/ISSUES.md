# Backlog — issues do repositório

> Cada bloco abaixo vira uma issue. O título é o título da issue, "Status" diz onde está, e "Pronto quando" vai como critério de aceite.
> **Feito (não testado)** significa que o código existe, mas ainda não foi validado de ponta a ponta. A issue 25 traz o roteiro de teste.
> A numeração mudou em relação à versão anterior deste arquivo (o consumo de itens foi substituído pelo fluxo da demanda, e entraram as issues de multi-tenancy).
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

### 3. Modelagem: projetos e demandas
**Status:** Feito (não testado) · **Labels:** `atividade-10` `banco`
Tabela `projetos` e tabela `demandas`, que **unifica o antigo item e a demanda**: RG, material, quantidade e `etapa_atual` (`almoxarifado`, `operacao`, `montagem`, `finalizada`), com os responsáveis de cada etapa (`planejador_id`, `almoxarife_id`, `operador_id`, `montador_id`), `finalizado_em` e a exclusão lógica (`excluida_em`, `excluida_por`). As colunas novas estão no `banco/04-demandas-excluidas.sql`. A tabela `itens` foi removida.
**Pronto quando:** o banco de produção e o do CI têm as mesmas tabelas e colunas (depende da issue 21).

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
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend`
A lista fixa de ações foi trocada por validação de formato. O log aceita `nivel` (informação ou erro), filtros na consulta e limite de tamanho do histórico. Eventos que a API registra hoje: `projeto_criado`, `projeto_editado`, `projeto_excluido`, `projeto_concluido`, `demanda_criada`, `demanda_editada`, `demanda_excluida`, `demanda_concluida`, `modelo_treinado`, `previsao_consultada`, `limite_plano_atingido` e `acesso_negado`; `assinatura_ativada`, `assinatura_cancelada`, `login` e `logout` vêm dos serviços de pagamento e autenticação.
**Pronto quando:** um evento de cada ação aparece na consulta do `admin`.

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
Testes de cadastro, login, pagamentos e regressão ajustados ao papel `professional` e à nova API; schema do CI igual ao `banco/01-schema.sql`; passo que cria um `garage.toml` descartável, já que o real não é versionado. As mudanças recentes na API de projetos e demandas ainda não têm testes automatizados (veja a issue 25).
**Pronto quando:** o pipeline passa de ponta a ponta, incluindo o serviço de regressão.

---

## Pendente para atender os requisitos de SaaS multi-tenant

### 16. Isolamento entre contas: organizações e filtro por dono em toda consulta
**Status:** Pendente (**crítica**) · **Labels:** `saas` `multi-tenancy` `backend` `banco` `seguranca`
**O que está errado hoje (verificado no `routes.js`):** não existe o conceito de organização. `GET /projetos` devolve todos os projetos do banco; `GET /projetos/:id` devolve qualquer projeto e as demandas dele a quem estiver logado (só a escrita confere o dono); a fila de Almoxarife, Operador e Montador junta as demandas de todas as contas; o Planejador cria demanda em projeto de outra conta; e avançar uma demanda não confere de quem ela é. Trocar o ID na URL entrega o registro de outra empresa.
**O que fazer:**
- Criar a tabela `organizacoes` e a coluna `organizacao_id` em `usuarios`, `projetos` e `demandas` (na demanda, repetida de propósito, para nenhuma consulta esquecer o `JOIN`).
- Levar `organizacao_id` no JWT (o `auth-service` o coloca no token) e usar **sempre** esse valor, nunca um vindo do cliente.
- Toda consulta e toda ação filtra por `organizacao_id`: listas, detalhe, edição, exclusão, avançar, fila, indicadores, análise e logs.
- Registro de outra organização responde `404` (e não `403`, para não revelar que o ID existe).
- Registrar `organizacao_id` nos eventos do log.
- Decidir e documentar de quem é o plano (proposta: da organização, com os membros herdando o papel; o Stripe cobra a organização).
**Pronto quando:** um usuário da organização B recebe `404` ao abrir, editar, excluir, concluir ou avançar qualquer projeto ou demanda da organização A pelo ID; as listas, a fila e os indicadores da B não trazem nada da A; e há teste automatizado cobrindo esses casos (issue 25).

### 17. Convite de usuários pelo Superior
**Status:** Pendente (depende da 16) · **Labels:** `saas` `multi-tenancy` `backend` `frontend` `seguranca`
Hoje a categoria é escolhida no cadastro, então qualquer pessoa pode se cadastrar como Superior e as permissões por categoria não protegem nada de verdade. O cadastro público passa a criar apenas um **Superior com uma organização nova**. As outras categorias entram por convite: o Superior informa e-mail e categoria, o sistema gera um link com validade e uso único, e quem se cadastra por ele entra já na organização e na categoria certas. Tela do Superior para listar, convidar e remover membros. Eventos `convite_enviado`, `convite_aceito` e `membro_removido` no log.
**Pronto quando:** o cadastro público não oferece mais a escolha de categoria; um convite vencido ou já usado é recusado; e um membro convidado como Montador não consegue virar Superior por chamada direta à API.

### 18. Anexo da demanda guardado no storage S3 (Garage)
**Status:** Pendente · **Labels:** `saas` `backend` `frontend` `infra` `banco`
Hoje o único upload é a foto de perfil. Falta um upload do negócio ligado ao registro certo: o Planejador anexa o **desenho técnico ou a foto da peça** à demanda. Nova tabela `anexos_demanda` (`id`, `demanda_id` com chave estrangeira, `organizacao_id`, nome original, chave do objeto, tipo, tamanho, quem enviou e quando), arquivo no bucket com chave que inclui a organização e a demanda, e a mesma validação de tipo e tamanho do upload de perfil (PDF, PNG e JPG). Listar, baixar e remover passam pelo `app`, que confere a organização antes de entregar o arquivo (nada de URL pública do bucket). Eventos `anexo_enviado` e `anexo_removido`. O storage usado no projeto é o Garage, compatível com S3 (a atividade menciona MinIO: confirmar com o professor que o Garage vale).
**Pronto quando:** o Planejador anexa um PDF a uma demanda e todos da organização o veem e baixam; um usuário de outra organização recebe `404` ao tentar baixá-lo pelo ID; e remover a demanda remove o anexo.

### 19. Landing page pública
**Status:** Pendente · **Labels:** `atividade-10` `saas` `frontend`
A página inicial atual aparece só depois do login. Falta uma página pública, sem login, com a dor, a proposta de valor, os dois planos e um botão para criar conta e outro para entrar.
**Pronto quando:** a página abre sem login em `/` e os botões levam ao cadastro e ao login.

### 20. Publicar no mesmo domínio e na mesma stack do Portainer
**Status:** Em andamento (a conferir) · **Labels:** `atividade-10` `infra`
Apontar a stack existente para o repositório novo, sem criar stack nem subdomínio novos, com as imagens `atenas-*` e o serviço `regressao`, fazendo pull e redeploy. O `docker-compose.portainer.yml` já traz as variáveis de cada serviço. Remover da stack as variáveis que não servem mais (chave do TMDB, ligada à issue 22) e incluir as novas.
**Pronto quando:** o domínio atual serve o Atenas SGE, todos os containers estão rodando e saudáveis, e o pipeline publica as imagens com o nome novo.

### 21. Scripts de banco reproduzíveis
**Status:** Pendente · **Labels:** `saas` `banco` `infra`
Hoje quem clona o repositório não consegue recriar o banco sem conhecer a ordem dos scripts: o `02-migracao.sql` ainda tem comandos obsoletos (`ALTER TABLE itens`, `UPDATE demandas SET atividade`), há um script que apaga e recria `demandas` (destrutivo se rodado num banco com dados), e o `04-demandas-excluidas.sql` acrescenta colunas depois. Consolidar num script versionado (por exemplo `banco/001_dominio.sql`) que cria do zero `organizacoes`, `usuarios` (com `categoria` e `organizacao_id`), `projetos`, `demandas`, `anexos_demanda` e `modelos_regressao`, com chaves estrangeiras e índices, mais um script de seed com uma organização de exemplo e um usuário de cada categoria. Manter a migração só para bancos já em uso, sem comandos destrutivos, e deixar o `.github/ci/schema.sql` idêntico ao script de criação.
**Pronto quando:** num banco vazio, rodar o script de criação e o de seed e subir a stack deixa o sistema funcionando; e o banco do CI tem exatamente as mesmas tabelas.

### 22. Limpeza do projeto antigo (nada de filmes)
**Status:** Pendente · **Labels:** `atividade-10` `saas` `banco` `infra`
A API já não tem referência a filmes, mas falta o resto: remover do banco as tabelas `favoritos`, `comentarios`, `tier_list` e a antiga `processos` (hoje só comentadas na migração); remover a chave do TMDB do `.env`, do `env.example`, dos arquivos de compose, do CI e da stack do Portainer; e procurar nos demais serviços, nas páginas, nos textos e nos assets por termos como filme, stalker, tier list e TMDB. O histórico continua no git.
**Pronto quando:** uma busca por esses termos no repositório não encontra nada fora do histórico, e a stack não tem mais a variável do TMDB.

### 23. Log: passagens de etapa e eventos novos
**Status:** Pendente · **Labels:** `saas` `backend`
Hoje só a finalização gera `demanda_concluida`; as passagens Almoxarifado → Operação e Operação → Montagem não deixam rastro, e o Planejador que volta a demanda a um processo anterior também não. Registrar `demanda_avancada` a cada passagem, com a etapa de origem e a de destino, e incluir o processo novo na edição. Somar os eventos das issues 16, 17 e 18 (`organizacao_id`, convites e anexos). Confirmar que login, logout e erros continuam sendo registrados pelo `auth-service` e pela API.
**Pronto quando:** uma demanda que percorre o fluxo inteiro deixa na consulta do `admin` um evento por etapa, com quem fez e quando.

### 24. Documentação das rotas (Swagger) — extra
**Status:** Pendente (opcional) · **Labels:** `saas` `backend`
Documentar no Swagger as rotas de projetos, demandas, indicadores, análise e convites, com os códigos `403` e `404` de cada uma.
**Pronto quando:** a página da documentação lista todas as rotas novas e permite testá-las com um usuário logado.

### 25. Roteiro de teste de ponta a ponta e testes automatizados de isolamento
**Status:** Pendente · **Labels:** `atividade-11` `saas` `infra` `seguranca`
1. Recriar o banco do zero com os scripts da issue 21 e subir tudo com `docker compose up --build`.
2. **Organização A:** cadastrar um Superior e convidar um Planejador, um Almoxarife, um Operador e um Montador; conferir a categoria de cada um no menu.
3. **Superior:** criar, editar e concluir um projeto; conferir que o menu não mostra "Minhas demandas" e que criar demanda dá `403`.
4. **Planejador:** cadastrar uma demanda, editá-la (inclusive trocando o processo), anexar um arquivo, excluí-la e achá-la na aba Excluídas; conferir que criar projeto dá `403`.
5. **Fluxo:** Almoxarife, Operador e Montador avançam a demanda até Finalizada; conferir `finalizado_em` no banco e um evento por etapa no log.
6. **Concluir e excluir projeto** com demandas pendentes: ver o aviso, e conferir que a API recusa sem confirmação.
7. **Isolamento:** cadastrar uma organização B e, com o ID de um projeto, de uma demanda e de um anexo da A, tentar abrir, editar, excluir, avançar e baixar: tudo deve dar `404`, e as listas, a fila e os indicadores da B não devem trazer nada da A. Repetir com chamadas diretas à API, sem a tela.
8. **Limites:** estourar o 4º projeto ativo e a 51ª demanda aberta e ver o convite para assinar.
9. **Expert:** assinar com o cartão de teste (sair e entrar de novo), treinar e prever em Análise com um CSV (`;` e `,`), testar um CSV inválido e um `.xlsx`, abrir Indicadores e imprimir.
10. Conferir os eventos no log como `admin`.
Transformar os passos 3, 4, 5 e 7 em testes automatizados no CI.
**Pronto quando:** todos os passos funcionam, o CI executa os testes de isolamento e os defeitos encontrados viram issues.

---

## Melhorias futuras

### 26. Restaurar demandas excluídas
A aba Excluídas hoje é só consulta. Permitir restaurar, conferindo o limite do plano Professional na hora.

### 27. Exportar o histórico mensal em CSV pelo app
Gerar, a partir do banco, a série mensal de quantidades de demandas finalizadas pela Montagem (`finalizado_em`) para o cliente completar com funcionários e horas e treinar a previsão.

### 28. Aceitar planilhas `.xlsx` direto
Hoje o serviço pede para salvar como CSV. Ler o `.xlsx` evitaria esse passo.

### 29. Novas análises e módulo de gestão de processos
A página Análise foi pensada para crescer: novas funcionalidades entram como abas. O módulo de gestão de processos aparece como "em breve" na página inicial. Os indicadores podem ganhar filtro por período e por projeto, e uma barra de Planejamento (definindo o que ela conta).

### 30. Melhorias do modelo de previsão
Tratamento de valores atípicos, divisão em treino e teste, comparação de modelos e seleção automática de entradas.

### 31. Regras do fluxo a decidir
(a) Deixar o Superior destravar uma etapa quando a pessoa responsável faltar. (b) Bloquear a conclusão do projeto enquanto houver demanda pendente, em vez de encerrá-las. (c) Escolher entre "Operação" e "Fabricação" como nome único da etapa na tela, no banco e na documentação.

### 32. Dependências do profile-service
Atualizado o `package.json` (sem `audit`, `fix` e `s3-request-presigner`, com `multer` 2.x). Falta regenerar o `package-lock.json` com `npm install` dentro de `upload-profile/profile-service/`.
