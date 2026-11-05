"""Regressão linear múltipla (mínimos quadrados ordinários) para prever o nº de funcionários.

O usuário envia um histórico (CSV), escolhe qual coluna é o alvo (nº de funcionários) e quais são
as entradas (por exemplo, itens concluídos no mês e horas totais). O modelo é ajustado com essas
linhas e guardado; depois a previsão usa os valores planejados como entrada.
"""
import math

import numpy as np


class ErroModelo(ValueError):
    """Dados que não permitem ajustar ou usar o modelo (a mensagem é mostrada ao usuário)."""


def minimo_de_linhas(k):
    return max(6, 3 * (k + 1))


def treinar(X, y, entradas):
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float)
    n, k = X.shape
    minimo = minimo_de_linhas(k)
    if n < minimo:
        raise ErroModelo(f'São necessárias ao menos {minimo} linhas válidas para {k} entrada(s); foram encontradas {n}.')

    A = np.column_stack([np.ones(n), X])
    if np.linalg.matrix_rank(A) < k + 1:
        raise ErroModelo('Algumas colunas de entrada são constantes ou combinações exatas uma da outra. Remova as redundantes e tente de novo.')

    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    previsto = A @ coef
    residuos = y - previsto
    ss_res = float(residuos @ residuos)
    ss_tot = float(((y - y.mean()) ** 2).sum())
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else None
    r2_ajustado = 1.0 - (1.0 - r2) * (n - 1) / (n - k - 1) if r2 is not None and n - k - 1 > 0 else None

    # validação cruzada "deixa um de fora", em forma fechada: mostra o erro em dados não vistos
    h = np.einsum('ij,ij->i', A @ np.linalg.inv(A.T @ A), A)
    sobra = np.where(np.abs(1.0 - h) > 1e-9, residuos / (1.0 - h), np.nan)
    rmse_loo = float(np.sqrt(np.nanmean(sobra ** 2))) if np.isfinite(sobra).any() else None

    # importância relativa: coeficiente padronizado (comparável entre colunas de escalas diferentes)
    desvio_y = float(y.std())
    padronizados = [abs(coef[i + 1] * X[:, i].std() / desvio_y) if desvio_y > 0 else 0.0 for i in range(k)]
    soma = sum(padronizados)

    avisos = []
    if n < 20:
        avisos.append('Poucas linhas de histórico: o modelo pode não representar bem meses futuros.')
    if r2 is not None and r2 < 0.5:
        avisos.append('As colunas escolhidas explicam pouco da variação do número de funcionários (R² abaixo de 0,5).')
    if k >= 2:
        correlacao = np.corrcoef(X, rowvar=False)
        fora_da_diagonal = np.abs(correlacao - np.eye(k))
        if float(fora_da_diagonal.max()) > 0.95:
            avisos.append('Há colunas de entrada muito correlacionadas entre si; os coeficientes individuais podem ficar instáveis.')

    passo = max(1, math.ceil(n / 500))
    return {
        'entradas': list(entradas),
        'intercepto': float(coef[0]),
        'coeficientes': [
            {'nome': nome, 'valor': float(coef[i + 1]), 'importancia': (padronizados[i] / soma) if soma > 0 else 0.0}
            for i, nome in enumerate(entradas)
        ],
        'metricas': {
            'r2': r2, 'r2_ajustado': r2_ajustado,
            'mae': float(np.abs(residuos).mean()), 'rmse': float(np.sqrt(ss_res / n)), 'rmse_loo': rmse_loo,
        },
        'n_linhas': n,
        'faixa': {nome: [float(X[:, i].min()), float(X[:, i].max())] for i, nome in enumerate(entradas)},
        'avisos': avisos,
        'ajuste': [{'real': float(y[i]), 'previsto': float(previsto[i])} for i in range(0, n, passo)],
    }


def prever(parametros, valores):
    """parametros: o dicionário devolvido por treinar(); valores: {nome da entrada: número}."""
    total = parametros['intercepto']
    fora = []
    for c in parametros['coeficientes']:
        if c['nome'] not in valores:
            raise ErroModelo(f'Informe o valor de "{c["nome"]}".')
        try:
            valor = float(valores[c['nome']])
        except (TypeError, ValueError):
            raise ErroModelo(f'O valor de "{c["nome"]}" precisa ser um número.')
        if not math.isfinite(valor) or valor < 0:
            raise ErroModelo(f'O valor de "{c["nome"]}" precisa ser um número maior ou igual a zero.')
        total += c['valor'] * valor
        minimo, maximo = parametros['faixa'][c['nome']]
        if valor < minimo or valor > maximo:
            fora.append(c['nome'])
    bruto = round(float(total), 4)
    return {'previsto': bruto, 'funcionarios': max(1, math.ceil(bruto)), 'fora_da_faixa': fora}
