const express = require('express')
const multer = require('multer')
const path = require('path')
const { db } = require('../services/db')
const { analyzeProduct, identifyIP, generateEmbedding, cosineSimilarity } = require('../services/gemini')

const router = express.Router()

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `product_${Date.now()}${ext}`)
  }
})
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } })

// GET /api/analyze/history - 历史记录列表
router.get('/history', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(50, parseInt(req.query.limit) || 20)
    const offset = (page - 1) * limit

    const [rows] = await db.query(
      'SELECT id, ip_name, product_desc, risk_level, risk_label, verdict, created_at FROM audit_records ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    )
    const [countRows] = await db.query('SELECT COUNT(*) as total FROM audit_records')
    const total = countRows[0]?.total || 0

    res.json({ success: true, data: rows, total, page, limit })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/analyze/history/:id - 历史记录详情
router.get('/history/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM audit_records WHERE id=?', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: '记录不存在' })
    const record = rows[0]
    record.result = JSON.parse(record.result_json)
    delete record.result_json
    res.json({ success: true, data: record })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/analyze
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { description } = req.body
    const imagePath = req.file ? req.file.path : null

    if (!description) {
      return res.status(400).json({ error: '请填写产品描述' })
    }

    let ipProfile = null

    // 优先尝试向量检索
    try {
      const [profilesWithVec] = await db.query(
        'SELECT id, name, embeddings FROM ip_profiles WHERE embeddings IS NOT NULL'
      )

      if (profilesWithVec.length > 0) {
        const queryVec = await generateEmbedding(description)
        const ranked = profilesWithVec
          .map(p => ({ ...p, score: cosineSimilarity(queryVec, JSON.parse(p.embeddings)) }))
          .sort((a, b) => b.score - a.score)

        const topMatch = ranked[0]?.score > 0.7 ? ranked[0] : null
        console.log(`[向量检索] Top1: ${ranked[0]?.name} score=${ranked[0]?.score?.toFixed(3)}`)

        if (topMatch) {
          const [rows] = await db.query('SELECT * FROM ip_profiles WHERE id=?', [topMatch.id])
          if (rows.length > 0) {
            const profile = rows[0]
            const [elements] = await db.query('SELECT * FROM ip_elements WHERE ip_id = ?', [profile.id])
            const [combos] = await db.query('SELECT * FROM ip_combos WHERE ip_id = ?', [profile.id])
            const [refImgs] = await db.query(
              'SELECT file_path FROM ip_images WHERE ip_id=? ORDER BY sort_order LIMIT 5',
              [profile.id]
            )
            ipProfile = {
              ...profile, elements, combos,
              refImagePaths: refImgs.map(r => path.join(__dirname, '../../', r.file_path))
            }
          }
        }
      }
    } catch (e) {
      console.warn('[向量检索] 失败，降级到名单匹配:', e.message)
    }

    // 降级：向量检索未命中时，用旧的名单匹配
    if (!ipProfile) {
      try {
        const [profiles] = await db.query('SELECT id, name FROM ip_profiles ORDER BY updated_at DESC')
        const ipNames = profiles.map(p => p.name)
        if (ipNames.length > 0) {
          const identified = await identifyIP({ description, imagePath, ipNames })
          if (identified.inKnowledgeBase && identified.ipName) {
            const [rows] = await db.query(
              'SELECT * FROM ip_profiles WHERE name LIKE ? LIMIT 1',
              [`%${identified.ipName}%`]
            )
            if (rows.length > 0) {
              const profile = rows[0]
              const [elements] = await db.query('SELECT * FROM ip_elements WHERE ip_id = ?', [profile.id])
              const [combos] = await db.query('SELECT * FROM ip_combos WHERE ip_id = ?', [profile.id])
              const [refImgs] = await db.query(
                'SELECT file_path FROM ip_images WHERE ip_id=? ORDER BY sort_order LIMIT 5',
                [profile.id]
              )
              ipProfile = {
                ...profile, elements, combos,
                refImagePaths: refImgs.map(r => path.join(__dirname, '../../', r.file_path))
              }
            }
          }
        }
      } catch (e) {
        console.log('[名单匹配] 失败，使用通用框架:', e.message)
      }
    }

    // 执行完整分析
    const result = await analyzeProduct({ imagePath, description, ipProfile })

    if (ipProfile) {
      result.ip.id = ipProfile.id
    }

    // 持久化分析记录
    try {
      await db.query(
        'INSERT INTO audit_records (ip_name, product_desc, risk_level, risk_label, verdict, result_json) VALUES (?,?,?,?,?,?)',
        [result.ip.name, description.slice(0, 500), result.riskLevel.level, result.riskLevel.label, result.verdict, JSON.stringify(result)]
      )
    } catch (e) {
      console.warn('[历史记录] 写入失败:', e.message)
    }

    res.json({ success: true, data: result })

  } catch (err) {
    console.error('Analyze error:', err)
    res.status(500).json({ error: err.message || '分析失败，请重试' })
  }
})

module.exports = router
