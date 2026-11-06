# Backlog — issues do repositório

> Cada bloco abaixo vira uma issue. O título é o título da issue, "Status" diz onde está, e "Pronto quando" vai como critério de aceite.
> **Feito (não testado)** significa que o código existe, mas ainda não foi validado de ponta a ponta. A issue 16 traz o roteiro de teste.
> Labels sugeridos: `atividade-10`, `atividade-11`, `backend`, `frontend`, `infra`, `regressao`, `seguranca`, `banco`.

---

## Atividade 10: negócio no ar

### 1. Papéis do plano: `professional`, `expert` e `admin`
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `seguranca`
Papéis cumulativos `professional < expert < admin` no `auth-service`, no `app` e no `pagamentos`. Todo usuário novo nasce `professional`; o `admin` só nasce por comando no banco. O `exigirNivel` bloqueia com `403` e registra `acesso_negado` no log.
**Pronto quando:** um `professional` que chama uma rota de Expert recebe `403`, e o evento aparece na consulta de logs do `admin`.

### 2. Categorias de usuário e processos fixos
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `frontend`
Cada usuário tem uma categoria (Superior, Planejador, Almoxarife, Operador, Montador), escolhida no cadastro, gravada em `usuarios.categoria` e levada no JWT (tokens antigos, sem o campo, valem como Superior). Os processos viram lista fixa: Planejamento, Almoxarifado, Fabricação e Montagem (o antigo "usinagem" vira "fabricacao"). Uma demanda só pode ser atribuída a quem tem a categoria do processo ou a um Superior.
**Pronto quando:** atribuir uma demanda de Montagem a um Almoxarife retorna `409` com mensagem clara; atribuir a um Montador ou a um Superior funciona.

### 3. Modelagem: projetos, itens e demandas
**Status:** Feito (não testado) · **Labels:** `atividade-10` `banco`
Tabelas `projetos`, `itens` (RG, quantidade, situação de consumo) e `demandas` (processo, responsável, status). Os scripts estão em `banco/01-schema.sql` (cria o que falta), `banco/02-migracao.sql` (atualiza um banco em uso) e `.github/ci/schema.sql` (cópia usada no CI).
**Pronto quando:** o banco de produção e o do CI têm as mesmas tabelas, com chaves estrangeiras para o usuário.

### 4. Telas de projetos, projeto, itens e demandas
**Status:** Feito (não testado) · **Labels:** `atividade-10` `frontend`
Lista de projetos em cartões; página do projeto com os dados no topo, a tabela de itens (RG, nome, quantidade e situação, com busca) e as demandas ao descer; página "Minhas demandas" com filtro por situação. Substitui o catálogo de filmes, a tier list e a dependência do TMDB.
**Pronto quando:** é possível criar um projeto, cadastrar itens e demandas e abrir tudo pela página do projeto.

### 5. Regras de acesso nas demandas
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `seguranca`
O filtro por usuário vem sempre do JWT validado, nunca do cliente. Cada pessoa vê as demandas em que é responsável; o dono do projeto vê as do projeto; a exclusão de demandas exige `expert` ou superior, e o botão bloqueado abre o convite para assinar.
**Pronto quando:** um `professional` não vê a demanda de outra pessoa nem exclui nenhuma (`403`), e um `expert` exclui as dos próprios projetos.

