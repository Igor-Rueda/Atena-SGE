-- ============================================================================
-- Atenas SGE — 003_assinaturas.sql: cópia local do estado das assinaturas (Stripe)
--
-- Quem sabe o estado verdadeiro da assinatura é o Stripe. Estas duas tabelas guardam uma CÓPIA,
-- mantida em dia pelos webhooks (serviço `pagamentos`):
--   assinaturas   - a assinatura vigente de cada usuário: plano, status, valor mensal, cancelamento agendado.
--                   Alimenta o painel admin (assinaturas ativas e MRR de teste) e o aviso de cobrança recusada.
--   eventos_stripe - ids dos eventos de webhook já processados: é o que impede o mesmo evento, reenviado
--                   pelo Stripe, de ser processado duas vezes.
-- O papel do usuário (professional/expert) continua em usuarios.role, alterado só pelo webhook.
--
-- Pré-requisito: 000_base.sql (tabela usuarios). Pode ser rodado várias vezes e não apaga dados.
-- Rode com o banco já escolhido na linha de comando (veja db/README.md).
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS assinaturas (
  usuario_id INT PRIMARY KEY,
  stripe_customer_id VARCHAR(64) NOT NULL,
  stripe_subscription_id VARCHAR(64) NOT NULL,
  plano VARCHAR(20) NOT NULL,                              -- expert
  status VARCHAR(30) NOT NULL,                             -- active | trialing | past_due | unpaid | canceled ...
  valor_mensal_centavos INT NOT NULL DEFAULT 0,            -- base do MRR (planos anuais entram divididos por 12)
  cancelamento_agendado BOOLEAN NOT NULL DEFAULT FALSE,    -- cancelou, mas ainda vale até o fim do período
  periodo_fim DATETIME NULL,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_assinaturas_status (status)
);

CREATE TABLE IF NOT EXISTS eventos_stripe (
  id VARCHAR(80) PRIMARY KEY,                              -- evt_... (id do evento no Stripe)
  tipo VARCHAR(60) NOT NULL,
  recebido_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_eventos_stripe_recebido (recebido_em)
);
