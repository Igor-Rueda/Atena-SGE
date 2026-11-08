# Atenas SGE — Software de Gestão Empresarial

> Valores marcados com *(hipótese)* são dados mockados ou estimativas a validar com uma empresa real.

**Atenas SGE é o software de gestão empresarial em que pequenas indústrias cadastram projetos, itens e demandas dos processos de Planejamento, Almoxarifado, Fabricação e Montagem num só lugar, e preveem a equipe necessária com base no próprio histórico.**

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

Ele começa o dia anotando num caderno as demandas de cada processo e depois passa tudo para uma planilha que só ele entende. No fim do mês, decide de cabeça quantas pessoas colocar para a meta seguinte, e às vezes erra para mais ou para menos, embora tenha guardado, em Excel, o histórico de funcionários, itens concluídos e horas de vários meses. O funcionário pergunta a ele o que fazer porque não tem onde consultar. As demandas chegam sem filtro e acabam sempre nos mesmos operadores, porque ele não enxerga a carga de cada um. O que atrapalha: nenhum sistema mostra o projeto, os itens e quem está com cada demanda no mesmo lugar, e os sistemas de gestão (ERP/MES) que conhece são caros e pesados para o tamanho da empresa.

**Persona secundária, o montador:** Marcos, 28 anos, montador. Só precisa saber qual é a demanda dele hoje, de qual projeto, com quais itens, e registrar quando um item foi consumido na montagem.

## 3. Concorrentes e alternativas

| Alternativa | O que faz mal para essa persona |
|---|---|
| Planilha (Excel / Google Sheets) | Cada setor tem a sua, sem controle de quem vê o quê, sem alerta e sem previsão. O histórico fica parado, e um erro de digitação passa despercebido. |
| Quadro de papel e WhatsApp | Não deixa histórico, as informações se perdem e o funcionário vê (ou perde) mensagens que não são dele. |
| Trello / Asana | Genéricos: não têm o conceito de projeto com itens (RG, quantidade) nem de processo produtivo, e não indicam quantos funcionários alocar. |
| ERP / MES (ex.: TOTVS, SAP) | Caros, com implantação longa, muita informação em cada tela e exigem equipe de TI. Excessivos para uma operação pequena. |

## 4. Proposta de valor

**Para a pequena indústria, o Atenas SGE reúne projetos, itens e demandas num só lugar, com acesso por categoria e por processo, e no plano Expert transforma o histórico do próprio cliente (um CSV do Excel) numa previsão de quantos funcionários a meta do mês exige, evitando a sobrecarga da equipe, sem o custo e a complexidade de um ERP.**

## 5. Modelo de receita com Stripe

O plano **é** o papel do usuário: pagar o Expert muda o papel, e o middleware de acesso passa a liberar os recursos. O papel só muda quando o **webhook** do Stripe confirma o pagamento.

| | **Professional** | **Expert** |
|---|---|---|
| Preço | Grátis | R$ 149/mês por conta |
| Cadastrar projetos, itens e demandas | Sim | Sim |
| Ver as próprias demandas | Sim | Sim |
| Registrar o consumo de itens na montagem | Sim | Sim |
| Projetos ativos ao mesmo tempo *(hipótese)* | Até 3 | Sem limite |
| Itens por projeto *(hipótese)* | Até 50 | Sem limite |
| Demandas abertas ao mesmo tempo *(hipótese)* | Até 20 | Sem limite |
| Excluir demandas | Não | Sim |
| **Análise:** previsão de equipe (regressão linear múltipla treinada com o histórico em CSV) | Não | Sim |

**Por que alguém pagaria o Expert:** o Professional resolve o registro e a consulta, mas o limite de 3 projetos ativos aperta quando a operação cresce, e só o Expert ajuda a decidir. A previsão de equipe evita hora extra e sobrecarga, e o custo mensal tem que ser menor que uma hora extra evitada *(hipótese a validar)*.

