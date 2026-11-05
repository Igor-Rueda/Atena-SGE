import functools
import hmac
import logging
import os
from datetime import datetime, timezone

from flask import Flask, jsonify, request

import csv_util
import dados
import modelo

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024  # o CSV de até 2 MB chega em base64
logging.basicConfig(level=logging.INFO)


def chave_interna_valida():
    """Serviço interno: só o app chama, com a chave compartilhada. Sem a variável, nada passa."""
    esperada = os.environ.get('INTERNAL_API_KEY')
    recebida = request.headers.get('x-internal-key')
    if not esperada or not recebida:
        return False
    return hmac.compare_digest(esperada.encode(), recebida.encode())


def exige_chave_interna(funcao):
    @functools.wraps(funcao)
    def protegida(*args, **kwargs):
        if not chave_interna_valida():
            return jsonify({'mensagem': 'Acesso interno negado.'}), 403
        return funcao(*args, **kwargs)
    return protegida


def ler_usuario_id(valor):
    try:
        usuario_id = int(valor)
    except (TypeError, ValueError):
        return None
    return usuario_id if usuario_id > 0 else None


@app.errorhandler(csv_util.ErroCSV)
@app.errorhandler(modelo.ErroModelo)
def erro_do_usuario(erro):
    return jsonify({'mensagem': str(erro)}), 400


@app.errorhandler(413)
def corpo_grande(_erro):
    return jsonify({'mensagem': 'O arquivo é grande demais (máximo de 2 MB).'}), 413


@app.get('/health')
def health():
    return jsonify({'ok': True})


@app.post('/csv/previa')
@exige_chave_interna
def previa():
    """Lê o CSV e devolve as colunas (com tipo e sugestão de papel) e as primeiras linhas."""
    corpo = request.get_json(silent=True) or {}
    tabela = csv_util.ler_tabela(csv_util.decodificar(corpo.get('arquivo_base64')))
    return jsonify({
        'delimitador': {';': 'ponto e vírgula', ',': 'vírgula', '\t': 'tabulação'}.get(tabela['delimitador'], tabela['delimitador']),
        'total_linhas': len(tabela['linhas']),
        'colunas': csv_util.descrever_colunas(tabela),
        'previa': tabela['linhas'][:csv_util.LINHAS_DA_PREVIA],
    })


@app.post('/treinar')
@exige_chave_interna
def treinar():
    corpo = request.get_json(silent=True) or {}
    usuario_id = ler_usuario_id(corpo.get('usuario_id'))
    alvo, entradas = corpo.get('alvo'), corpo.get('entradas')
    if usuario_id is None or not isinstance(alvo, str) or not isinstance(entradas, list):
        return jsonify({'mensagem': 'Informe a coluna alvo e as colunas de entrada.'}), 400

    tabela = csv_util.ler_tabela(csv_util.decodificar(corpo.get('arquivo_base64')))
    X, y, descartadas = csv_util.extrair_matriz(tabela, alvo, [str(e) for e in entradas])
    resultado = modelo.treinar(X, y, [str(e) for e in entradas])
    resultado['linhas_descartadas'] = descartadas
    resultado['treinado_em'] = datetime.now(timezone.utc).isoformat()

    try:
        dados.salvar_modelo(usuario_id, corpo.get('nome_arquivo'), alvo, resultado)
    except Exception as erro_db:  # noqa: BLE001
        app.logger.error('Não foi possível salvar o modelo do usuário %s: %s', usuario_id, erro_db)
        return jsonify({'mensagem': 'O modelo foi treinado, mas não foi possível salvá-lo agora. Tente novamente.'}), 503

    resultado['nome_arquivo'] = corpo.get('nome_arquivo') or ''
    resultado['alvo'] = alvo
    return jsonify(resultado)


@app.get('/modelo')
@exige_chave_interna
def obter_modelo():
    usuario_id = ler_usuario_id(request.args.get('usuario_id'))
    if usuario_id is None:
        return jsonify({'mensagem': 'usuario_id inválido.'}), 400
    try:
        resultado = dados.carregar_modelo(usuario_id)
    except Exception as erro_db:  # noqa: BLE001
        app.logger.error('Não foi possível ler o modelo do usuário %s: %s', usuario_id, erro_db)
        return jsonify({'mensagem': 'Não foi possível consultar o modelo agora.'}), 503
    if resultado is None:
        return jsonify({'mensagem': 'Nenhum modelo treinado ainda.'}), 404
    return jsonify(resultado)


@app.post('/prever')
@exige_chave_interna
def prever():
    corpo = request.get_json(silent=True) or {}
    usuario_id = ler_usuario_id(corpo.get('usuario_id'))
    valores = corpo.get('valores')
    if usuario_id is None or not isinstance(valores, dict):
        return jsonify({'mensagem': 'Informe os valores planejados.'}), 400
    try:
        parametros = dados.carregar_modelo(usuario_id)
    except Exception as erro_db:  # noqa: BLE001
        app.logger.error('Não foi possível ler o modelo do usuário %s: %s', usuario_id, erro_db)
        return jsonify({'mensagem': 'Não foi possível consultar o modelo agora.'}), 503
    if parametros is None:
        return jsonify({'mensagem': 'Treine um modelo antes de prever.'}), 404
    return jsonify(modelo.prever(parametros, valores))


@app.delete('/modelo')
@exige_chave_interna
def descartar_modelo():
    usuario_id = ler_usuario_id(request.args.get('usuario_id'))
    if usuario_id is None:
        return jsonify({'mensagem': 'usuario_id inválido.'}), 400
    try:
        dados.apagar_modelo(usuario_id)
    except Exception as erro_db:  # noqa: BLE001
        app.logger.error('Não foi possível apagar o modelo do usuário %s: %s', usuario_id, erro_db)
        return jsonify({'mensagem': 'Não foi possível descartar o modelo agora.'}), 503
    return jsonify({'ok': True})
