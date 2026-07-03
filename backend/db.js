const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imoveis (
      id          SERIAL PRIMARY KEY,
      codigo      TEXT UNIQUE NOT NULL,
      titulo      TEXT NOT NULL,
      tipo        TEXT NOT NULL,
      finalidade  TEXT NOT NULL,
      preco       NUMERIC NOT NULL,
      area        NUMERIC DEFAULT 0,
      quartos     INT DEFAULT 0,
      suites      INT DEFAULT 0,
      banheiros   INT DEFAULT 0,
      vagas       INT DEFAULT 0,
      condominio  NUMERIC,
      iptu        NUMERIC,
      bairro      TEXT,
      cidade      TEXT,
      estado      TEXT,
      descricao   TEXT,
      fotos       JSONB DEFAULT '[]',
      caracteristicas JSONB DEFAULT '[]',
      destaque    BOOLEAN DEFAULT false,
      ativo       BOOLEAN DEFAULT true,
      data_cadastro DATE DEFAULT CURRENT_DATE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id         SERIAL PRIMARY KEY,
      nome       TEXT NOT NULL,
      telefone   TEXT NOT NULL,
      mensagem   TEXT,
      imovel_id  INT REFERENCES imoveis(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  /* Seed inicial — só insere se a tabela estiver vazia */
  const { rows } = await pool.query('SELECT COUNT(*) FROM imoveis');
  if (parseInt(rows[0].count) === 0) {
    const seed = require('./seed.json');
    for (const im of seed) {
      await pool.query(`
        INSERT INTO imoveis
          (codigo, titulo, tipo, finalidade, preco, area, quartos, suites,
           banheiros, vagas, condominio, iptu, bairro, cidade, estado,
           descricao, fotos, caracteristicas, destaque, ativo, data_cadastro)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      `, [
        im.codigo, im.titulo, im.tipo, im.finalidade, im.preco, im.area,
        im.quartos, im.suites, im.banheiros, im.vagas, im.condominio, im.iptu,
        im.bairro, im.cidade, im.estado, im.descricao,
        JSON.stringify(im.fotos), JSON.stringify(im.caracteristicas),
        im.destaque, im.ativo, im.dataCadastro
      ]);
    }
    console.log('Seed: %d imóveis inseridos', seed.length);
  }
}

module.exports = { pool, init };
