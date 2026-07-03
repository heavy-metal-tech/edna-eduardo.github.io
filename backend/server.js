require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { pool, init } = require('./db');

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

const SECRET   = process.env.JWT_SECRET  || 'dev-secret-troque-em-producao';
const ADM_USER = process.env.ADMIN_USER  || 'admin';
const ADM_HASH = process.env.ADMIN_HASH  || bcrypt.hashSync('admin123', 10);

/* ── Middleware de autenticação ─────────────────────────────────────────── */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Não autorizado' });
  }
}

/* ── Saúde ──────────────────────────────────────────────────────────────── */
app.get('/health', (_, res) => res.json({ ok: true }));

/* ── Auth ───────────────────────────────────────────────────────────────── */
app.post('/auth/login', async (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) return res.status(400).json({ error: 'Campos obrigatórios' });
  if (usuario !== ADM_USER) return res.status(401).json({ error: 'Credenciais inválidas' });
  const ok = await bcrypt.compare(senha, ADM_HASH);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
  const token = jwt.sign({ usuario }, SECRET, { expiresIn: '12h' });
  res.json({ token });
});

/* ── Imóveis (leitura pública) ──────────────────────────────────────────── */
app.get('/imoveis', async (req, res) => {
  try {
    const { tipo, finalidade, quartos, busca, destaque } = req.query;
    let q = 'SELECT * FROM imoveis WHERE ativo = true';
    const params = [];
    if (tipo)       { params.push(tipo);        q += ` AND tipo = $${params.length}`; }
    if (finalidade) { params.push(finalidade);  q += ` AND finalidade = $${params.length}`; }
    if (quartos)    { params.push(parseInt(quartos)); q += ` AND quartos >= $${params.length}`; }
    if (destaque === 'true') q += ' AND destaque = true';
    if (busca) {
      params.push(`%${busca}%`);
      q += ` AND (titulo ILIKE $${params.length} OR bairro ILIKE $${params.length} OR cidade ILIKE $${params.length})`;
    }
    q += ' ORDER BY destaque DESC, created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows.map(toApi));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/imoveis/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM imoveis WHERE id = $1 AND ativo = true', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(toApi(rows[0]));
  } catch (e) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

/* ── Imóveis (escrita — requer login) ───────────────────────────────────── */
app.post('/imoveis', auth, async (req, res) => {
  try {
    const d  = req.body;
    const { rows } = await pool.query(
      `INSERT INTO imoveis
        (codigo,titulo,tipo,finalidade,preco,area,quartos,suites,banheiros,vagas,
         condominio,iptu,bairro,cidade,estado,descricao,fotos,caracteristicas,destaque,ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [ nextCodigo(d), d.titulo, d.tipo, d.finalidade, d.preco, d.area||0,
        d.quartos||0, d.suites||0, d.banheiros||0, d.vagas||0,
        d.condominio||null, d.iptu||null, d.bairro, d.cidade, d.estado,
        d.descricao, JSON.stringify(d.fotos||[]), JSON.stringify(d.caracteristicas||[]),
        !!d.destaque, d.ativo !== false ]
    );
    res.status(201).json(toApi(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.put('/imoveis/:id', auth, async (req, res) => {
  try {
    const d = req.body;
    const { rows } = await pool.query(
      `UPDATE imoveis SET
        titulo=$1, tipo=$2, finalidade=$3, preco=$4, area=$5,
        quartos=$6, suites=$7, banheiros=$8, vagas=$9, condominio=$10,
        iptu=$11, bairro=$12, cidade=$13, estado=$14, descricao=$15,
        fotos=$16, caracteristicas=$17, destaque=$18, ativo=$19
       WHERE id=$20 RETURNING *`,
      [ d.titulo, d.tipo, d.finalidade, d.preco, d.area||0,
        d.quartos||0, d.suites||0, d.banheiros||0, d.vagas||0,
        d.condominio||null, d.iptu||null, d.bairro, d.cidade, d.estado,
        d.descricao, JSON.stringify(d.fotos||[]), JSON.stringify(d.caracteristicas||[]),
        !!d.destaque, d.ativo !== false, req.params.id ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(toApi(rows[0]));
  } catch (e) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.delete('/imoveis/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE imoveis SET ativo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

/* ── Leads ───────────────────────────────────────────────────────────────── */
app.post('/leads', async (req, res) => {
  try {
    const { nome, telefone, mensagem, imovelId } = req.body || {};
    if (!nome || !telefone) return res.status(400).json({ error: 'nome e telefone são obrigatórios' });
    await pool.query(
      'INSERT INTO leads (nome, telefone, mensagem, imovel_id) VALUES ($1,$2,$3,$4)',
      [nome, telefone, mensagem||null, imovelId||null]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/leads', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.*, i.titulo as imovel_titulo, i.codigo as imovel_codigo
      FROM leads l
      LEFT JOIN imoveis i ON i.id = l.imovel_id
      ORDER BY l.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function toApi(row) {
  return {
    id:             row.id,
    codigo:         row.codigo,
    titulo:         row.titulo,
    tipo:           row.tipo,
    finalidade:     row.finalidade,
    preco:          parseFloat(row.preco),
    area:           parseFloat(row.area) || 0,
    quartos:        row.quartos,
    suites:         row.suites,
    banheiros:      row.banheiros,
    vagas:          row.vagas,
    condominio:     row.condominio ? parseFloat(row.condominio) : null,
    iptu:           row.iptu ? parseFloat(row.iptu) : null,
    bairro:         row.bairro,
    cidade:         row.cidade,
    estado:         row.estado,
    descricao:      row.descricao,
    fotos:          row.fotos || [],
    caracteristicas:row.caracteristicas || [],
    destaque:       row.destaque,
    ativo:          row.ativo,
    dataCadastro:   row.data_cadastro,
  };
}

/* Gera próximo código EE000 baseado nos existentes no body ou usa timestamp */
function nextCodigo(d) {
  if (d.codigo) return d.codigo;
  return 'EE' + Date.now().toString().slice(-6);
}

/* ── Start ───────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3001;
init()
  .then(() => app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`)))
  .catch(e => { console.error('Falha ao inicializar BD:', e); process.exit(1); });
