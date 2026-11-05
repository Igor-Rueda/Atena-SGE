"""Leitura de CSV exportado do Excel (ou de qualquer planilha).

Detecta o separador de colunas, aceita vírgula ou ponto como separador decimal e descobre quais
colunas são numéricas. Não usa numpy: devolve listas simples, que o modelo converte depois.
"""
import base64
import csv
import io
import math
import unicodedata

LIMITE_BYTES = 2 * 1024 * 1024
LIMITE_LINHAS = 5000
LIMITE_COLUNAS = 40
LIMITE_ENTRADAS = 10
LINHAS_DA_PREVIA = 8


class ErroCSV(ValueError):
    """Problema no arquivo ou na escolha de colunas (a mensagem é mostrada ao usuário)."""


def decodificar(arquivo_base64):
    """Recebe o arquivo em base64 e devolve o texto, aceitando UTF-8 (com ou sem BOM) e ANSI."""
    try:
        dados = base64.b64decode(arquivo_base64 or '', validate=True)
    except Exception:
        raise ErroCSV('Não foi possível ler o arquivo enviado.')
    if not dados:
        raise ErroCSV('O arquivo está vazio.')
    if len(dados) > LIMITE_BYTES:
        raise ErroCSV('O arquivo é grande demais (máximo de 2 MB).')
    if dados[:2] == b'PK':
        raise ErroCSV('Esse parece ser um arquivo do Excel (.xlsx). No Excel, use Arquivo > Salvar como > CSV e envie o CSV.')
    for codificacao in ('utf-8-sig', 'cp1252'):
        try:
            return dados.decode(codificacao)
        except UnicodeDecodeError:
            continue
    return dados.decode('latin-1', errors='replace')


def detectar_delimitador(texto):
    """O Excel em português separa por ponto e vírgula; em inglês, por vírgula."""
    primeira = next((linha for linha in texto.splitlines() if linha.strip()), '')
    candidatos = [';', '\t', ',']
    if not any(d in primeira for d in candidatos):
        return ';'
    return max(candidatos, key=lambda d: (primeira.count(d), d == ';'))


def para_numero(valor):
    """'412', '412,5', '412.5', '1.234,5' e '1,234.5' viram número; o resto vira None."""
    s = (valor or '').strip().replace('\u00a0', '').replace(' ', '')
    if not s:
        return None
    tem_virgula, tem_ponto = ',' in s, '.' in s
    if tem_virgula and tem_ponto:
        if s.rfind(',') > s.rfind('.'):
            s = s.replace('.', '').replace(',', '.')   # 1.234,5
        else:
            s = s.replace(',', '')                      # 1,234.5
    elif tem_virgula:
        s = s.replace(',', '.')
    try:
        numero = float(s)
    except ValueError:
        return None
    return numero if math.isfinite(numero) else None


def _nomes_unicos(cabecalho):
    nomes, vistos = [], {}
    for i, bruto in enumerate(cabecalho):
        nome = bruto.strip() or f'coluna {i + 1}'
        if nome in vistos:
            vistos[nome] += 1
            nome = f'{nome} ({vistos[nome]})'
        else:
            vistos[nome] = 1
        nomes.append(nome)
    return nomes


def ler_tabela(texto):
    delimitador = detectar_delimitador(texto)
    try:
        linhas = [l for l in csv.reader(io.StringIO(texto), delimiter=delimitador) if any(c.strip() for c in l)]
    except csv.Error:
        raise ErroCSV('O arquivo não parece ser um CSV válido.')
    if len(linhas) < 2:
        raise ErroCSV('O arquivo precisa ter a linha de cabeçalho e ao menos uma linha de dados.')
    if len(linhas) - 1 > LIMITE_LINHAS:
        raise ErroCSV(f'O arquivo tem linhas demais (máximo de {LIMITE_LINHAS}).')
    colunas = _nomes_unicos(linhas[0])
    if len(colunas) > LIMITE_COLUNAS:
        raise ErroCSV(f'O arquivo tem colunas demais (máximo de {LIMITE_COLUNAS}).')
    n = len(colunas)
    dados = [(linha + [''] * n)[:n] for linha in linhas[1:]]
    return {'delimitador': delimitador, 'colunas': colunas, 'linhas': dados}


def _sem_acento(texto):
    return ''.join(c for c in unicodedata.normalize('NFD', texto.lower()) if unicodedata.category(c) != 'Mn')


def descrever_colunas(tabela):
    """Para cada coluna: se é numérica, exemplos, faixa e uma sugestão de papel (alvo/entrada/ignorar)."""
    descricao = []
    alvo_sugerido = False
    for i, nome in enumerate(tabela['colunas']):
        brutos = [linha[i].strip() for linha in tabela['linhas']]
        preenchidos = [v for v in brutos if v]
        validos = [n for n in (para_numero(v) for v in preenchidos) if n is not None]
        numerica = bool(preenchidos) and len(validos) / len(preenchidos) >= 0.9
        coluna = {'nome': nome, 'numerica': numerica, 'vazios': len(brutos) - len(preenchidos), 'exemplos': preenchidos[:3]}
        if numerica:
            coluna['minimo'], coluna['maximo'] = min(validos), max(validos)
        if numerica and not alvo_sugerido and 'funcion' in _sem_acento(nome):
            coluna['sugestao'] = 'alvo'
            alvo_sugerido = True
        elif numerica:
            coluna['sugestao'] = 'entrada'
        else:
            coluna['sugestao'] = 'ignorar'
        descricao.append(coluna)
    return descricao


def extrair_matriz(tabela, alvo, entradas):
    """Devolve (X, y, linhas_descartadas). Linhas com valor ausente ou não numérico são descartadas."""
    colunas = tabela['colunas']
    if alvo not in colunas:
        raise ErroCSV(f'A coluna alvo "{alvo}" não existe no arquivo.')
    if not entradas:
        raise ErroCSV('Escolha ao menos uma coluna de entrada.')
    if len(entradas) > LIMITE_ENTRADAS:
        raise ErroCSV(f'Use no máximo {LIMITE_ENTRADAS} colunas de entrada.')
    if len(set(entradas)) != len(entradas):
        raise ErroCSV('Há colunas de entrada repetidas.')
    if alvo in entradas:
        raise ErroCSV('A coluna alvo não pode ser também uma entrada.')
    for nome in entradas:
        if nome not in colunas:
            raise ErroCSV(f'A coluna de entrada "{nome}" não existe no arquivo.')

    indices = [colunas.index(alvo)] + [colunas.index(nome) for nome in entradas]
    X, y, descartadas = [], [], 0
    for linha in tabela['linhas']:
        numeros = [para_numero(linha[i]) for i in indices]
        if any(n is None for n in numeros):
            descartadas += 1
            continue
        y.append(numeros[0])
        X.append(numeros[1:])
    if descartadas > len(tabela['linhas']) / 2:
        raise ErroCSV('Mais da metade das linhas tem valores vazios ou não numéricos nas colunas escolhidas. Confira se elas são numéricas.')
    return X, y, descartadas
