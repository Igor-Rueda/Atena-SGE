import hmac
import logging
import math
import os

from flask import Flask, jsonify, request

import dados
import modelo

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

# faixa aceita em cada campo (barra entradas absurdas antes de chegarem ao modelo)
LIMITES = {
    'n_itens': (1, 100_000),
    'qtd_total': (1, 10_000_000),
    'n_atividades': (1, 3),
    'prazo_dias': (1, 3650),
}


def chave_interna_valida():
    """Serviço interno: só o app chama, com a chave compartilhada. Sem a variável, nada passa."""
    esperada = os.environ.get('INTERNAL_API_KEY')
    recebida = request.headers.get('x-internal-key')
    if not esperada or not recebida:
        return False
    return hmac.compare_digest(esperada.encode(), recebida.encode())


def ler_caracteristicas(corpo):
    """Valida os 4 campos. Devolve (dict, None) ou (None, mensagem de erro)."""
    resultado = {}
    for campo, (minimo, maximo) in LIMITES.items():
        try:
            valor = float(corpo.get(campo))
        except (TypeError, ValueError):
            return None, f'O campo {campo} precisa ser um número.'
        if not math.isfinite(valor) or valor < minimo or valor > maximo:
            return None, f'O campo {campo} precisa estar entre {minimo} e {maximo}.'
        if campo == 'n_atividades' and valor != int(valor):
            return None, 'O campo n_atividades precisa ser um número inteiro (1 a 3).'
        resultado[campo] = valor
    return resultado, None


@app.get('/health')
def health():
    return jsonify({'ok': True})


@app.post('/prever')
def prever():
    if not chave_interna_valida():
        return jsonify({'mensagem': 'Acesso interno negado.'}), 403

    corpo = request.get_json(silent=True) or {}

    try:
        usuario_id = int(corpo.get('usuario_id'))
    except (TypeError, ValueError):
        return jsonify({'mensagem': 'usuario_id inválido.'}), 400
    if usuario_id <= 0:
        return jsonify({'mensagem': 'usuario_id inválido.'}), 400

    caracteristicas, erro = ler_caracteristicas(corpo)
    if erro:
        return jsonify({'mensagem': erro}), 400

    # histórico real do usuário. Se o banco estiver fora do ar, a previsão sai só com os
    # exemplos e avisa, em vez de falhar: o app mostra o aviso ao usuário.
    historico_indisponivel = False
    X_reais = y_reais = None
    try:
        X_reais, y_reais = dados.projetos_reais(usuario_id)
    except Exception as erro_db:  # noqa: BLE001 -- qualquer falha de banco cai no mesmo aviso
        historico_indisponivel = True
        app.logger.error('Não foi possível ler o histórico do usuário %s: %s', usuario_id, erro_db)

    resultado = modelo.prever(modelo.treinar(X_reais, y_reais), caracteristicas)
    resultado['historico_indisponivel'] = historico_indisponivel
    return jsonify(resultado)
