const mysql = require('mysql2/promise')
const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

let pool = null
let sqliteDb = null
let useMySQL = false
const DB_FILE = path.join(__dirname, '../../data/ip_analyzer.sqlite')

function persist() {
  if (!sqliteDb) return
  try {
    const dir = path.dirname(DB_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(DB_FILE, Buffer.from(sqliteDb.export()))
  } catch (e) {
    console.warn('[DB] SQLite 持久化失败:', e.message)
  }
}

function shutdown() {
  if (useMySQL) {
    try { pool.end() } catch(e) {}
    return
  }
  persist()
  try { sqliteDb.close() } catch(e) {}
}

function sqliteQuery(sql, params = [], skipPersist = false) {
  const finalSql = sql.replace(/\bNOW\(\)/gi, "datetime('now','localtime')")
  const lower = finalSql.trim().toLowerCase()
  const bindParams = params.map(p => (p === undefined || p === null) ? null : p)

  if (lower.startsWith('select') || lower.startsWith('pragma') || lower.startsWith('with')) {
    const stmt = sqliteDb.prepare(finalSql)
    const rows = []
    if (bindParams.length > 0) stmt.bind(bindParams)
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return [rows]
  } else {
    sqliteDb.run(finalSql, bindParams.length > 0 ? bindParams : undefined)
    let insertId = 0
    if (lower.startsWith('insert')) {
      const r = sqliteDb.exec('SELECT last_insert_rowid()')
      insertId = r[0]?.values[0][0] || 0
    }
    if (!skipPersist) persist()
    return [{ insertId, affectedRows: sqliteDb.getRowsModified() }]
  }
}

function createSQLiteTables() {
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS ip_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner TEXT DEFAULT '',
      icon TEXT DEFAULT '🎭',
      font_ref_image_path TEXT,
      embeddings TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)
  try { sqliteDb.run('ALTER TABLE ip_profiles ADD COLUMN embeddings TEXT') } catch(e) {}
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS ip_elements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_id INTEGER NOT NULL,
      element_name TEXT NOT NULL,
      element_type TEXT NOT NULL,
      description TEXT DEFAULT '',
      FOREIGN KEY (ip_id) REFERENCES ip_profiles(id) ON DELETE CASCADE
    )
  `)
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS ip_combos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_id INTEGER NOT NULL,
      rule_type TEXT NOT NULL,
      description TEXT DEFAULT '',
      FOREIGN KEY (ip_id) REFERENCES ip_profiles(id) ON DELETE CASCADE
    )
  `)
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS audit_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_name TEXT,
      product_desc TEXT,
      risk_level INTEGER,
      risk_label TEXT,
      verdict TEXT,
      result_json TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS ip_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_id INTEGER NOT NULL,
      file_path TEXT,
      image_data BLOB,
      media_type TEXT DEFAULT 'image/jpeg',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (ip_id) REFERENCES ip_profiles(id) ON DELETE CASCADE
    )
  `)
  try { sqliteDb.run('ALTER TABLE ip_images ADD COLUMN image_data BLOB') } catch(e) {}
  try { sqliteDb.run('ALTER TABLE ip_images ADD COLUMN media_type TEXT DEFAULT \'image/jpeg\'') } catch(e) {}
  try { sqliteDb.run('ALTER TABLE ip_profiles ADD COLUMN font_ref_image_data BLOB') } catch(e) {}
  try { sqliteDb.run('ALTER TABLE ip_profiles ADD COLUMN font_ref_media_type TEXT') } catch(e) {}
}

async function initDB() {
  const host = process.env.MYSQL_HOST || ''
  const password = process.env.MYSQL_PASSWORD || ''
  // Zeabur 注入的变量名可能是 MYSQL_USERNAME 或 MYSQL_USER，两者都支持
  const username = process.env.MYSQL_USERNAME || process.env.MYSQL_USER || 'root'

  if (host && password && password !== '请填写本地数据库密码') {
    try {
      const dbName = process.env.MYSQL_DATABASE || 'ip_analyzer'
      const port = parseInt(process.env.MYSQL_PORT || '3306')

      // 先不带 database 连接，自动建库
      const tempPool = mysql.createPool({ host, port, user: username, password, waitForConnections: true, connectionLimit: 2, timezone: '+08:00', connectTimeout: 5000 })
      const tempConn = await tempPool.getConnection()
      await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
      tempConn.release()
      await tempPool.end()

      pool = mysql.createPool({
        host,
        port,
        database: dbName,
        user: username,
        password,
        waitForConnections: true,
        connectionLimit: 10,
        timezone: '+08:00',
        connectTimeout: 5000
      })
      const conn = await pool.getConnection()
      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS ip_profiles (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            owner VARCHAR(300) DEFAULT '',
            icon VARCHAR(10) DEFAULT '🎭',
            font_ref_image_path VARCHAR(500),
            embeddings MEDIUMTEXT,
            created_at DATETIME DEFAULT NOW(),
            updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
          ) CHARACTER SET utf8mb4
        `)
        try { await conn.query('ALTER TABLE ip_profiles ADD COLUMN embeddings MEDIUMTEXT') } catch(e) {}
        await conn.query(`
          CREATE TABLE IF NOT EXISTS ip_elements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ip_id INT NOT NULL,
            element_name VARCHAR(300) NOT NULL,
            element_type ENUM('原创首创','原创独创','非原创','注册商标','原创台词') NOT NULL,
            description TEXT,
            FOREIGN KEY (ip_id) REFERENCES ip_profiles(id) ON DELETE CASCADE
          ) CHARACTER SET utf8mb4
        `)
        await conn.query(`
          CREATE TABLE IF NOT EXISTS ip_combos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ip_id INT NOT NULL,
            rule_type ENUM('外界指向性','设计理念','产品关联性','现实逻辑') NOT NULL,
            description TEXT,
            FOREIGN KEY (ip_id) REFERENCES ip_profiles(id) ON DELETE CASCADE
          ) CHARACTER SET utf8mb4
        `)
        await conn.query(`
          CREATE TABLE IF NOT EXISTS audit_records (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ip_name VARCHAR(200),
            product_desc VARCHAR(500),
            risk_level INT,
            risk_label VARCHAR(50),
            verdict VARCHAR(20),
            result_json MEDIUMTEXT,
            created_at DATETIME DEFAULT NOW()
          ) CHARACTER SET utf8mb4
        `)
        await conn.query(`
          CREATE TABLE IF NOT EXISTS ip_images (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ip_id INT NOT NULL,
            file_path VARCHAR(500),
            image_data LONGBLOB,
            media_type VARCHAR(50) DEFAULT 'image/jpeg',
            sort_order INT DEFAULT 0,
            FOREIGN KEY (ip_id) REFERENCES ip_profiles(id) ON DELETE CASCADE
          ) CHARACTER SET utf8mb4
        `)
        try { await conn.query('ALTER TABLE ip_images ADD COLUMN image_data LONGBLOB') } catch(e) {}
        try { await conn.query('ALTER TABLE ip_images ADD COLUMN media_type VARCHAR(50) DEFAULT \'image/jpeg\'') } catch(e) {}
        try { await conn.query('ALTER TABLE ip_profiles ADD COLUMN font_ref_image_data LONGBLOB') } catch(e) {}
        try { await conn.query('ALTER TABLE ip_profiles ADD COLUMN font_ref_media_type VARCHAR(50)') } catch(e) {}
        useMySQL = true
        console.log('[DB] MySQL 连接成功，数据库初始化完成')
      } finally {
        conn.release()
      }
      return
    } catch (err) {
      console.warn(`[DB] MySQL 连接失败（${err.message}），降级为 SQLite`)
      pool = null
    }
  }

  try {
    const SQL = await initSqlJs()
    const dir = path.dirname(DB_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    if (fs.existsSync(DB_FILE)) {
      sqliteDb = new SQL.Database(fs.readFileSync(DB_FILE))
      console.log('[DB] 加载已有 SQLite 数据库:', DB_FILE)
    } else {
      sqliteDb = new SQL.Database()
      console.log('[DB] 创建新 SQLite 数据库:', DB_FILE)
    }

    sqliteDb.run('PRAGMA foreign_keys = ON')
    createSQLiteTables()
    persist()
    console.log('[DB] SQLite 初始化完成，数据重启后保留')
  } catch (err) {
    console.error('[DB] SQLite 初始化失败:', err.message)
    throw err
  }
}

const db = {
  async query(sql, params = []) {
    if (useMySQL) return pool.query(sql, params)
    return sqliteQuery(sql, params)
  },

  async getConnection() {
    if (useMySQL) return pool.getConnection()
    let inTx = false
    return {
      query: async (sql, params = []) => sqliteQuery(sql, params, true),
      beginTransaction: async () => { sqliteDb.run('BEGIN TRANSACTION'); inTx = true },
      commit: async () => { if (inTx) { sqliteDb.run('COMMIT'); inTx = false; persist() } },
      rollback: async () => { try { if (inTx) { sqliteDb.run('ROLLBACK'); inTx = false } } catch(e) {} },
      release: () => {}
    }
  }
}

module.exports = { db, initDB, shutdown }