### 6. Consumo de itens na montagem
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend` `frontend`
Um item é concluído quando é consumido na montagem. O Montador (ou o dono do projeto) marca e desfaz o consumo na página do projeto, que mostra "Consumidas: x de y". A soma mensal desses itens é a "demanda" do histórico usado na previsão.
**Pronto quando:** um Montador com demanda no projeto marca um item como consumido; um Planejador recebe `403` ao tentar.

### 7. Identidade visual e redesenho da interface
**Status:** Feito (visual a validar) · **Labels:** `atividade-10` `frontend`
Paleta tirada do logo (bege pastel e bronze), CSS dividido em `tokens`, `base`, `componentes`, `layout`, `auth` e um arquivo por página, menu lateral montado por `js/layout.js`, página inicial com guia da interface, modais e notificações próprios.
**Pronto quando:** as telas são conferidas no navegador e os ajustes de cor e espaçamento são feitos nos arquivos de estilo.

### 8. Landing page pública
**Status:** Pendente · **Labels:** `atividade-10` `frontend`
A página inicial atual aparece só depois do login. Falta uma página pública com a dor, a proposta de valor e os dois planos, levando ao cadastro.
**Pronto quando:** a página abre sem login e tem botões para cadastrar e para entrar.

### 9. Publicar no mesmo domínio e na mesma stack do Portainer
**Status:** Em andamento · **Labels:** `atividade-10` `infra`
Apontar a stack existente para o repositório novo, sem criar stack nem subdomínio novos, com as imagens `atenas-*` e o serviço `regressao`. O `docker-compose.portainer.yml` já traz as variáveis de cada serviço.
**Pronto quando:** o domínio atual serve o Atenas SGE e o pipeline publica as imagens com o nome novo.

### 10. Log-service: ações do produto, nível e filtros
**Status:** Feito (não testado) · **Labels:** `atividade-10` `backend`
A lista fixa de ações foi trocada por validação de formato. O log aceita `nivel` (informação ou erro), filtros na consulta e limite de tamanho do histórico. Eventos em uso: `projeto_criado`, `item_cadastrado`, `demanda_criada`, `demanda_concluida`, `demanda_excluida`, `projeto_concluido`, `modelo_treinado`, `previsao_consultada`, `limite_plano_atingido`, `acesso_negado`, `assinatura_ativada`, `assinatura_cancelada`, `login` e `logout`.
**Pronto quando:** um evento de cada ação aparece na consulta do `admin`.

---

## Atividade 11: assinatura com Stripe e plano Expert

### 11. Plano Expert único no Stripe
**Status:** Feito (webhook a validar) · **Labels:** `atividade-11` `backend`
Um só preço (`STRIPE_PRICE_EXPERT`). O webhook muda o papel de `professional` para `expert`, e o cancelamento devolve a `professional`. Se o `auth-service` recusar a promoção, o evento `assinatura_ativada` não é registrado.
**Pronto quando:** o pagamento com o cartão de teste promove o usuário, o cancelamento no painel do Stripe o rebaixa, e o webhook responde `200`.

### 12. Limites de uso do plano Professional
**Status:** Feito (não testado) · **Labels:** `atividade-11` `backend` `frontend` `seguranca`
Até 3 projetos ativos, 50 itens por projeto e 20 demandas abertas, contados por conta. O que é concluído sai da contagem. Os valores ficam na constante `LIMITES` do `app/routes.js`. Ao estourar, a API responde `403` com `codigo: "limite_plano"` e o front abre o convite para assinar. Expert e `admin` não têm limite.
**Pronto quando:** um `professional` com 3 projetos ativos recebe `403` ao criar o quarto; ao concluir um, consegue criar outro; um `expert` cria sem limite.

### 13. Serviço de regressão: treino a partir de CSV
**Status:** Feito (testes escritos, ainda não executados nesta versão) · **Labels:** `atividade-11` `regressao` `backend`
Serviço interno em Python, sem porta pública, protegido por `INTERNAL_API_KEY`. Endpoints (todos via `app`, só `expert` e `admin`): prévia do CSV com sugestão de papel por coluna, treino (regressão linear múltipla por mínimos quadrados, com R², R² ajustado, MAE, RMSE, validação cruzada "deixa um de fora", coeficientes, importância e avisos), consulta do modelo, previsão e descarte. O modelo fica guardado por usuário na tabela `modelos_regressao`. Aceita CSV com `;`, `,` ou tabulação, decimal com vírgula ou ponto, UTF-8 ou ANSI, até 2 MB e 5.000 linhas, e recusa `.xlsx` com orientação. Há testes unitários e de API (`regressao/tests`) e o passo de teste no CI.
**Pronto quando:** o CI executa os testes do serviço e um `expert` treina com um CSV e recebe previsão; um `professional` recebe `403`.

### 14. Página Análise (previsão de equipe e carga da equipe)
**Status:** Feito (não testado) · **Labels:** `atividade-11` `frontend`
Substitui "Previsão de equipe". Abas: **Previsão de equipe** (envio do CSV, escolha de colunas no estilo Orange, aviso de carregamento durante o treino, métricas, coeficientes, gráfico real × previsto e formulário de previsão com a meta de itens e as horas planejadas) e **Carga da equipe** (demandas abertas por pessoa e por processo). Bloqueada para o `professional`, com a trava real no backend.
**Pronto quando:** um `expert` envia um CSV, escolhe as colunas, treina e prevê; um `professional` vê o bloqueio.

### 15. CI: testes, schema e Garage de teste
**Status:** Feito (a validar no pipeline) · **Labels:** `atividade-11` `infra`
Testes de cadastro, login, pagamentos e regressão ajustados ao papel `professional` e à nova API; schema do CI igual ao `banco/01-schema.sql`; passo que cria um `garage.toml` descartável, já que o real não é versionado.
**Pronto quando:** o pipeline passa de ponta a ponta, incluindo o serviço de regressão.

---

### 16. Roteiro de teste de ponta a ponta
**Status:** Pendente · **Labels:** `atividade-11` `infra`
1. Rodar `banco/01-schema.sql` e `02-migracao.sql` e subir tudo com `docker compose up --build`.
2. Cadastrar contas de cada categoria (Superior, Planejador, Almoxarife, Operador, Montador) e conferir a categoria no menu.
3. Como Superior: criar um projeto, cadastrar itens e criar demandas de cada processo; conferir o `409` ao atribuir a uma categoria errada.
4. Como Montador: ver o projeto da demanda, marcar um item como consumido e conferir "Consumidas".
5. Estourar os limites do Professional (4º projeto, 51º item, 21ª demanda) e ver o convite para assinar.
6. Assinar o Expert com o cartão de teste e conferir que o papel muda (sair e entrar de novo).
7. Em Análise: enviar um CSV (`;` e `,`), trocar as colunas, treinar com o aviso de carregamento, conferir as métricas e prever; testar um CSV inválido e um `.xlsx`.
8. Conferir os eventos no log como `admin`.
**Pronto quando:** todos os passos funcionam e os defeitos encontrados viram issues.

---

## Melhorias futuras

### 17. Convite de usuários pelo Superior
Hoje a categoria é escolhida no cadastro, e qualquer pessoa pode se cadastrar como Superior. O certo é o Superior convidar as pessoas e definir a categoria de cada uma, ligando-as à mesma conta.

### 18. Exportar o histórico mensal em CSV pelo app
Gerar, a partir do banco, a série mensal de itens consumidos (a "demanda") para o cliente completar com funcionários e horas e treinar a previsão.

### 19. Aceitar planilhas `.xlsx` direto
Hoje o serviço pede para salvar como CSV. Ler o `.xlsx` evitaria esse passo.

### 20. Novas análises e módulo de gestão de processos
A página Análise foi pensada para crescer: novas funcionalidades entram como abas. O módulo de gestão de processos aparece como "em breve" na página inicial.

### 21. Melhorias do modelo de previsão
Tratamento de valores atípicos, divisão em treino e teste, comparação de modelos e seleção automática de entradas.

### 22. Anexos de projeto no profile-service
Aceitar PDF e vários arquivos por projeto (desenho técnico, foto da peça), com outra chave de objeto e uma tabela de anexos.

### 23. Limpeza do projeto antigo no banco
Quando o projeto dos filmes sair do ar: remover as tabelas `favoritos`, `comentarios`, `tier_list` e a antiga `processos`, e a coluna `demandas.processo_id`.

### 24. Dependências do profile-service
Atualizado o `package.json` (sem `audit`, `fix` e `s3-request-presigner`, com `multer` 2.x). Falta regenerar o `package-lock.json` com `npm install` dentro de `upload-profile/profile-service/`.
