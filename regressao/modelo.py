"""Regressão linear múltipla (mínimos quadrados ponderados com regularização leve).

Prevê quantos funcionários um projeto exige a partir de quatro características:
    n_itens        quantidade de itens do projeto
    qtd_total      soma das quantidades de todos os itens
    n_atividades   quantas atividades entram (montagem, almoxarifado, usinagem): 1 a 3
    prazo_dias     prazo do projeto, em dias

Só usa numpy. O modelo é ajustado a cada pedido: os dados são poucos, então o ajuste custa
milissegundos e o resultado nunca fica defasado em relação aos projetos concluídos.
"""
import numpy as np

CAMPOS = ['n_itens', 'qtd_total', 'n_atividades', 'prazo_dias']

# Um projeto real pesa mais que um exemplo mockado. Quanto mais histórico real o usuário
# tem, menos os exemplos pesam: com 0 projetos reais cada exemplo vale 1; com 5 vale 0,5;
# com 20 vale 0,2. Assim a previsão "se ajusta" aos dados que o gestor insere.
PESO_REAL = 3.0
LAMBDA = 1.0  # regularização leve (ridge): estabiliza quando itens e unidades andam juntos


def gerar_exemplos(n=40, semente=42):
    """Projetos de exemplo (mockados), determinísticos: o mesmo conjunto a cada chamada."""
    rng = np.random.default_rng(semente)
    n_itens = rng.integers(3, 61, size=n)
    qtd_total = np.round(n_itens * rng.uniform(2, 12, size=n))
    n_atividades = rng.integers(1, 4, size=n)
    prazo = rng.integers(5, 91, size=n)
    ruido = rng.normal(0, 0.6, size=n)

    funcionarios = 1.0 + 0.05 * n_itens + 0.008 * qtd_total + 1.0 * n_atividades - 0.02 * prazo + ruido
    funcionarios = np.maximum(1, np.round(funcionarios))

    X = np.column_stack([n_itens, qtd_total, n_atividades, prazo]).astype(float)
    return X, funcionarios.astype(float)


def _ajustar(X, y, w, lam=LAMBDA):
    """Mínimos quadrados ponderados com ridge, em variáveis padronizadas."""
    soma_w = w.sum()
    mu = (w[:, None] * X).sum(axis=0) / soma_w
    desvio = np.sqrt((w[:, None] * (X - mu) ** 2).sum(axis=0) / soma_w)
    desvio[desvio < 1e-9] = 1.0  # coluna constante: não divide por zero

    Z = (X - mu) / desvio
    y_medio = (w * y).sum() / soma_w

    A = Z.T @ (w[:, None] * Z) + lam * np.eye(Z.shape[1])
    b = Z.T @ (w * (y - y_medio))
    beta = np.linalg.solve(A, b)
    return {'mu': mu, 'desvio': desvio, 'beta': beta, 'y_medio': y_medio}


def _estimar(modelo, X):
    return modelo['y_medio'] + ((X - modelo['mu']) / modelo['desvio']) @ modelo['beta']


def treinar(X_reais=None, y_reais=None):
    """Treina com os exemplos + os projetos reais concluídos do usuário (se houver)."""
    X, y = gerar_exemplos()
    n_exemplos = len(y)
    n_reais = 0 if y_reais is None else len(y_reais)

    pesos = np.full(n_exemplos, 1.0 / (1.0 + n_reais / 5.0))
    if n_reais:
        X = np.vstack([X, np.asarray(X_reais, dtype=float)])
        y = np.concatenate([y, np.asarray(y_reais, dtype=float)])
        pesos = np.concatenate([pesos, np.full(n_reais, PESO_REAL)])

    modelo = _ajustar(X, y, pesos)

    # R² ponderado, sobre os dados de treino (indica o quanto as 4 características explicam)
    previsto = _estimar(modelo, X)
    ss_res = (pesos * (y - previsto) ** 2).sum()
    ss_tot = (pesos * (y - modelo['y_medio']) ** 2).sum()
    modelo['r2'] = float(1.0 - ss_res / ss_tot) if ss_tot > 0 else None

    modelo['minimos'] = X.min(axis=0)
    modelo['maximos'] = X.max(axis=0)
    modelo['n_exemplos'] = n_exemplos
    modelo['n_reais'] = n_reais
    return modelo


def prever(modelo, caracteristicas):
    """caracteristicas: dict com os 4 campos. Devolve o resultado pronto para a API."""
    x = np.array([[float(caracteristicas[c]) for c in CAMPOS]])
    bruto = float(_estimar(modelo, x)[0])

    fora = [
        c for i, c in enumerate(CAMPOS)
        if x[0, i] < modelo['minimos'][i] or x[0, i] > modelo['maximos'][i]
    ]
    return {
        'funcionarios_previstos': round(max(1.0, bruto), 2),
        'amostras': modelo['n_exemplos'] + modelo['n_reais'],
        'amostras_reais': modelo['n_reais'],
        'amostras_exemplo': modelo['n_exemplos'],
        'r2': None if modelo['r2'] is None else round(modelo['r2'], 3),
        # valores fora do que o modelo viu: a previsão ali é extrapolação, menos confiável
        'fora_da_faixa': fora,
    }
