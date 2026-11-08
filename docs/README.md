# Atenas SGE — Software de Gestão Empresarial

> Valores marcados com *(hipótese)* são dados mockados ou estimativas a validar com uma empresa real.

**Atenas SGE é o software de gestão empresarial em que pequenas indústrias cadastram projetos e as demandas dos processos de Almoxarifado, Operação (fabricação) e Montagem num só lugar, e preveem a equipe necessária com base no próprio histórico.**

---

## 1. A dor

**Quem sofre:** o gestor de produção (gerente, encarregado, chefe de setor) de uma empresa industrial pequena, e o funcionário que recebe as demandas.

**Quando:** todo dia, na distribuição das tarefas entre os processos (planejamento, almoxarifado, fabricação e montagem), e todo mês, quando é preciso decidir quantas pessoas alocar para a meta de itens a concluir.

**Quanto custa hoje** *(hipótese)*:

- **Sobrecarga (a dor central):** a demanda chega sem filtro e cai sempre nos mesmos funcionários, porque o gestor não enxerga a carga de cada um. O resultado é cansaço, erro, retrabalho e risco de afastamento ou saída da pessoa.
- **Tempo:** o gestor gasta horas por semana consolidando planilhas e conferindo com o chão de fábrica o que está pendente.
- **Dinheiro:** sem saber quantos funcionários a meta do mês exige, a empresa alterna hora extra num mês e ociosidade em outro.
- **Risco:** informação faltando compromete a decisão (o gestor não vê o todo) e informação demais atrapalha a operação (o funcionário se perde no que não é dele).

**Como se resolve hoje:** planilhas em Excel, quadro de papel, mensagens de WhatsApp e memória do encarregado. Cada processo tem seu controle e nenhum se conversa. O histórico existe, mas parado numa planilha, sem virar decisão.

## 2. Persona

**Carlos Mendes, 42 anos, encarregado de produção** de uma metalúrgica com cerca de 25 funcionários *(fictício)*.

Ele começa o dia anotando num caderno as demandas de cada processo e depois passa tudo para uma planilha que só ele entende. No fim do mês, decide de cabeça quantas pessoas colocar para a meta seguinte, e às vezes erra para mais ou para menos, embora tenha guardado, em Excel, o histórico de funcionários, itens concluídos e horas de vários meses. O funcionário pergunta a ele o que fazer porque não tem onde consultar. As demandas chegam sem filtro e acabam sempre nos mesmos operadores, porque ele não enxerga a carga de cada um. O que atrapalha: nenhum sistema mostra o projeto e quem está com cada demanda no mesmo lugar, e os sistemas de gestão (ERP/MES) que conhece são caros e pesados para o tamanho da empresa.

**Persona secundária, o montador:** Marcos, 28 anos, montador. Só precisa saber qual é a demanda dele hoje, de qual projeto, e registrar quando ela foi finalizada na montagem.

## 3. Concorrentes e alternativas

| Alternativa | O que faz mal para essa persona |
|---|---|
| Planilha (Excel / Google Sheets) | Cada setor tem a sua, sem controle de quem vê o quê, sem alerta e sem previsão. O histórico fica parado, e um erro de digitação passa despercebido. |
| Quadro de papel e WhatsApp | Não deixa histórico, as informações se perdem e o funcionário vê (ou perde) mensagens que não são dele. |
| Trello / Asana | Genéricos: não têm o conceito de projeto com demandas de itens (RG, material, quantidade) nem de processo produtivo, e não indicam quantos funcionários alocar. |
| ERP / MES (ex.: TOTVS, SAP) | Caros, com implantação longa, muita informação em cada tela e exigem equipe de TI. Excessivos para uma operação pequena. |

## 4. Proposta de valor

**Para a pequena indústria, o Atenas SGE reúne projetos e demandas num só lugar, com acesso por categoria e por processo, e no plano Expert transforma o histórico do próprio cliente (um CSV do Excel) numa previsão de quantos funcionários a meta do mês exige e em indicadores da produção, evitando a sobrecarga da equipe, sem o custo e a complexidade de um ERP.**

## 5. Modelo de receita com Stripe

O plano **é** o papel do usuário: pagar o Expert muda o papel, e o middleware de acesso passa a liberar os recursos. O papel só muda quando o **webhook** do Stripe confirma o pagamento.

