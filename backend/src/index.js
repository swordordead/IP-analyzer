require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')

const analyzeRouter = require('./routes/analyze')
const knowledgeRouter = require('./routes/knowledge')
const { initDB, shutdown } = require('./services/db')

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

app.use('/api/analyze', analyzeRouter)
app.use('/api/knowledge', knowledgeRouter)

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

async function start() {
  await initDB()
  const server = app.listen(PORT, () => {
    console.log(`IP Analyzer backend running on port ${PORT}`)
  })

  // 优雅关闭：等待在途请求完成，再关闭数据库
  function gracefulShutdown(signal) {
    console.log(`[Server] 收到 ${signal}，正在优雅关闭...`)
    server.close(async () => {
      shutdown()
      console.log('[Server] 已关闭')
      process.exit(0)
    })
    // 10 秒强制退出兜底
    setTimeout(() => {
      console.error('[Server] 强制退出（超时）')
      shutdown()
      process.exit(1)
    }, 10_000)
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'))

  // 未捕获异常时也尝试落盘
  process.on('uncaughtException', (err) => {
    console.error('[Server] 未捕获异常:', err)
    shutdown()
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[Server] 未处理的 Promise 拒绝:', reason)
  })
}

start().catch(console.error)

