-- ============================================================================
-- Atenas SGE — 002_seed.sql: dados de exemplo (SÓ PARA DESENVOLVIMENTO E TESTE)
--
-- *** NUNCA RODE ESTE ARQUIVO EM PRODUÇÃO. *** Ele cria contas com senha pública e empresas com
-- código de convite previsível (ALFA2026 e BETA2026): qualquer pessoa que souber o nome da empresa
-- entraria nela.
--
-- Cria DUAS empresas (Metalúrgica Alfa e Usinagem Beta), cada uma com as cinco categorias de usuário,
-- projetos e demandas em todas as etapas, para mostrar o isolamento: quem é da Alfa não vê nada da Beta,
-- e vice-versa. Pode ser rodado várias vezes: não duplica nada e não altera contas que já existem.
--
-- Pré-requisito: 000_base.sql e 001_dominio.sql já rodados.
-- Rode com o banco já escolhido na linha de comando (veja db/README.md), por exemplo:
--   mariadb --default-character-set=utf8mb4 -u root -p atenas < db/002_seed.sql
--
-- SENHA DE TODAS AS CONTAS DE EXEMPLO:  Atenas@2026
-- Código das empresas (digitado no cadastro de quem não é Superior):
--   Metalúrgica Alfa (exemplo)  ->  ALFA2026
--   Usinagem Beta (exemplo)     ->  BETA2026
-- ============================================================================

SET NAMES utf8mb4;

-- hash bcrypt (custo 10) da senha Atenas@2026, no mesmo formato que o auth-service grava
SET @hash := '$2b$10$xkwadVaOLbbWhydcHK8xB.IXDadMfX9t4N0sHbeEQIXnaEWEEPMR2';

-- ---------- empresas ----------
INSERT INTO organizacoes (nome, codigo_convite)
SELECT 'Metalúrgica Alfa (exemplo)', 'ALFA2026' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM organizacoes WHERE nome = 'Metalúrgica Alfa (exemplo)');
INSERT INTO organizacoes (nome, codigo_convite)
SELECT 'Usinagem Beta (exemplo)', 'BETA2026' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM organizacoes WHERE nome = 'Usinagem Beta (exemplo)');

SET @org_a := (SELECT id FROM organizacoes WHERE nome = 'Metalúrgica Alfa (exemplo)');
SET @org_b := (SELECT id FROM organizacoes WHERE nome = 'Usinagem Beta (exemplo)');

-- ---------- usuários (só cria quem ainda não existe; nunca mexe em conta existente) ----------
-- Alfa: o Superior é Expert (para testar Análise e Indicadores); o admin serve para consultar os logs.
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Ana Souza (Superior Alfa)', 'superior@alfa.exemplo.com', @hash, 'expert', 'superior', @org_a FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'superior@alfa.exemplo.com');
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Paulo Lima (Planejador Alfa)', 'planejador@alfa.exemplo.com', @hash, 'professional', 'planejador', @org_a FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'planejador@alfa.exemplo.com');
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Alice Rocha (Almoxarife Alfa)', 'almoxarife@alfa.exemplo.com', @hash, 'professional', 'almoxarife', @org_a FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'almoxarife@alfa.exemplo.com');
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Carlos Mendes (Operador Alfa)', 'operador@alfa.exemplo.com', @hash, 'professional', 'operador', @org_a FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'operador@alfa.exemplo.com');
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Marcos Dias (Montador Alfa)', 'montador@alfa.exemplo.com', @hash, 'professional', 'montador', @org_a FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'montador@alfa.exemplo.com');
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Admin do produto (Alfa)', 'admin@atenas.exemplo.com', @hash, 'admin', 'superior', @org_a FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'admin@atenas.exemplo.com');

-- Beta: todos Professional (para testar os limites do plano gratuito e o bloqueio da Análise)
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Beatriz Nunes (Superior Beta)', 'superior@beta.exemplo.com', @hash, 'professional', 'superior', @org_b FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'superior@beta.exemplo.com');
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Pedro Alves (Planejador Beta)', 'planejador@beta.exemplo.com', @hash, 'professional', 'planejador', @org_b FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'planejador@beta.exemplo.com');
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Aline Costa (Almoxarife Beta)', 'almoxarife@beta.exemplo.com', @hash, 'professional', 'almoxarife', @org_b FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'almoxarife@beta.exemplo.com');
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Otávio Reis (Operador Beta)', 'operador@beta.exemplo.com', @hash, 'professional', 'operador', @org_b FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'operador@beta.exemplo.com');
INSERT INTO usuarios (nome, email, senha_hash, role, categoria, organizacao_id)
SELECT 'Mônica Prado (Montadora Beta)', 'montador@beta.exemplo.com', @hash, 'professional', 'montador', @org_b FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'montador@beta.exemplo.com');