**O CRUD de projetos e demandas é gratuito**: cadastrar, editar e excluir não dependem de plano, só da categoria da pessoa (seção 8). O que se paga é a análise.

| | **Professional** | **Expert** |
|---|---|---|
| Preço | Grátis | R$ 149/mês por conta |
| Cadastrar, editar e excluir projetos e demandas (conforme a categoria) | Sim | Sim |
| Ver a fila da própria etapa e avançar demandas | Sim | Sim |
| Projetos ativos ao mesmo tempo *(hipótese)* | Até 3 | Sem limite |
| Demandas abertas ao mesmo tempo *(hipótese)* | Até 50 | Sem limite |
| **Análise:** previsão de equipe (regressão linear múltipla treinada com o histórico em CSV) | Não | Sim |
| **Análise:** indicadores (demandas por processo e concluídas × pendentes, com impressão) | Não | Sim |

**Por que alguém pagaria o Expert:** o Professional resolve o registro e o fluxo, mas o limite de 3 projetos ativos aperta quando a operação cresce, e só o Expert ajuda a decidir (previsão de equipe) e a acompanhar (indicadores). A previsão evita hora extra e sobrecarga, e o custo mensal tem que ser menor que uma hora extra evitada *(hipótese a validar)*.

**Funil:** o Professional já organiza o dia a dia e gera o histórico: cada demanda finalizada pela Montagem grava a data de finalização, e a soma das quantidades por mês é a "demanda" usada na previsão. Quando o cliente quer decidir a equipe, o Expert aproveita o histórico que ele já tem. Os limites do Professional contam só projetos e demandas **ativos**: o que é concluído ou excluído sai da contagem.

### Como a previsão de equipe funciona

É uma **regressão linear múltipla**, treinada com o histórico do próprio cliente, no estilo de ferramentas como o Orange:

1. **Dados:** o usuário envia um CSV exportado do Excel, uma linha por período (por exemplo, um mês). Colunas esperadas: **número de funcionários**, **demanda** (soma das quantidades das demandas finalizadas pela Montagem no período) e **tempo total de realização** (em horas). Outras colunas podem ficar no arquivo.
2. **Colunas:** uma tela mostra as primeiras linhas, e o usuário escolhe o papel de cada coluna: **alvo** (o que será previsto, o nº de funcionários), **entrada** ou **ignorar**.
3. **Treino:** o app avisa que está carregando enquanto o modelo é treinado. O resultado mostra R², R² ajustado, erro médio (MAE), RMSE, erro em validação cruzada ("deixa um de fora"), os coeficientes com a importância de cada entrada e um gráfico real × previsto. Há avisos quando as linhas são poucas, o ajuste é fraco ou as entradas são muito correlacionadas.
4. **Previsão:** com o modelo treinado, o usuário informa o que está planejado para o mês (a meta de itens a concluir e as horas planejadas) e recebe o número de funcionários necessário, arredondado para cima. Se um valor estiver fora do intervalo do histórico, a tela avisa que a previsão é menos confiável.

O modelo fica guardado por usuário, então a previsão está disponível sem treinar de novo, e pode ser retreinado ou descartado. O serviço aceita CSV com separador `;`, `,` ou tabulação, decimal com vírgula ou ponto e codificação UTF-8 ou ANSI.

### Como os indicadores funcionam

Segunda aba da página Análise (só Expert). Mostra dois gráficos, desenhados em SVG (sem biblioteca externa) para sair nítidos no papel:

- **Demandas por processo** (barras verticais): quantas demandas estão agora em Almoxarifado, Operação e Montagem.
- **Concluídas × pendentes** (pizza): demandas finalizadas contra as que ainda estão em algum processo.

O botão **Imprimir** usa a impressão do navegador, com um estilo próprio: some o menu e saem só o cabeçalho (com data e quem emitiu) e os gráficos. Demandas excluídas não entram na conta.

## 6. Métricas de sucesso

- **Contas cadastradas** e quantas ativas por semana.
- **Conversão** de Professional para Expert.
- **Assinantes Expert** e **MRR** (receita recorrente mensal).
- **Retenção** mensal dos assinantes Expert.
- **Modelos treinados por conta Expert** e quantas previsões são consultadas por mês.
- **Qualidade da previsão:** R² e erro em validação cruzada dos modelos treinados, e o erro entre a equipe prevista e a realmente usada.
- **Sobrecarga:** horas extras por funcionário e demandas simultâneas por pessoa, antes e depois de usar o sistema.