**Funil:** o Professional já organiza o dia a dia e registra o consumo dos itens, que é a "demanda" do mês. Quando o cliente quer decidir a equipe, o Expert aproveita o histórico que ele já tem. Os limites do Professional contam só projetos e demandas **ativos**: o que é concluído sai da contagem.

### Como a previsão de equipe funciona

É uma **regressão linear múltipla**, treinada com o histórico do próprio cliente, no estilo de ferramentas como o Orange:

1. **Dados:** o usuário envia um CSV exportado do Excel, uma linha por período (por exemplo, um mês). Colunas esperadas: **número de funcionários**, **demanda** (soma das quantidades dos itens concluídos, isto é, consumidos na montagem, no período) e **tempo total de realização** (em horas). Outras colunas podem ficar no arquivo.
2. **Colunas:** uma tela mostra as primeiras linhas, e o usuário escolhe o papel de cada coluna: **alvo** (o que será previsto, o nº de funcionários), **entrada** ou **ignorar**.
3. **Treino:** o app avisa que está carregando enquanto o modelo é treinado. O resultado mostra R², R² ajustado, erro médio (MAE), RMSE, erro em validação cruzada ("deixa um de fora"), os coeficientes com a importância de cada entrada e um gráfico real × previsto. Há avisos quando as linhas são poucas, o ajuste é fraco ou as entradas são muito correlacionadas.
4. **Previsão:** com o modelo treinado, o usuário informa o que está planejado para o mês (a meta de itens a concluir e as horas planejadas) e recebe o número de funcionários necessário, arredondado para cima. Se um valor estiver fora do intervalo do histórico, a tela avisa que a previsão é menos confiável.

O modelo fica guardado por usuário, então a previsão está disponível sem treinar de novo, e pode ser retreinado ou descartado. O serviço aceita CSV com separador `;`, `,` ou tabulação, decimal com vírgula ou ponto e codificação UTF-8 ou ANSI.

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
| **Solução** | 1) Projetos, itens (RG, quantidade, consumo na montagem) e demandas por processo, com cada pessoa vendo as suas. 2) Categorias de usuário ligadas aos processos: cada pessoa vê só o necessário. 3) Análise (Expert): previsão de equipe por regressão treinada com o CSV do cliente. |
| **Canais** | Visitas a pequenas indústrias da região, indicação entre gestores, landing page. |
| **Fontes de receita** | Assinatura mensal Expert via Stripe. O plano Professional é a porta de entrada. |
| **Estrutura de custos** | Infraestrutura (mesma stack), taxas do Stripe, tempo de desenvolvimento e suporte. |
| **Métricas-chave** | Contas ativas, conversão para Expert, MRR, retenção, modelos treinados, qualidade da previsão. |
| **Vantagem injusta** | O histórico do cliente dentro do sistema: quanto mais ele usa, melhor a previsão e mais caro é sair. Conhecimento do chão de fábrica da região. |

## 8. Planos, categorias e permissões

### 8.1 Planos (papéis)

Informação demais atrapalha o operacional e informação faltando compromete a decisão. Os papéis do plano são **cumulativos**: cada um faz o que o anterior faz, mais o que é seu.

| Papel | Quem é | Pode fazer |
|---|---|---|
| `professional` | Todo usuário novo (plano gratuito) | Cadastrar projetos, itens e demandas (atribuindo a demanda a outro usuário pelo e-mail), dentro dos limites do plano; ver **só as demandas em que é responsável** |
| `expert` | Assinante do plano pago | Tudo do Professional **+** Análise (previsão de equipe) e exclusão de demandas, sem limites de uso |
| `admin` | Administrador do produto, usado para testar rotas | Tudo do Expert. Não é vendável, não aparece na página de planos e só nasce por comando no banco |

### 8.2 Categorias de usuário e processos

Cada usuário tem uma **categoria**, escolhida no cadastro e mostrada no menu. A hierarquia é: **Superior** no topo e, abaixo dele, **Planejador, Almoxarife, Operador e Montador**, que atuam nos processos e ficam no **mesmo nível**.