SET @u_sup_a := (SELECT id FROM usuarios WHERE email = 'superior@alfa.exemplo.com' LIMIT 1);
SET @u_pla_a := (SELECT id FROM usuarios WHERE email = 'planejador@alfa.exemplo.com' LIMIT 1);
SET @u_alm_a := (SELECT id FROM usuarios WHERE email = 'almoxarife@alfa.exemplo.com' LIMIT 1);
SET @u_ope_a := (SELECT id FROM usuarios WHERE email = 'operador@alfa.exemplo.com' LIMIT 1);
SET @u_mon_a := (SELECT id FROM usuarios WHERE email = 'montador@alfa.exemplo.com' LIMIT 1);
SET @u_sup_b := (SELECT id FROM usuarios WHERE email = 'superior@beta.exemplo.com' LIMIT 1);
SET @u_pla_b := (SELECT id FROM usuarios WHERE email = 'planejador@beta.exemplo.com' LIMIT 1);
SET @u_alm_b := (SELECT id FROM usuarios WHERE email = 'almoxarife@beta.exemplo.com' LIMIT 1);
SET @u_ope_b := (SELECT id FROM usuarios WHERE email = 'operador@beta.exemplo.com' LIMIT 1);
SET @u_mon_b := (SELECT id FROM usuarios WHERE email = 'montador@beta.exemplo.com' LIMIT 1);

-- ---------- projetos ----------
INSERT INTO projetos (nome, descricao, prazo_dias, status, criado_por, organizacao_id, concluido_em)
SELECT 'Galpão industrial 12x30', 'Estrutura metálica completa: pilares, terças e cobertura.', 60, 'ativo', @u_sup_a, @org_a, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM projetos WHERE organizacao_id = @org_a AND nome = 'Galpão industrial 12x30');
SET @p_a1 := (SELECT id FROM projetos WHERE organizacao_id = @org_a AND nome = 'Galpão industrial 12x30' LIMIT 1);

INSERT INTO projetos (nome, descricao, prazo_dias, status, criado_por, organizacao_id, concluido_em)
SELECT 'Portão automatizado', 'Portão deslizante com motor e trilho. Projeto já entregue.', 30, 'concluido', @u_sup_a, @org_a, DATE_SUB(NOW(), INTERVAL 20 DAY) FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM projetos WHERE organizacao_id = @org_a AND nome = 'Portão automatizado');
SET @p_a2 := (SELECT id FROM projetos WHERE organizacao_id = @org_a AND nome = 'Portão automatizado' LIMIT 1);

INSERT INTO projetos (nome, descricao, prazo_dias, status, criado_por, organizacao_id, concluido_em)
SELECT 'Prensa hidráulica 80t', 'Fabricação e montagem de prensa para cliente do interior.', 90, 'ativo', @u_sup_b, @org_b, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM projetos WHERE organizacao_id = @org_b AND nome = 'Prensa hidráulica 80t');
SET @p_b1 := (SELECT id FROM projetos WHERE organizacao_id = @org_b AND nome = 'Prensa hidráulica 80t' LIMIT 1);

-- ---------- demandas ----------
-- (RG, material, quantidade, etapa, responsáveis das etapas já concluídas, finalizada há N dias, excluída há N dias)