## 7. Lean Canvas

| Bloco | Atenas SGE |
|---|---|
| **Problema** | 1) Demandas espalhadas em planilha, papel e WhatsApp. 2) O gestor não sabe quantas pessoas alocar para a meta do mês, embora tenha o histórico guardado. 3) A demanda sobrecarrega os funcionários, que ainda recebem informação demais ou de menos. Hoje: planilha e memória. |
| **Segmentos de clientes** | Empresas industriais pequenas com os processos de planejamento, almoxarifado, fabricação e montagem. Primeiros adotantes: gestores e encarregados sem ERP. |
| **Proposta única de valor** | Gestão de demandas simples, com acesso por categoria e processo, e previsão de equipe treinada com o histórico do próprio cliente, sem a complexidade de um ERP. |
| **Solução** | 1) Projetos e demandas (RG, material, quantidade) que percorrem Almoxarifado, Operação e Montagem, com cada pessoa vendo a fila da sua etapa. 2) Categorias de usuário ligadas aos processos: cada pessoa vê e faz só o necessário. 3) Análise (Expert): previsão de equipe por regressão treinada com o CSV do cliente e indicadores da produção. |
| **Canais** | Visitas a pequenas indústrias da região, indicação entre gestores, landing page. |
| **Fontes de receita** | Assinatura mensal Expert via Stripe. O plano Professional é a porta de entrada. |
| **Estrutura de custos** | Infraestrutura (mesma stack), taxas do Stripe, tempo de desenvolvimento e suporte. |
| **Métricas-chave** | Contas ativas, conversão para Expert, MRR, retenção, modelos treinados, qualidade da previsão. |
| **Vantagem injusta** | O histórico do cliente dentro do sistema: quanto mais ele usa, melhor a previsão e mais caro é sair. Conhecimento do chão de fábrica da região. |

## 8. Planos, categorias e permissões

### 8.1 Planos (papéis)

Os papéis do plano são **cumulativos**: cada um faz o que o anterior faz, mais o que é seu. O plano decide **limites e recursos de análise**, não o CRUD.

| Papel | Quem é | Pode fazer |
|---|---|---|
| `professional` | Todo usuário novo (plano gratuito) | O que a sua categoria permite (8.2), dentro dos limites do plano |
| `expert` | Assinante do plano pago | Tudo do Professional **+** Análise (previsão de equipe e indicadores), sem limites de uso |
| `admin` | Administrador do produto, usado para testar rotas | Tudo do Expert, mais a consulta de logs. Não é vendável, não aparece na página de planos e só nasce por comando no banco |

### 8.2 Categorias de usuário (papéis do negócio)

Cada usuário tem uma **categoria**, mostrada no menu. As permissões valem **na API** (ação proibida responde `403` mesmo por chamada direta) e a tela só esconde o que a pessoa não pode fazer.

| Categoria | O que faz | Onde trabalha |
|---|---|---|
| **Superior** | Cadastra, edita, exclui e conclui **projetos**. Não mexe em demandas e não tem fila. | Projetos |
| **Planejador** | Cadastra, edita e exclui **demandas** (a exclusão move para a aba *Excluídas*) e pode destinar a demanda a outro processo. | Página do projeto |
| **Almoxarife** | Conclui a etapa Almoxarifado e envia a demanda para a Operação. | Minhas demandas |
| **Operador** | Conclui a etapa Operação (fabricação) e envia para a Montagem. | Minhas demandas |
| **Montador** | Conclui a Montagem: a demanda fica **Finalizada**. | Minhas demandas |

**Fluxo da demanda:** o Planejador cadastra (RG, material, quantidade) e ela entra no **Almoxarifado**, depois **Operação**, depois **Montagem**, depois **Finalizada**. Cada etapa só é avançada pela categoria dona dela.

Regras:

