const multer = require('multer');

const TAMANHO_MAXIMO_MB = Number(process.env.PROFILE_IMAGE_MAX_SIZE_MB || 5);
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const EXTENSAO_POR_TIPO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// memoryStorage: o arquivo fica em req.file.buffer, precisamos dele em mãos tanto pra
// inspecionar os bytes reais quanto pra mandar direto pro Garage, sem tocar disco local.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_MB * 1024 * 1024 },
});

/**
 * Nunca confia no Content-Type nem na extensão do nome original enviados pelo cliente —
 * os dois vêm do multipart/form-data e são fáceis de forjar (basta renomear um .exe pra
 * .jpg). A checagem real lê os primeiros bytes do arquivo (magic numbers) e descobre o
 * tipo de verdade, ignorando qualquer coisa que o próprio arquivo diga sobre si mesmo.
 */
async function validarImagemPerfil(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ erro: 'Nenhum arquivo enviado. Use o campo "foto".' });
  }

  // file-type é ESM puro (não dá pra usar require normal); import() dinâmico funciona
  // mesmo dentro de um projeto CommonJS.
  //
  // try/catch obrigatório: o Express 4 NÃO captura erro de função async. Sem ele, uma falha
  // aqui deixaria a requisição pendurada e, no Node 20, derrubaria o processo inteiro
  // (unhandled rejection).
  let tipoReal;
  try {
    const { fileTypeFromBuffer } = await import('file-type');
    tipoReal = await fileTypeFromBuffer(req.file.buffer);
  } catch (erro) {
    console.error('[perfil-service] Falha ao validar a imagem:', erro);
    return res.status(500).json({ erro: 'Não foi possível validar a imagem. Tente novamente.' });
  }

  if (!tipoReal || !TIPOS_PERMITIDOS.includes(tipoReal.mime)) {
    return res.status(415).json({
      erro: 'Tipo de arquivo não suportado. Envie uma imagem JPEG, PNG ou WEBP.',
    });
  }

  req.imagemValidada = {
    extensao: EXTENSAO_POR_TIPO[tipoReal.mime],
    mimeType: tipoReal.mime,
  };

  next();
}

/** Middleware de erro do multer (ex: LIMIT_FILE_SIZE) — usar depois da rota de upload. */
function tratarErroUpload(erro, req, res, next) {
  if (erro && erro.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      erro: `Arquivo muito grande. Tamanho máximo: ${TAMANHO_MAXIMO_MB}MB.`,
    });
  }

  // outros erros do multer (ex.: arquivo enviado em um campo que não se chama "foto")
  // são erro do cliente: respondem 400 em vez de cair no 500 padrão do Express
  if (erro instanceof multer.MulterError) {
    const mensagem = erro.code === 'LIMIT_UNEXPECTED_FILE'
      ? 'Campo de arquivo inesperado. Use o campo "foto".'
      : 'Não foi possível ler o arquivo enviado.';
    return res.status(400).json({ erro: mensagem });
  }

  next(erro);
}

module.exports = { upload, validarImagemPerfil, tratarErroUpload };