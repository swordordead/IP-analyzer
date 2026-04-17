const express = require('express')
const multer = require('multer')
const path = require('path')
const { db } = require('../services/db')
const { analyzeProduct, identifyIP } = require('../services/gemini')

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

    // 直接用 Gemini 名单匹配（跳过向量检索）
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
                'SELECT image_data, media_type FROM ip_images WHERE ip_id=? AND image_data IS NOT NULL ORDER BY sort_order LIMIT 5',
                [profile.id]
              )
              ipProfile = {
                ...profile, elements, combos,
                refImages: refImgs.map(r => ({ buffer: r.image_data, mediaType: r.media_type || 'image/jpeg' })),
                fontRefImage: profile.font_ref_image_data ? { buffer: profile.font_ref_image_data, mediaType: profile.font_ref_media_type || 'image/jpeg' } : null
              }
            }
          }
        }
      } catch (e) {
        console.log('[名单匹配] 失败，使用通用框架:', e.message)
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