- Só o Planejador que criou a demanda a edita ou exclui, e só enquanto ela não está finalizada.
- Demandas excluídas saem da fila, do projeto, das contagens e do limite do plano. Elas ficam na aba *Excluídas* da página do projeto, visível só ao Planejador que as excluiu.
- Só o Superior que criou o projeto o edita, exclui ou conclui.
- **Concluir ou excluir um projeto** com demandas que a Montagem ainda não concluiu abre um aviso pedindo confirmação. Ao concluir, as pendentes são encerradas sem passar pela Montagem e **não** entram na "demanda do mês" da previsão. Ao excluir, as demandas do projeto são apagadas junto.
- A página *Minhas demandas* existe só para Almoxarife, Operador e Montador. Superior e Planejador não a veem.

### 8.3 Isolamento entre contas (multi-tenancy)

**Regra do produto:** cada empresa (organização) só enxerga e altera os próprios dados. Isso precisa valer na API: trocar o ID na URL não pode devolver o registro de outra empresa.

**Situação atual: ainda não implementada** (issue 16). Hoje não existe o conceito de organização: cada usuário é uma conta solta, a lista de projetos mostra todos os projetos do banco, qualquer pessoa autenticada abre o projeto de outra pela URL, e a fila de cada etapa junta as demandas de todas as contas. O que já está protegido é a *escrita* sobre projetos e demandas (só o dono edita, exclui ou conclui).

**Desenho previsto:**

- Tabela `organizacoes`, com `organizacao_id` em `usuarios`, `projetos` e `demandas`, e a organização como claim do JWT.
- Toda consulta e toda ação filtra por `organizacao_id` vindo do JWT, nunca do cliente. Registro de outra organização responde `404`.
- Quem cria conta pelo cadastro público vira **Superior** de uma organização nova. As demais categorias só entram por **convite** do Superior (issue 17), o que também fecha a brecha atual de qualquer pessoa se cadastrar como Superior.
- Decisão em aberto: o plano (Professional/Expert) passa a ser da organização, e todos os membros herdam o papel do plano.

## 9. Mapa de reaproveitamento

| Peça do projeto anterior | O que vira no Atenas SGE |
|---|---|
| Catálogo de filmes (TMDB) | Recurso principal: **projetos** e **demandas** (RG, material, quantidade) que percorrem os processos. Já não há filmes nem chave do TMDB no código da API; a limpeza do banco e das variáveis está na issue 22 |
| Tier list dos stalkers | **Análise** (Expert): previsão de equipe por CSV e indicadores |
| Serviço e pasta `catalogo` | Renomeado para **`app`**: continua sendo o único serviço público e a porta de entrada dos demais serviços |
| Login + RBAC | Papéis do plano `professional` < `expert` < `admin` (cumulativos) e, em paralelo, a **categoria** do usuário (papéis do negócio). O `exigirNivel` e o padrão de claims no JWT continuam, e `exigirCategoria` confere a categoria |
| Logs e auditoria (Redis) | Eventos de negócio: `projeto_criado`, `projeto_editado`, `projeto_excluido`, `projeto_concluido`, `demanda_criada`, `demanda_editada`, `demanda_excluida`, `demanda_concluida`, `modelo_treinado`, `previsao_consultada`, `limite_plano_atingido`, `acesso_negado` e outros. Consulta restrita ao `admin` |
| Upload e perfil (Garage) | Foto e bio do usuário. O anexo ligado ao registro do negócio (desenho técnico ou foto da peça, por demanda) está na issue 18 |
| Plano Premium (Stripe) | Plano Expert único: o pagamento muda o papel de `professional` para `expert` |
| CI/CD (GitHub Actions) | Continua valendo: build, teste e publicação das imagens a cada push |
| **Novo:** microsserviço de regressão | Serviço isolado (Python): lê o CSV, treina a regressão com as colunas escolhidas, guarda o modelo por usuário e devolve a previsão |

## 10. Arquitetura e telas

| Serviço | Papel | Porta pública |
|---|---|---|
| `app` | Front, API e porta de entrada dos demais serviços | sim |
| `auth-service` | Cadastro, login (JWT), recuperação de senha | não |
| `pagamentos` | Checkout e webhook do Stripe | não (o webhook entra pelo `app`) |
| `log-service` | Auditoria, em Redis Streams | não |
| `profile-service` | Foto e bio (Garage, compatível com S3) | não |
| `regressao` | Treino e previsão (Python) | não |
| MariaDB | Banco compartilhado (remoto) | externo |

