<script setup>
import { ref } from 'vue'
import AuditPage from './components/AuditPage.vue'
import KnowledgePage from './components/KnowledgePage.vue'
import HistoryPage from './components/HistoryPage.vue'

const currentPage = ref('audit')
const highlightIpId = ref(null)

function handleJumpToKnowledge(ipId) {
  currentPage.value = 'kb'
  highlightIpId.value = ipId
}
</script>

<template>
  <header style="
    position:sticky;top:0;z-index:100;
    display:flex;align-items:center;justify-content:space-between;
    padding:0 32px;height:58px;
    background:rgba(245,243,249,0.82);
    backdrop-filter:blur(18px);
    border-bottom:1px solid var(--line);
  ">
    <div style="display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px;color:var(--ink);">
      <div style="
        width:32px;height:32px;border-radius:9px;
        background:linear-gradient(135deg,#5b4fcf,#9b59b6);
        display:flex;align-items:center;justify-content:center;font-size:16px;
      ">🔍</div>
      IP 分析助手
    </div>

    <div style="display:flex;gap:4px;">
      <button
        v-for="tab in [{id:'audit',label:'产品审核'},{id:'history',label:'审核历史'},{id:'kb',label:'知识库管理'}]"
        :key="tab.id"
        @click="currentPage = tab.id"
        :style="{
          padding:'6px 16px',borderRadius:'20px',border:'none',cursor:'pointer',
          fontSize:'13px',fontWeight:'500',transition:'all .2s',
          background: currentPage === tab.id ? 'var(--accent)' : 'transparent',
          color: currentPage === tab.id ? '#fff' : 'var(--muted)'
        }"
      >{{ tab.label }}</button>
    </div>

    <div style="width:120px"></div>
  </header>

  <main style="max-width:1160px;margin:0 auto;padding:28px 24px 60px;">
    <AuditPage v-if="currentPage === 'audit'" @jump-to-knowledge="handleJumpToKnowledge" />
    <HistoryPage v-else-if="currentPage === 'history'" />
    <KnowledgePage v-else :highlight-ip-id="highlightIpId" />
  </main>
</template>