| Processo (ordem do fluxo) | Categoria que atua |
|---|---|
| 1. Planejamento | Planejador |
| 2. Almoxarifado | Almoxarife |
| 3. Fabricação | Operador |
| 4. Montagem | Montador |

Os processos são uma **lista fixa** (não texto livre), selecionada ao criar uma demanda. Regras:

- Uma demanda só pode ser atribuída a quem tem a categoria do processo, ou a um **Superior**, que pode atuar em qualquer um.
- Um **item é concluído quando é consumido na montagem**. Quem registra o consumo é o **Montador** (ou o dono do projeto). A soma das quantidades dos itens concluídos no período é a "demanda" do histórico usado na previsão.
- Cada pessoa vê as demandas em que é responsável; o dono do projeto vê todas as demandas dele.

## 9. Mapa de reaproveitamento

| Peça do projeto anterior | O que vira no Atenas SGE |
|---|---|
| Catálogo de filmes (TMDB) | Recurso principal: **projetos, itens** (RG, quantidade, consumo) e **demandas** por processo (planejamento, almoxarifado, fabricação, montagem) |
| Tier list dos stalkers | **Análise** (Expert): previsão de equipe treinada por CSV |
| Serviço e pasta `catalogo` | Renomeado para **`app`**: continua sendo o único serviço público e a porta de entrada dos demais serviços |
| Login + RBAC | Papéis do plano `professional` < `expert` < `admin` (cumulativos) e, em paralelo, a **categoria** do usuário. O `exigirNivel` e o padrão de claims no JWT continuam |
| Logs e auditoria (Redis) | Eventos de negócio: `projeto_criado`, `item_cadastrado`, `demanda_criada`, `demanda_excluida`, `modelo_treinado`, `previsao_consultada`, `limite_plano_atingido`, `acesso_negado` e outros. Consulta restrita ao `admin` |
| Upload e perfil (Garage) | Foto e bio do usuário. Anexos do projeto ficam para depois |
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

Telas do `app`: **Início** (guia da interface), **Projetos**, **Projeto** (dados no topo, itens com RG e situação, demandas), **Minhas demandas**, **Análise** (previsão de equipe, só Expert), **Planos** e **Perfil**, além de login, cadastro e recuperação de senha. O CSS é dividido em `tokens`, `base`, `componentes`, `layout`, `auth` e um arquivo por página.

## 11. Como rodar (resumo)

1. Copie `env.example` para `.env` e preencha os valores (segredos, banco, SMTP, Stripe, Garage).
2. No MariaDB, rode `banco/01-schema.sql` (cria o que falta) e, num banco já em uso, `banco/02-migracao.sql`. O `banco/03-admin-e-exemplos.sql` é opcional e promove uma conta a `admin` ou `expert` para testes.
3. Para a foto de perfil, suba o Garage e rode o `init-garage.sh` (veja o README do `upload-profile`). Sem isso, o resto funciona.
4. Para o pagamento, crie no Stripe (modo de teste) um preço mensal de R$ 149, copie o ID `price_...` para `STRIPE_PRICE_EXPERT` e cadastre o webhook com os eventos `checkout.session.completed` e `customer.subscription.deleted`.
5. `docker compose up --build` e abra `http://localhost:3000`.

O `docker-compose.portainer.yml` é a versão para a stack do Portainer, e o `docker-compose.ci.yml` junto com `.github/workflows/ci-cd.yml` formam o pipeline.

## 12. Status e próximos passos

O código desta versão foi escrito mas **ainda não foi testado de ponta a ponta**. As issues deste repositório trazem o que está feito, o que está pendente e um roteiro de teste. Os próximos passos são validar o fluxo completo (cadastro por categoria, projeto, itens, demandas, consumo, plano Expert, treino e previsão por CSV) e depois evoluir a Análise com novas funcionalidades e o módulo de gestão de processos.