Telas do `app`: **Início** (guia da interface), **Projetos**, **Projeto** (dados no topo, demandas, e para o Planejador a aba *Excluídas*), **Minhas demandas** (só Almoxarife, Operador e Montador), **Análise** (abas *Previsão de equipe* e *Indicadores*, só Expert), **Planos** e **Perfil**, além de login, cadastro e recuperação de senha. A **landing page pública** ainda falta (issue 19). O CSS é dividido em `tokens`, `base`, `componentes`, `layout`, `auth` e um arquivo por página.

## 11. Como rodar (resumo)

1. Copie `env.example` para `.env` e preencha os valores (segredos, banco, SMTP, Stripe, Garage).
2. No MariaDB, rode os scripts de `banco/` em ordem: `01-schema.sql`, `02-migracao.sql` (só num banco já em uso), `03-admin-e-exemplos.sql` (opcional: promove uma conta a `admin` ou `expert` para testes) e `04-demandas-excluidas.sql` (colunas de finalização e exclusão lógica). **Atenção:** hoje a ordem importa e alguns trechos do `02` estão obsoletos; a issue 21 consolida tudo num script que recria o banco do zero.
3. Para a foto de perfil, suba o Garage e rode o `init-garage.sh` (veja o README do `upload-profile`). Sem isso, o resto funciona.
4. Para o pagamento, crie no Stripe (modo de teste) um preço mensal de R$ 149, copie o ID `price_...` para `STRIPE_PRICE_EXPERT` e cadastre o webhook com os eventos `checkout.session.completed` e `customer.subscription.deleted`.
5. `docker compose up --build` e abra `http://localhost:3000`.

O `docker-compose.portainer.yml` é a versão para a stack do Portainer, e o `docker-compose.ci.yml` junto com `.github/workflows/ci-cd.yml` formam o pipeline.

## 12. Status e próximos passos

O código desta versão foi escrito mas **ainda não foi testado de ponta a ponta**. As issues deste repositório trazem o que está feito, o que está pendente e um roteiro de teste.

**O principal risco hoje é o isolamento entre contas** (seção 8.3): sem ele, o produto não pode receber mais de uma empresa no mesmo sistema. A ordem recomendada é: organizações e convites (issues 16 e 17), anexos ligados à demanda (18), landing page (19), publicação na stack (20), scripts de banco reproduzíveis (21) e limpeza do projeto de filmes (22). Depois disso vem o teste de ponta a ponta (25).

## 13. Requisitos de SaaS multi-tenant: situação

Verificação feita sobre o código da API e das telas do `app`. Os serviços `auth-service`, `log-service` e `profile-service`, os arquivos de compose e o `banco/01-schema.sql` **não foram inspecionados** nesta revisão; onde dependem deles, a situação aparece como "a conferir".

| # | Requisito | Situação | Observação |
|---|---|---|---|
| 1 | Stack aponta para o repositório novo | A conferir | Ação manual no Portainer (issue 20) |
| 2 | Modelagem com 3+ tabelas e script versionado | Parcial | Há `projetos`, `demandas` e `modelos_regressao`, mas os scripts divergem entre si; falta consolidar e acrescentar `organizacoes` e `anexos_demanda` (issues 21, 16 e 18) |
| 3 | API com CRUD do recurso principal | Atende (não testado) | Projetos: listar, criar, detalhar, editar e remover. Demandas: criar, editar, excluir e avançar. Swagger é extra e não foi visto |
| 4 | Telas do recurso principal | Atende (não testado) | Listar, criar, detalhar e editar projetos; gerir demandas na página do projeto |
| 5 | Papéis do negócio com 403 na API | Atende, com ressalva | Cinco categorias valendo na API. Ressalva: a categoria é escolhida no cadastro, então qualquer pessoa pode se cadastrar como Superior (issue 17) |
| 6 | Isolamento por usuário ou organização | **Não atende** | Lista e detalhe de projeto, e a fila, não filtram por dono (issue 16) |
| 7 | Eventos de negócio no log | Parcial | Criação, edição, exclusão e conclusão são registradas; faltam as passagens intermediárias de etapa (issue 23) |
| 8 | Upload ligado ao registro do negócio | **Não atende** | Só existe foto de perfil; falta o anexo da demanda (issue 18) |
| 9 | Landing page pública | **Não atende** | Issue 19 |
| 10 | Nada de Tom Hanks | Parcial | A API está limpa; faltam tabelas antigas no banco e a chave do TMDB nas variáveis (issue 22) |
