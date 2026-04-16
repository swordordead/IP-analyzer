<script setup>
import { ref, onMounted } from 'vue'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const records = ref([])
const total = ref(0)
const page = ref(1)
const limit = 20
const loading = ref(false)
const selectedRecord = ref(null)
const detailLoading = ref(false)

onMounted(fetchHistory)

async function fetchHistory() {
  loading.value = true
  try {
    const res = await fetch(`${API_BASE}/api/analyze/history?page=${page.value}&limit=${limit}`)
    const data = await res.json()
    if (data.success) {
      records.value = data.data
      total.value = data.total
    }
  } catch(e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function handleSelectRecord(record) {
  if (selectedRecord.value?.id === record.id) return
  detailLoading.value = true
  selectedRecord.value = { ...record, result: null }
  try {
    const res = await fetch(`${API_BASE}/api/analyze/history/${record.id}`)
    const data = await res.json()
    if (data.success) selectedRecord.value = data.data
  } catch(e) {
    console.error(e)
  } finally {
    detailLoading.value = false
  }
}

async function handlePage(delta) {
  page.value += delta
  selectedRecord.value = null
  await fetchHistory()
}

function riskStyle(level) {
  const map = {
    1: { color: '#2f7a54', bg: 'rgba(47,122,84,0.1)' },
    2: { color: '#d18d23', bg: 'rgba(209,141,35,0.1)' },
    3: { color: '#e07820', bg: 'rgba(224,120,32,0.1)' },
    4: { color: '#c0392b', bg: 'rgba(192,57,43,0.1)' },
    5: { color: '#8b0000', bg: 'rgba(139,0,0,0.12)' },
  }
  return map[level] || map[2]
}

function verdictStyle(v) {
  if (v === '通过')   return { color: '#2f7a54', bg: 'rgba(47,122,84,0.1)' }
  if (v === '不通过') return { color: '#c0392b', bg: 'rgba(192,57,43,0.1)' }
  return { color: '#d18d23', bg: 'rgba(209,141,35,0.1)' }
}

function dimensionColor(r) {
  if (r === '有区别') return { bg: 'rgba(47,122,84,0.08)', color: '#2f7a54', dot: '#2f7a54' }
  if (r === '近似')   return { bg: 'rgba(209,141,35,0.08)', color: '#d18d23', dot: '#d18d23' }
  return { bg: 'rgba(192,57,43,0.08)', color: '#c0392b', dot: '#c0392b' }
}

function elementTypeLabel(type) {
  const map = { '原创首创': '首创·90%', '原创独创': '独创·禁', '非原创': '非原创·50%', '注册商标': '商标·禁', '原创台词': '台词·禁' }
  return map[type] || type
}

function elementStatusStyle(s) {
  if (s === '通过')   return { bg: 'rgba(47,122,84,0.1)',  color: '#2f7a54' }
  if (s === '不通过') return { bg: 'rgba(192,57,43,0.1)', color: '#c0392b' }
  return { bg: 'rgba(209,141,35,0.1)', color: '#d18d23' }
}

function formatTime(dt) {
  if (!dt) return ''
  return dt.replace('T', ' ').slice(0, 16)
}

const totalPages = () => Math.ceil(total.value / limit)
</script>

<template>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;">

    <!-- 左列：列表 -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <h2 style="font-size:18px;font-weight:700;">审核历史</h2>
        <span style="font-size:12px;color:var(--muted);">共 {{ total }} 条记录</span>
      </div>

      <div v-if="loading" style="display:flex;align-items:center;gap:10px;padding:40px;color:var(--muted);font-size:13px;">
        <div class="spinner"></div>加载中…
      </div>

      <div v-else-if="records.length === 0" style="text-align:center;padding:60px 0;color:var(--muted);font-size:13px;opacity:.7;">
        暂无审核记录
      </div>

      <div v-else style="display:flex;flex-direction:column;gap:6px;">
        <div
          v-for="r in records" :key="r.id"
          @click="handleSelectRecord(r)"
          :style="{
            padding:'12px 14px',borderRadius:'12px',cursor:'pointer',
            border: selectedRecord?.id === r.id ? '2px solid var(--accent)' : '1.5px solid var(--line)',
            background: selectedRecord?.id === r.id ? 'rgba(91,79,207,0.04)' : 'var(--panel)',
            transition:'all .15s'
          }"
        >
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
            <span style="font-size:13px;font-weight:700;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ r.ip_name || '未知IP' }}</span>
            <span :style="{padding:'1px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',...riskStyle(r.risk_level)}">{{ r.risk_label }}</span>
            <span :style="{padding:'1px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',...verdictStyle(r.verdict)}">{{ r.verdict }}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px;">{{ r.product_desc }}</div>
          <div style="font-size:10px;color:var(--muted);opacity:.6;">{{ formatTime(r.created_at) }}</div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages() > 1" style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px;">
        <button
          :disabled="page <= 1"
          @click="handlePage(-1)"
          style="padding:5px 14px;border-radius:8px;border:1.5px solid var(--line);background:var(--panel);color:var(--muted);font-size:12px;cursor:pointer;disabled:opacity:.4;"
        >上一页</button>
        <span style="font-size:12px;color:var(--muted);">{{ page }} / {{ totalPages() }}</span>
        <button
          :disabled="page >= totalPages()"
          @click="handlePage(1)"
          style="padding:5px 14px;border-radius:8px;border:1.5px solid var(--line);background:var(--panel);color:var(--muted);font-size:12px;cursor:pointer;"
        >下一页</button>
      </div>
    </div>

    <!-- 右列：详情 -->
    <div>
      <div v-if="!selectedRecord" class="card" style="padding:60px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;opacity:.6;">
        点击左侧记录查看完整分析结果
      </div>

      <div v-else-if="detailLoading" class="card" style="padding:60px;display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div class="spinner"></div>
        <div style="font-size:12px;color:var(--muted);">加载中…</div>
      </div>

      <div v-else-if="selectedRecord.result">
        <!-- 低置信度提示 -->
        <div v-if="selectedRecord.result.lowConfidence" style="padding:10px 12px;border-radius:8px;background:var(--warn-soft);border:1px solid rgba(209,141,35,0.3);margin-bottom:10px;font-size:12px;color:#7a5a00;">
          低置信度：{{ selectedRecord.result.lowConfidenceNote }}
        </div>

        <!-- 风险等级 -->
        <div class="card" style="padding:16px;margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em;">风险评估</div>
          <div :style="{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',borderRadius:'10px',background:riskStyle(selectedRecord.result.riskLevel.level).bg,border:`2px solid ${riskStyle(selectedRecord.result.riskLevel.level).color}40`,marginBottom:'10px'}">
            <div>
              <div :style="{fontSize:'20px',fontWeight:'800',color:riskStyle(selectedRecord.result.riskLevel.level).color}">{{ selectedRecord.result.riskLevel.label }}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">Lv.{{ selectedRecord.result.riskLevel.level }} / 5</div>
            </div>
            <div style="text-align:right;">
              <div :style="{fontSize:'26px',fontWeight:'800',color:riskStyle(selectedRecord.result.riskLevel.level).color}">{{ selectedRecord.result.riskLevel.differenceRate }}</div>
              <div style="font-size:10px;color:var(--muted);">区别率 · 投诉概率 {{ selectedRecord.result.riskLevel.complaintRate }}</div>
            </div>
          </div>
          <div :style="{borderRadius:'8px',padding:'12px 14px',border:`1.5px solid ${verdictStyle(selectedRecord.result.verdict).color}40`,background:verdictStyle(selectedRecord.result.verdict).bg}">
            <div :style="{fontSize:'14px',fontWeight:'700',color:verdictStyle(selectedRecord.result.verdict).color,marginBottom:'5px'}">总体结论：{{ selectedRecord.result.verdict }}</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.6;">{{ selectedRecord.result.verdictReason }}</div>
          </div>
        </div>

        <!-- 改款建议 -->
        <div v-if="selectedRecord.result.suggestions && selectedRecord.result.suggestions.length" class="card" style="padding:16px;margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em;">改款建议</div>
          <div v-for="(sug, i) in selectedRecord.result.suggestions" :key="i"
            style="display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border-radius:7px;background:rgba(91,79,207,0.05);margin-bottom:5px;border:1px solid rgba(91,79,207,0.1);"
          >
            <div style="width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">{{ i+1 }}</div>
            <div style="font-size:12px;color:var(--ink);line-height:1.5;">{{ sug }}</div>
          </div>
        </div>

        <!-- 7维比对 + 元素 + 组合 -->
        <div class="card" style="padding:16px;">
          <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em;">7 维区别比对</div>
          <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px;">
            <div v-for="dim in selectedRecord.result.comparison" :key="dim.index"
              :style="{display:'flex',alignItems:'flex-start',gap:'8px',padding:'7px 10px',borderRadius:'7px',background:dimensionColor(dim.result).bg}"
            >
              <div :style="{width:'18px',height:'18px',borderRadius:'50%',flexShrink:'0',marginTop:'1px',border:`2px solid ${dimensionColor(dim.result).dot}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'9px',fontWeight:'700',color:dimensionColor(dim.result).color}">{{ dim.index }}</div>
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                  <span style="font-size:12px;font-weight:600;color:var(--ink);">{{ dim.dimension }}</span>
                  <span :style="{padding:'1px 6px',borderRadius:'20px',fontSize:'10px',fontWeight:'700',color:dimensionColor(dim.result).color}">{{ dim.result }}</span>
                </div>
                <div style="font-size:11px;color:var(--muted);line-height:1.4;">{{ dim.detail }}</div>
              </div>
            </div>
          </div>

          <div v-if="selectedRecord.result.elements && selectedRecord.result.elements.length">
            <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;">元素判断（{{ selectedRecord.result.elements.length }} 个）</div>
            <div v-for="el in selectedRecord.result.elements" :key="el.name"
              style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:7px;border:1px solid var(--line);background:var(--panel-strong);margin-bottom:5px;"
            >
              <div :style="{padding:'1px 7px',borderRadius:'20px',fontSize:'10px',fontWeight:'600',flexShrink:'0',marginTop:'2px',...elementStatusStyle(el.status)}">{{ el.status }}</div>
              <div>
                <div style="font-size:12px;font-weight:600;color:var(--ink);">
                  {{ el.name }}
                  <span style="margin-left:5px;padding:1px 6px;border-radius:20px;font-size:10px;background:rgba(91,79,207,0.1);color:var(--accent);">{{ elementTypeLabel(el.type) }}</span>
                </div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.4;">{{ el.reason }}</div>
              </div>
            </div>
          </div>

          <div v-if="selectedRecord.result.combos && selectedRecord.result.combos.some(c => c.triggered)">
            <div style="height:1px;background:var(--line);margin:10px 0;"></div>
            <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;">组合风险</div>
            <div v-for="combo in selectedRecord.result.combos.filter(c => c.triggered)" :key="combo.ruleType"
              style="padding:8px 10px;border-radius:7px;border-left:3px solid var(--danger);background:var(--danger-soft);margin-bottom:5px;"
            >
              <div style="font-size:11px;font-weight:700;color:var(--danger);margin-bottom:3px;">触发：{{ combo.ruleType }}</div>
              <div style="font-size:11px;color:var(--muted);">{{ combo.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>