-- Alfa / Galpão: uma demanda em cada etapa, uma finalizada e uma excluída (aba Excluídas do Planejador)
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a1, @org_a, 'RG-A-001', 'Perfil U 200mm', 12, 'almoxarifado', @u_pla_a, NULL, NULL, NULL, NULL, NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a1 AND rg = 'RG-A-001');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a1, @org_a, 'RG-A-002', 'Chapa de aço 3mm', 8, 'almoxarifado', @u_pla_a, NULL, NULL, NULL, NULL, NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a1 AND rg = 'RG-A-002');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a1, @org_a, 'RG-A-003', 'Viga I 150mm', 6, 'operacao', @u_pla_a, @u_alm_a, NULL, NULL, NULL, NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a1 AND rg = 'RG-A-003');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a1, @org_a, 'RG-A-004', 'Parafuso estrutural M16', 200, 'montagem', @u_pla_a, @u_alm_a, @u_ope_a, NULL, NULL, NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a1 AND rg = 'RG-A-004');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a1, @org_a, 'RG-A-005', 'Terça Z 100mm', 24, 'finalizada', @u_pla_a, @u_alm_a, @u_ope_a, @u_mon_a, DATE_SUB(NOW(), INTERVAL 3 DAY), NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a1 AND rg = 'RG-A-005');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a1, @org_a, 'RG-A-006', 'Cantoneira 2 pol (cadastrada por engano)', 10, 'almoxarifado', @u_pla_a, NULL, NULL, NULL, NULL, DATE_SUB(NOW(), INTERVAL 1 DAY), @u_pla_a FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a1 AND rg = 'RG-A-006');

-- Alfa / Portão (concluído): histórico de demandas finalizadas em meses diferentes (útil para a previsão)
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a2, @org_a, 'RG-A-101', 'Trilho deslizante 6m', 2, 'finalizada', @u_pla_a, @u_alm_a, @u_ope_a, @u_mon_a, DATE_SUB(NOW(), INTERVAL 22 DAY), NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a2 AND rg = 'RG-A-101');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a2, @org_a, 'RG-A-102', 'Motor 1/2 CV', 1, 'finalizada', @u_pla_a, @u_alm_a, @u_ope_a, @u_mon_a, DATE_SUB(NOW(), INTERVAL 28 DAY), NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a2 AND rg = 'RG-A-102');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a2, @org_a, 'RG-A-103', 'Folha do portão 3x2m', 1, 'finalizada', @u_pla_a, @u_alm_a, @u_ope_a, @u_mon_a, DATE_SUB(NOW(), INTERVAL 45 DAY), NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a2 AND rg = 'RG-A-103');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_a2, @org_a, 'RG-A-104', 'Cremalheira 4m', 3, 'finalizada', @u_pla_a, @u_alm_a, @u_ope_a, @u_mon_a, DATE_SUB(NOW(), INTERVAL 75 DAY), NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_a2 AND rg = 'RG-A-104');

-- Beta / Prensa: uma demanda em cada etapa, todas com os responsáveis da própria Beta
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_b1, @org_b, 'RG-B-001', 'Cilindro hidráulico 100mm', 2, 'almoxarifado', @u_pla_b, NULL, NULL, NULL, NULL, NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_b1 AND rg = 'RG-B-001');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_b1, @org_b, 'RG-B-002', 'Placa base 40mm', 1, 'operacao', @u_pla_b, @u_alm_b, NULL, NULL, NULL, NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_b1 AND rg = 'RG-B-002');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_b1, @org_b, 'RG-B-003', 'Travessa superior', 1, 'montagem', @u_pla_b, @u_alm_b, @u_ope_b, NULL, NULL, NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_b1 AND rg = 'RG-B-003');
INSERT INTO demandas (projeto_id, organizacao_id, rg, nome_material, quantidade, etapa_atual, planejador_id, almoxarife_id, operador_id, montador_id, finalizado_em, excluida_em, excluida_por)
SELECT @p_b1, @org_b, 'RG-B-004', 'Coluna guia retificada', 4, 'finalizada', @u_pla_b, @u_alm_b, @u_ope_b, @u_mon_b, DATE_SUB(NOW(), INTERVAL 5 DAY), NULL, NULL FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM demandas WHERE projeto_id = @p_b1 AND rg = 'RG-B-004');

-- ---------- conferência ----------
SELECT o.nome AS empresa,
       (SELECT COUNT(*) FROM usuarios u WHERE u.organizacao_id = o.id) AS usuarios,
       (SELECT COUNT(*) FROM projetos p WHERE p.organizacao_id = o.id) AS projetos,
       (SELECT COUNT(*) FROM demandas d WHERE d.organizacao_id = o.id AND d.excluida_em IS NULL) AS demandas,
       (SELECT COUNT(*) FROM demandas d WHERE d.organizacao_id = o.id AND d.excluida_em IS NOT NULL) AS demandas_excluidas
  FROM organizacoes o WHERE o.nome LIKE '%(exemplo)';
