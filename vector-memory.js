// ========================================
// 变量记忆系统 (Variable Memory System)
// 原向量记忆的全面升级版：支持自由时间戳、精细分类
// ========================================

class VariableMemoryManager {
  constructor() {
    // 10大精细化分类
    this.DEFAULT_CATEGORIES = {
      U: { name: '用户设定', color: '#007aff', icon: '', desc: '外貌、性格、喜好、职业等' },
      A: { name: '角色设定', color: '#5856d6', icon: '', desc: 'AI外貌、习惯、状态变化' },
      R: { name: '关系发展', color: '#ff2d55', icon: '', desc: '里程碑、亲密互动、称呼变化' },
      E: { name: '经历/事件', color: '#34c759', icon: '', desc: '共同经历、日常趣事' },
      I: { name: '物品/礼物', color: '#af52de', icon: '', desc: '互赠礼物、共同拥有的物品' },
      L: { name: '地点/场景', color: '#00c7be', icon: '', desc: '重要的地点记忆' },
      P: { name: '承诺/计划', color: '#ff9500', icon: '', desc: '未来的约定、待办事项' },
      T: { name: '禁忌/规则', color: '#ff3b30', icon: '', desc: '雷区、不能提的话题、特殊规矩' },
      M: { name: '情绪/心理', color: '#e58e26', icon: '', desc: '感动瞬间、心理阴影、深层吐露' },
      C: { name: '核心灵魂', color: '#ff0000', icon: '', desc: '最高优先级、不可遗忘的绝对设定' }
    };
    this.embeddingCache = new Map();
    this._embeddingQueue = [];
    this._isProcessingQueue = false;
    
    this.DEFAULT_EXTRACTION_PROMPT = `# 你的任务
你是"{{角色名}}"。请阅读下面的最新对话记录，提取【值得长期记忆】的增量信息，输出为JSON数组格式。

# 输出格式（严格遵守JSON数组）
\`\`\`json
[
  {
    "content": "记忆内容（第一人称，简短清晰，如：用户告诉我她今天升职了）",
    "tags": ["升职", "开心", "工作"],
    "category": "U/A/R/E/I/L/P/T/M/C",
    "importance": 1-10,
    "emotionalWeight": 1-10
  }
]
\`\`\`

# 10大精细分类说明
- U = 用户设定 (用户的外貌/性格/喜好/身份等)
- A = 角色设定 (你自己发生的改变)
- R = 关系发展 (表白/吵架/亲密举动等里程碑)
- E = 经历/事件 (共同经历的事情)
- I = 物品/礼物 (送礼/买东西)
- L = 地点/场景 (去过的重要地方)
- P = 承诺/计划 (约定的未来事项)
- T = 禁忌/规则 (雷区/规矩)
- M = 情绪/心理 (强烈的情感流露/阴影)
- C = 核心灵魂 (必须永远铭记的生死攸关的事)

# 评分规则 (1-10)
- importance: 8-10(极其重要/转折点)，5-7(值得记住)，1-4(日常琐事，尽量别记)
- emotionalWeight: 情感的强烈程度。

# 待提取对话
{{对话记录}}

请直接输出JSON数组，如果没有值得记录的内容，输出空数组 []。`;
  }

  getVectorMemory(chat) {
    return this.getVariableMemory(chat);
  }

  getVariableMemory(chat) {
    if (!chat.variableMemory) {
      chat.variableMemory = {
        fragments: [],
        timelineSummaries: {},
        settings: {
          topN: 10,
          embeddingModel: '',
          embeddingEndpoint: '',
          useCustomEmbedding: false,
          scoreWeights: { semantic: 0.4, keyword: 0.3, importance: 0.2, emotion: 0.05, recency: 0.05 },
          customExtractionPrompt: '',
          useCustomExtractionPrompt: false,
          enableDateTrigger: true,
          enableEmotionTrigger: true,
          enableTopicTrigger: true,
          enablePeriodicReview: true,
          reviewIntervalDays: 7,
          retrievalStrategy: 'user-only',
          retrievalUserMsgCount: 3,
          retrievalCacheEnabled: true,
          retrievalCacheInterval: 3,
          autoExtractionMsgInterval: 20,
          lastExtractedMsgIndex: -1
        },
        _customCategories: {},
        stats: { totalFragments: 0, totalRecalls: 0, lastUpdated: 0 },
        _retrievalCache: { query: '', result: null, timestamp: 0, msgCount: 0 },
        _migrated: false
      };
    }
    
    const vm = chat.variableMemory;
    if (vm.settings.autoExtractionMsgInterval === undefined) vm.settings.autoExtractionMsgInterval = 20;
    if (vm.settings.lastExtractedMsgIndex === undefined) vm.settings.lastExtractedMsgIndex = -1;
    if (vm.settings.customExtractionPrompt === undefined) vm.settings.customExtractionPrompt = '';
    if (vm.settings.useCustomExtractionPrompt === undefined) vm.settings.useCustomExtractionPrompt = false;

    if (chat.vectorMemory && !vm._migrated) {
      this._migrateFromVectorMemory(chat);
    }

    return vm;
  }

  _migrateFromVectorMemory(chat) {
    const old = chat.vectorMemory;
    const vm = chat.variableMemory;
    if (!old) return;
    console.log('[变量记忆] 开始迁移旧版向量记忆数据...');
    if (old.coreMemories && old.coreMemories.length > 0) {
      for (const core of old.coreMemories) {
        vm.fragments.push({
          id: 'mem_core_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          content: core.content,
          tags: ['核心设定'],
          category: 'C',
          importance: 10,
          emotionalWeight: 5,
          createdAt: core.createdAt || Date.now(),
          memoryTime: core.createdAt || Date.now(),
          lastRecalled: 0,
          recallCount: 0,
          embedding: null,
          linkedMemories: [],
          source: 'migrate_core',
          context: ''
        });
      }
    }
    if (old.fragments && old.fragments.length > 0) {
      for (const frag of old.fragments) {
        let newCat = 'E';
        if (frag.category === 'F') newCat = 'U';
        else if (frag.category === 'D') newCat = 'E';
        else if (frag.category === 'P') newCat = 'P';
        else if (frag.category === 'R') newCat = 'R';
        else if (frag.category === 'M') newCat = 'M';
        vm.fragments.push({
          ...frag,
          category: newCat,
          memoryTime: frag.dialogueTimeRange?.start || frag.createdAt || Date.now(),
          dialogueTimeRange: undefined
        });
      }
    }
    if (old.settings) {
      vm.settings = { ...vm.settings, ...old.settings };
    }
    if (old.lastExtractionTimestamp && chat.history) {
      const idx = chat.history.findIndex(m => m.timestamp >= old.lastExtractionTimestamp);
      vm.settings.lastExtractedMsgIndex = idx >= 0 ? idx : chat.history.length - 1;
    } else if (chat.history) {
      vm.settings.lastExtractedMsgIndex = chat.history.length - 1;
    }
    vm.stats = old.stats || vm.stats;
    vm._customCategories = old._customCategories || {};
    vm._migrated = true;
    console.log('[变量记忆] 迁移完成，共', vm.fragments.length, '条记忆');
  }

  getCategories(chat) {
    const vm = this.getVariableMemory(chat);
    return { ...this.DEFAULT_CATEGORIES, ...(vm._customCategories || {}) };
  }

  createFragment(chat, data) {
    const vm = this.getVariableMemory(chat);
    const id = 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const fragment = {
      id,
      content: data.content,
      tags: data.tags || [],
      category: data.category || 'E',
      importance: data.importance || 5,
      emotionalWeight: data.emotionalWeight || 3,
      createdAt: Date.now(),
      memoryTime: data.memoryTime || Date.now(),
      lastRecalled: 0,
      recallCount: 0,
      embedding: data.embedding || null,
      linkedMemories: data.linkedMemories || [],
      source: data.source || 'auto',
      context: data.context || ''
    };
    vm.fragments.push(fragment);
    vm.stats.totalFragments = vm.fragments.length;
    vm.stats.lastUpdated = Date.now();
    return id;
  }

  editFragment(chat, id, updates) {
    const vm = this.getVariableMemory(chat);
    const frag = vm.fragments.find(f => f.id === id);
    if (!frag) return false;
    if (updates.content !== undefined) { frag.content = updates.content; frag.embedding = null; }
    if (updates.tags !== undefined) frag.tags = updates.tags;
    if (updates.category !== undefined) frag.category = updates.category;
    if (updates.importance !== undefined) frag.importance = updates.importance;
    if (updates.emotionalWeight !== undefined) frag.emotionalWeight = updates.emotionalWeight;
    if (updates.memoryTime !== undefined) frag.memoryTime = updates.memoryTime;
    if (updates.linkedMemories !== undefined) frag.linkedMemories = updates.linkedMemories;
    if (updates.context !== undefined) frag.context = updates.context;
    vm.stats.lastUpdated = Date.now();
    return true;
  }

  deleteFragment(chat, id) {
    const vm = this.getVariableMemory(chat);
    vm.fragments = vm.fragments.filter(f => f.id !== id);
    vm.fragments.forEach(f => {
      f.linkedMemories = (f.linkedMemories || []).filter(lid => lid !== id);
    });
    vm.stats.totalFragments = vm.fragments.length;
    vm.stats.lastUpdated = Date.now();
  }

  getFragment(chat, id) {
    const vm = this.getVariableMemory(chat);
    return vm.fragments.find(f => f.id === id) || null;
  }

  getAllFragments(chat) {
    const vm = this.getVariableMemory(chat);
    return vm.fragments || [];
  }

  getCoreMemories(chat) {
    const vm = this.getVariableMemory(chat);
    return vm.fragments.filter(f => f.category === 'C');
  }

  addCoreMemory(chat, content) {
    return this.createFragment(chat, { content, category: 'C', importance: 10, tags: ['核心设定'] });
  }

  editCoreMemory(chat, id, newContent) {
    this.editFragment(chat, id, { content: newContent });
  }

  deleteCoreMemory(chat, id) {
    this.deleteFragment(chat, id);
  }

  pinToCoreMemory(chat, fragmentId) {
    this.editFragment(chat, fragmentId, { category: 'C', importance: 10 });
  }

  serializeCoreMemories(chat) {
    const cores = this.getCoreMemories(chat);
    if (cores.length === 0) return '';
    let output = '## 核心灵魂设定（不可违背）\n';
    cores.forEach(m => { output += `- ${m.content}\n`; });
    return output;
  }

  async getEmbedding(text, chat) {
    if (!text || !text.trim()) return null;
    const cacheKey = text.trim().substring(0, 200);
    if (this.embeddingCache.has(cacheKey)) return this.embeddingCache.get(cacheKey);
    try {
      const vm = this.getVariableMemory(chat);
      const apiConfig = window.state?.apiConfig || {};
      let endpoint, apiKey, model;
      if (vm.settings.useCustomEmbedding && vm.settings.embeddingEndpoint) {
        endpoint = vm.settings.embeddingEndpoint;
        apiKey = vm.settings.embeddingApiKey || apiConfig.apiKey;
        model = vm.settings.embeddingModel || 'text-embedding-3-small';
      } else {
        const useSecondary = apiConfig.secondaryProxyUrl && apiConfig.secondaryApiKey;
        endpoint = useSecondary ? apiConfig.secondaryProxyUrl : apiConfig.proxyUrl;
        apiKey = useSecondary ? apiConfig.secondaryApiKey : apiConfig.apiKey;
        model = 'text-embedding-3-small';
      }
      if (!endpoint || !apiKey) return null;
      const url = endpoint.endsWith('/') ? endpoint + 'v1/embeddings' : endpoint + '/v1/embeddings';
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: text.trim() })
      });
      if (!response.ok) return null;
      const data = await response.json();
      const embedding = data?.data?.[0]?.embedding || null;
      if (embedding) this.embeddingCache.set(cacheKey, embedding);
      return embedding;
    } catch (e) {
      return null;
    }
  }

  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
  }

  bm25Match(queryTokens, text) {
    if (!queryTokens.length || !text) return 0;
    const lowerText = text.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      const lt = token.toLowerCase();
      if (lowerText.includes(lt)) {
        const count = (lowerText.match(new RegExp(lt, 'g')) || []).length;
        score += count * 1.5; 
      }
    }
    return Math.min(score / (queryTokens.length * 2), 1.0);
  }

  tokenize(text) {
    if (!text) return [];
    const stopWords = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '有', '和', '与', '也', '都', '就', '不', '吗', '呢', '吧', '啊', '哦', '嗯', '呀', '哈']);
    const tokens = [];
    const cnMatches = text.match(/[\u4e00-\u9fff]{2,5}/g) || [];
    cnMatches.forEach(m => { if (!stopWords.has(m)) tokens.push(m); });
    const enMatches = text.match(/[a-zA-Z]+/g) || [];
    enMatches.forEach(m => { if (m.length > 1 && !stopWords.has(m.toLowerCase())) tokens.push(m); });
    return [...new Set(tokens)];
  }

  timeDecay(memoryTime) {
    const daysSince = (Date.now() - memoryTime) / (1000 * 60 * 60 * 24);
    if (daysSince < 0) return 1.0;
    return Math.max(0.1, Math.exp(-0.693 * daysSince / 30));
  }

  async retrieveRelevant(chat, queryText, topN = null) {
    const vm = this.getVariableMemory(chat);
    if (!vm.fragments.length) return [];
    if (!topN) topN = vm.settings.topN || 10;
    if (vm.settings.retrievalCacheEnabled && vm._retrievalCache) {
      const cache = vm._retrievalCache;
      const cacheAge = (Date.now() - cache.timestamp) / 1000 / 60; 
      const msgCountDiff = (chat.history?.length || 0) - cache.msgCount;
      if (cache.query === queryText && cacheAge < 10 && msgCountDiff < (vm.settings.retrievalCacheInterval || 3) && cache.result) {
        return cache.result;
      }
    }
    const weights = vm.settings.scoreWeights;
    const queryEmbedding = await this.getEmbedding(queryText, chat);
    const queryTokens = this.tokenize(queryText);
    const scored = vm.fragments.map(frag => {
      if (frag.category === 'C') {
        return { fragment: frag, score: 999 };
      }
      const semanticScore = queryEmbedding && frag.embedding ? this.cosineSimilarity(queryEmbedding, frag.embedding) : 0;
      const tagText = (frag.tags || []).join(' ');
      const bm25Score = Math.max(this.bm25Match(queryTokens, tagText), this.bm25Match(queryTokens, frag.content) * 0.8);
      const importanceVal = frag.importance || 5;
      let importanceScore = importanceVal / 10;
      if (importanceVal >= 8) importanceScore *= 1.5;
      const emotionScore = (frag.emotionalWeight || 3) / 10;
      let recencyScore = this.timeDecay(frag.memoryTime);
      if (importanceVal >= 9) recencyScore = 1.0; 
      const totalScore =
        semanticScore * (weights.semantic || 0.4) +
        bm25Score * (weights.keyword || 0.3) +
        importanceScore * (weights.importance || 0.2) +
        emotionScore * (weights.emotion || 0.05) +
        recencyScore * (weights.recency || 0.05);
      return { fragment: frag, score: totalScore };
    });
    scored.sort((a, b) => b.score - a.score);
    let results = scored.slice(0, topN).filter(r => r.score > 0.1 || r.fragment.category === 'C');
    for (const r of results) {
      r.fragment.lastRecalled = Date.now();
      r.fragment.recallCount = (r.fragment.recallCount || 0) + 1;
    }
    vm.stats.totalRecalls++;
    if (vm.settings.retrievalCacheEnabled) {
      vm._retrievalCache = { query: queryText, result: results, timestamp: Date.now(), msgCount: chat.history?.length || 0 };
    }
    return results;
  }

  async serializeForPrompt(chat, recentMessages = '') {
    const vm = this.getVariableMemory(chat);
    let output = '';
    const coreStr = this.serializeCoreMemories(chat);
    if (coreStr) output += coreStr + '\n';
    if (recentMessages && vm.fragments.length > 0) {
      const results = await this.retrieveRelevant(chat, recentMessages);
      const nonCoreResults = results.filter(r => r.fragment.category !== 'C');
      if (nonCoreResults.length > 0) {
        output += '## 回闪记忆 (根据当前情境唤醒的记忆片段)\n';
        nonCoreResults.sort((a, b) => a.fragment.memoryTime - b.fragment.memoryTime);
        const cats = this.getCategories(chat);
        for (const r of nonCoreResults) {
          const dateStr = new Date(r.fragment.memoryTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
          output += `[${dateStr}] ${r.fragment.content}\n`;
        }
        output += '\n';
      }
    }
    if (!output.trim()) output = '(暂无记忆)\n';
    return `## 你的变量记忆档案
[系统强制指令：你必须将以下提取出的记忆作为你真实的过去，并在对话中自然地表现出你记得这些事。]
${output}`;
  }

  buildExtractionPrompt(chat, formattedHistory, timeRangeStr, dialogueTimeRange) {
    const vm = this.getVariableMemory(chat);
    const userNickname = chat.settings.myNickname || (window.state?.qzoneSettings?.nickname || '用户');
    this._tempLastMsgIndex = chat.history ? chat.history.length - 1 : -1;
    if (vm.settings.useCustomExtractionPrompt && vm.settings.customExtractionPrompt?.trim()) {
      return vm.settings.customExtractionPrompt
        .replace(/\{\{角色名\}\}/g, chat.originalName || chat.name)
        .replace(/\{\{用户昵称\}\}/g, userNickname)
        .replace(/\{\{对话记录\}\}/g, formattedHistory);
    }
    return this.DEFAULT_EXTRACTION_PROMPT
      .replace(/\{\{角色名\}\}/g, chat.originalName || chat.name)
      .replace(/\{\{用户昵称\}\}/g, userNickname)
      .replace(/\{\{对话记录\}\}/g, formattedHistory);
  }

  resetExtractionPrompt(chat) {
    const vm = this.getVariableMemory(chat);
    vm.settings.customExtractionPrompt = '';
    vm.settings.useCustomExtractionPrompt = false;
    return this.DEFAULT_EXTRACTION_PROMPT;
  }

  parseExtractionResult(rawText) {
    try {
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const arr = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(arr)) return [];
      const cats = Object.keys(this.DEFAULT_CATEGORIES);
      return arr.filter(item => item && item.content).map(item => ({
        content: String(item.content).trim(),
        tags: Array.isArray(item.tags) ? item.tags.map(t => String(t).trim()) : [],
        category: cats.includes(item.category) ? item.category : 'E',
        importance: Math.min(10, Math.max(1, parseInt(item.importance) || 5)),
        emotionalWeight: Math.min(10, Math.max(1, parseInt(item.emotionalWeight) || 3))
      }));
    } catch (e) {
      console.error('[变量记忆] 解析提取结果失败:', e);
      return [];
    }
  }

  // ========== 导出/导入/复制方法 ==========
  exportMemory(chat) {
    const vm = this.getVariableMemory(chat);
    const data = {
      version: '1.0',
      exportTime: Date.now(),
      fragments: vm.fragments,
      settings: vm.settings,
      _customCategories: vm._customCategories
    };
    return JSON.stringify(data, null, 2);
  }

  exportSelected(chat, selectedItems) {
    const vm = this.getVariableMemory(chat);
    const selectedFragments = [];
    for (const item of selectedItems) {
      const frag = vm.fragments.find(f => f.id === item.id);
      if (frag) {
        selectedFragments.push(frag);
      }
    }
    const data = {
      version: '1.0',
      exportTime: Date.now(),
      fragments: selectedFragments,
      type: 'selected'
    };
    return JSON.stringify(data, null, 2);
  }

  getSelectedItemsText(chat, selectedItems) {
    const vm = this.getVariableMemory(chat);
    const texts = [];
    for (const item of selectedItems) {
      const frag = vm.fragments.find(f => f.id === item.id);
      if (frag) {
        texts.push(frag.content);
      }
    }
    return texts.join('\n\n');
  }

  // 批量删除
  batchDelete(chat, selectedItems) {
    const vm = this.getVariableMemory(chat);
    for (const item of selectedItems) {
      // 根据类型删除
      if (item.type === 'fragment') {
        vm.fragments = vm.fragments.filter(f => f.id !== item.id);
      } else if (item.type === 'core') {
        vm.fragments = vm.fragments.filter(f => !(f.id === item.id && f.category === 'C'));
      }
    }
    vm.stats.totalFragments = vm.fragments.length;
    vm.stats.lastUpdated = Date.now();
    return true;
  }

  // 导入记忆
  async importMemory(chat, jsonText, mode = 'merge') {
    const vm = this.getVariableMemory(chat);
    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      throw new Error('无效的JSON文件');
    }
    
    const importedFragments = data.fragments || [];
    if (importedFragments.length === 0) {
      throw new Error('没有找到可导入的记忆');
    }
    
    if (mode === 'replace') {
      vm.fragments = [];
    }
    
    let addedCount = 0;
    for (const frag of importedFragments) {
      // 检查是否已存在（通过内容相似度）
      const isDuplicate = vm.fragments.some(f => 
        this.bm25Match(this.tokenize(frag.content), frag.content) > 0.8
      );
      if (!isDuplicate) {
        const embedding = await this.getEmbedding(frag.content, chat);
        this.createFragment(chat, {
          content: frag.content,
          tags: frag.tags || [],
          category: frag.category || 'E',
          importance: frag.importance || 5,
          emotionalWeight: frag.emotionalWeight || 3,
          memoryTime: frag.memoryTime || Date.now(),
          embedding: embedding,
          source: 'import'
        });
        addedCount++;
      }
    }
    
    return addedCount;
  }

  // ========== 结束 ==========

  async mergeExtractedMemories(chat, extractedItems, defaultTime = Date.now(), extractedEndIndex = null) {
    const vm = this.getVariableMemory(chat);
    const newIds = [];
    
    for (const item of extractedItems) {
      const isDuplicate = vm.fragments.some(f => this.bm25Match(this.tokenize(item.content), f.content) > 0.8);
      if (isDuplicate) continue;

      const embedding = await this.getEmbedding(item.content, chat);
      const id = this.createFragment(chat, {
        ...item,
        embedding,
        memoryTime: defaultTime
      });
      newIds.push(id);
    }
    
    if (extractedEndIndex !== null && extractedEndIndex !== undefined && extractedEndIndex !== -1) {
      if (extractedEndIndex > vm.settings.lastExtractedMsgIndex) {
        vm.settings.lastExtractedMsgIndex = extractedEndIndex;
        console.log('[变量记忆] 更新提取进度索引至:', extractedEndIndex);
      }
    } else {
      if (this._tempLastMsgIndex !== undefined && this._tempLastMsgIndex !== -1) {
        if (this._tempLastMsgIndex > vm.settings.lastExtractedMsgIndex) {
          vm.settings.lastExtractedMsgIndex = this._tempLastMsgIndex;
          console.log('[变量记忆] 自动更新提取进度索引至:', this._tempLastMsgIndex);
        }
      }
    }

    return newIds;
  }

  getStats(chat) {
    const vm = this.getVariableMemory(chat);
    const frags = vm.fragments || [];
    const historyLen = chat.history ? chat.history.length : 0;
    const lastIdx = vm.settings.lastExtractedMsgIndex !== undefined ? vm.settings.lastExtractedMsgIndex : -1;
    const unextractedMessages = Math.max(0, historyLen - 1 - lastIdx);
    const autoInterval = vm.settings.autoExtractionMsgInterval || 20;
    const remainingToAuto = Math.max(0, autoInterval - unextractedMessages);
    const embeddedCount = frags.filter(f => f.embedding).length;
    let embeddingHealth = frags.length === 0 ? 'empty' : (embeddedCount === frags.length ? 'perfect' : (embeddedCount > 0 ? 'partial' : 'failed'));

    return {
      totalFragments: frags.length,
      coreMemories: frags.filter(f => f.category === 'C').length,
      embeddedCount,
      embeddingHealth,
      unextractedMessages,
      autoInterval,
      remainingToAuto
    };
  }

  renderMemoryUI(chat, container) {
    const vm = this.getVariableMemory(chat);
    const stats = this.getStats(chat);
    container.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'vm-toolbar';
    toolbar.innerHTML = `
      <button class="vm-toolbar-btn" id="vm-add-fragment-btn">添加记忆</button>
      <button class="vm-toolbar-btn" id="vm-add-core-btn">添加核心</button>
      <div style="flex:1"></div>
      <button class="vm-toolbar-btn vm-primary" id="vm-summary-btn" title="剩余 ${stats.remainingToAuto} 条消息后自动触发">
        提取记忆 (${stats.unextractedMessages}/${stats.autoInterval})</button>
      <button class="vm-toolbar-btn" id="vm-batch-toggle-btn">批量</button>
      <button class="vm-toolbar-btn" id="vm-export-btn">导出全部</button>
      <button class="vm-toolbar-btn" id="vm-import-btn">导入</button>
      <button class="vm-toolbar-btn" id="vm-settings-btn">设置</button>
      <button class="vm-toolbar-btn" id="vm-guide-btn">便携教程</button>
    `;
    container.appendChild(toolbar);

    // 批量操作工具栏（默认隐藏）
    const batchToolbar = document.createElement('div');
    batchToolbar.className = 'vm-batch-toolbar';
    batchToolbar.id = 'vm-batch-toolbar';
    batchToolbar.style.display = 'none';
    batchToolbar.innerHTML = `
      <span class="vm-batch-count">已选 <span id="vm-batch-selected-count">0</span> 项</span>
      <button class="vm-batch-btn" id="vm-batch-select-all-btn">全选</button>
      <button class="vm-batch-btn" id="vm-batch-copy-btn">复制</button>
      <button class="vm-batch-btn" id="vm-batch-export-btn">导出</button>
      <button class="vm-batch-btn vm-batch-danger" id="vm-batch-delete-btn">删除</button>
      <button class="vm-batch-btn" id="vm-batch-cancel-btn">取消</button>
    `;
    container.appendChild(batchToolbar);

    const listContainer = document.createElement('div');
    listContainer.className = 'vm-list-container';
    
    const categories = this.getCategories(chat);
    
    for (const [code, catInfo] of Object.entries(categories)) {
      const frags = vm.fragments.filter(f => f.category === code);
      if (frags.length === 0) continue;
      
      frags.sort((a, b) => b.memoryTime - a.memoryTime);

      const section = document.createElement('div');
      section.className = 'vm-section';
      if (code === 'C') section.classList.add('vm-core-section');
      
      section.innerHTML = `
        <div class="vm-section-header">
          <div class="vm-section-select-all vm-batch-element" data-category="${code}" style="display: none;"></div>
          <span class="vm-section-tag" style="background:${catInfo.color}">${code}</span>
          <span class="vm-section-title">${catInfo.name}</span>
          <span class="vm-section-count">${frags.length}</span>
        </div>
      `;
      
      const list = document.createElement('div');
      list.className = 'vm-section-list';
      
      frags.forEach(frag => {
        const row = document.createElement('div');
        row.className = 'vm-item-row';
        
        const dateObj = new Date(frag.memoryTime);
        const tzOffset = dateObj.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(dateObj - tzOffset)).toISOString().slice(0,16);

        row.innerHTML = `
          <div class="vm-item-checkbox vm-batch-element" data-type="fragment" data-id="${frag.id}" style="display: none;"></div>
          <div class="vm-item-main">
            <span class="vm-item-content">${this._escapeHtml(frag.content)}</span>
            <div class="vm-item-meta">
              <input type="datetime-local" class="vm-time-picker" data-id="${frag.id}" value="${localISOTime}" title="修改记忆发生时间">
              <span class="vm-meta-tag">重要度:${frag.importance}</span>
              ${frag.embedding ? '<span class="vm-meta-tag" title="已向量化">Vector✓</span>' : '<span class="vm-meta-tag" style="color:#ff9500">BM25</span>'}
            </div>
          </div>
          <div class="vm-item-actions">
            ${code !== 'C' ? `<button class="vm-item-btn vm-pin-btn" data-id="${frag.id}">置顶为核心</button>` : ''}
            <button class="vm-item-btn vm-edit-frag-btn" data-id="${frag.id}">改内容</button>
            <button class="vm-item-btn vm-delete-frag-btn" data-id="${frag.id}" style="color:#ff3b30">删</button>
          </div>
        `;
        list.appendChild(row);
      });
      section.appendChild(list);
      listContainer.appendChild(section);
    }

    if (vm.fragments.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center; color: #999; padding: 40px 20px;">
          <div style="font-size:40px; margin-bottom:10px;"></div>
          <p style="font-size: 16px; font-weight:bold; color:#666;">变量记忆是空的</p>
          <p style="font-size: 13px; margin-top: 5px;">继续聊天，当新消息达到 ${stats.autoInterval} 条时，系统会自动提取记忆。</p>
          <p style="font-size: 13px;">你也可以手动点击上方按钮添加。</p>
        </div>
      `;
    }

    container.appendChild(listContainer);
  }

  renderSettingsPanel(chat) {
    const vm = this.getVariableMemory(chat);
    const s = vm.settings;
    return `
      <div class="vm-settings-panel">
        <div class="vm-settings-group">
          <h4>提取与触发规则</h4>
          <div class="vm-setting-item">
            <label>多少条新消息自动提取一次？</label>
            <input type="number" id="vm-auto-interval" value="${s.autoExtractionMsgInterval || 20}" min="5" max="100" class="vm-input-full">
            <div style="font-size:11px;color:#999;margin-top:4px;">不用担心刷屏！现在基于绝对消息数量触发，严格锁定。</div>
          </div>
        </div>

        <div class="vm-settings-group">
          <h4>自定义提取提示词</h4>
          <div class="vm-setting-row">
            <span>启用自定义提取提示词</span>
            <label class="toggle-switch"><input type="checkbox" id="vm-use-custom-prompt" ${s.useCustomExtractionPrompt ? 'checked' : ''}><span class="slider"></span></label>
          </div>
          <div id="vm-custom-prompt-fields" style="display:${s.useCustomExtractionPrompt ? 'block' : 'none'}; margin-top:8px;">
            <div style="font-size:11px; color:#666; margin-bottom:6px;">
              📝 支持变量：<code>{{角色名}}</code>、<code>{{用户昵称}}</code>、<code>{{对话记录}}</code>
            </div>
            <textarea id="vm-custom-prompt" class="vm-textarea" placeholder="输入自定义提取提示词..." rows="6">${this._escapeHtml(s.customExtractionPrompt || this.DEFAULT_EXTRACTION_PROMPT)}</textarea>
            <button id="vm-reset-prompt-btn" style="margin-top:8px; padding:6px 12px; font-size:12px; background:var(--bg-secondary,#f0f0f0); border:1px solid var(--border-color,#ddd); border-radius:6px; cursor:pointer;">恢复默认提示词</button>
          </div>
        </div>

        <div class="vm-settings-group">
          <h4>检索引擎调参</h4>
          <div class="vm-setting-item">
            <label>每轮注入 AI 脑海的记忆数 (Top N)</label>
            <input type="number" id="vm-topn" value="${s.topN || 10}" min="1" max="30" class="vm-input-full">
          </div>
          <div class="vm-setting-item" style="margin-top:12px;">
            <label>多维打分权重分布</label>
            <div class="vm-weights">
              <div><span>语义(Vector)</span><input type="number" id="vm-w-semantic" value="${s.scoreWeights.semantic}" step="0.1" class="vm-input-sm"></div>
              <div><span>字面(BM25)</span><input type="number" id="vm-w-keyword" value="${s.scoreWeights.keyword}" step="0.1" class="vm-input-sm"></div>
              <div><span>重要度(Importance)</span><input type="number" id="vm-w-importance" value="${s.scoreWeights.importance}" step="0.1" class="vm-input-sm"></div>
              <div><span>时间衰减(Decay)</span><input type="number" id="vm-w-recency" value="${s.scoreWeights.recency}" step="0.1" class="vm-input-sm"></div>
            </div>
            <div style="font-size:11px;color:#999;margin-top:4px;">注意：如果无 Embedding API，系统会自动用 BM25 算法替代，依然精准！核心记忆(C类)永远是满分免疫衰减。</div>
          </div>
        </div>

        <div class="vm-settings-group">
          <h4>向量化端点 (可选)</h4>
          <div class="vm-setting-row">
            <span>开启自定义 Embedding</span>
            <label class="toggle-switch"><input type="checkbox" id="vm-custom-embedding" ${s.useCustomEmbedding ? 'checked' : ''}><span class="slider"></span></label>
          </div>
          <div id="vm-custom-embedding-fields" style="display:${s.useCustomEmbedding ? 'block' : 'none'}; margin-top:8px;">
            <input type="text" id="vm-embedding-endpoint" value="${this._escapeHtml(s.embeddingEndpoint || '')}" placeholder="https://api.openai.com" class="vm-input-full">
            <input type="password" id="vm-embedding-apikey" value="${this._escapeHtml(s.embeddingApiKey || '')}" placeholder="API Key" class="vm-input-full" style="margin-top:4px;">
            <div style="display:flex; gap:8px; margin-top:4px; position:relative;">
              <input type="text" id="vm-embedding-model" value="${this._escapeHtml(s.embeddingModel || 'text-embedding-3-small')}" placeholder="Model Name" class="vm-input-full" style="flex:1;">
              <button id="vm-fetch-models-btn" class="vm-btn-secondary" style="white-space:nowrap; padding:0 12px;">拉取模型</button>
            </div>
            <div id="vm-models-list" style="display:none; max-height:200px; overflow-y:auto; background:var(--bg-color,#fff); border:1px solid var(--border-color,#eee); border-radius:8px; margin-top:4px; box-shadow:0 4px 12px rgba(0,0,0,0.1); position:absolute; z-index:100; width:calc(100% - 30px);"></div>
          </div>
        </div>

        <button id="vm-save-settings-btn" class="vm-btn-primary" style="width:100%;margin-top:12px;">保存设置</button>
      </div>
    `;
  }

  saveSettingsFromUI(chat) {
    const vm = this.getVariableMemory(chat);
    vm.settings.autoExtractionMsgInterval = parseInt(document.getElementById('vm-auto-interval')?.value) || 20;
    vm.settings.topN = parseInt(document.getElementById('vm-topn')?.value) || 10;
    vm.settings.scoreWeights = {
      semantic: parseFloat(document.getElementById('vm-w-semantic')?.value) || 0.4,
      keyword: parseFloat(document.getElementById('vm-w-keyword')?.value) || 0.3,
      importance: parseFloat(document.getElementById('vm-w-importance')?.value) || 0.2,
      recency: parseFloat(document.getElementById('vm-w-recency')?.value) || 0.05,
      emotion: 0.05
    };
    vm.settings.useCustomEmbedding = document.getElementById('vm-custom-embedding')?.checked || false;
    vm.settings.embeddingEndpoint = document.getElementById('vm-embedding-endpoint')?.value || '';
    vm.settings.embeddingApiKey = document.getElementById('vm-embedding-apikey')?.value || '';
    vm.settings.embeddingModel = document.getElementById('vm-embedding-model')?.value || 'text-embedding-3-small';
    
    vm.settings.useCustomExtractionPrompt = document.getElementById('vm-use-custom-prompt')?.checked || false;
    vm.settings.customExtractionPrompt = document.getElementById('vm-custom-prompt')?.value || '';
    
    if (vm._retrievalCache) vm._retrievalCache = { query: '', result: null, timestamp: 0, msgCount: 0 };
    
    alert('设置已保存！');
  }

  resetExtractionPromptFromUI() {
    const promptTextarea = document.getElementById('vm-custom-prompt');
    if (promptTextarea) {
      promptTextarea.value = this.DEFAULT_EXTRACTION_PROMPT;
    }
    const enableCheckbox = document.getElementById('vm-use-custom-prompt');
    if (enableCheckbox && !enableCheckbox.checked) {
      enableCheckbox.checked = true;
      const fieldsDiv = document.getElementById('vm-custom-prompt-fields');
      if (fieldsDiv) fieldsDiv.style.display = 'block';
    }
    alert('已恢复默认提示词');
  }

  async fetchAvailableModels(chat) {
    const vm = this.getVariableMemory(chat);
    const apiConfig = window.state?.apiConfig || {};
    const endpointInput = document.getElementById('vm-embedding-endpoint')?.value;
    const apiKeyInput = document.getElementById('vm-embedding-apikey')?.value;
    const isCustom = document.getElementById('vm-custom-embedding')?.checked;
    let endpoint = endpointInput;
    let apiKey = apiKeyInput;
    if (!isCustom || !endpoint) {
      const useSecondary = apiConfig.secondaryProxyUrl && apiConfig.secondaryApiKey;
      endpoint = useSecondary ? apiConfig.secondaryProxyUrl : apiConfig.proxyUrl;
      apiKey = useSecondary ? apiConfig.secondaryApiKey : apiConfig.apiKey;
    } else {
      if (!apiKey) apiKey = apiConfig.apiKey;
    }
    if (!endpoint || !apiKey) {
      throw new Error('未配置有效的端点或API Key');
    }
    try {
      const url = endpoint.endsWith('/') ? endpoint + 'v1/models' : endpoint + '/v1/models';
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !data.data) throw new Error('API 返回格式异常');
      const models = data.data.map(m => m.id).sort((a, b) => {
        const aEmb = a.toLowerCase().includes('embed') || a.toLowerCase().includes('bge');
        const bEmb = b.toLowerCase().includes('embed') || b.toLowerCase().includes('bge');
        if (aEmb && !bEmb) return -1;
        if (!aEmb && bEmb) return 1;
        return a.localeCompare(b);
      });
      return models;
    } catch (e) {
      throw new Error(e.message || '网络请求失败');
    }
  }

  renderGuide() {
    return `
      <div class="vm-guide">
        <div style="text-align:center; margin-bottom:20px;">
          <h3 style="font-size:18px; color:#333;">变量记忆 小白指南</h3>
          <p style="font-size:13px; color:#666;">彻底治愈 AI 的"失忆症"</p>
        </div>
        <div class="vm-guide-card">
          <div class="vm-guide-card-title">什么是"变量记忆"？</div>
          <p>它是原本"向量记忆"的究极进化版。把它当成 AI 的私人日记本。</p>
        </div>
        <div class="vm-guide-card">
          <div class="vm-guide-card-title">随意穿梭时间！(重磅功能)</div>
          <p>在记忆列表中点击日期框，可以直接修改记忆的发生时间。</p>
        </div>
        <div class="vm-guide-card">
          <div class="vm-guide-card-title">它怎么自动记东西？</div>
          <p>每聊满20句话（设置里可改），系统会自动提取记忆。</p>
        </div>
        <div class="vm-guide-card">
          <div class="vm-guide-card-title">什么是"核心灵魂"？</div>
          <p>分类为【C 核心灵魂】的记忆拥有最高权重，永远不会随时间衰减，AI 每一轮都会记住它。</p>
        </div>
        <div class="vm-guide-card">
          <div class="vm-guide-card-title">自定义提取提示词</div>
          <p>在设置面板中自定义 AI 提取记忆时的提示词。支持变量：{{角色名}}、{{用户昵称}}、{{对话记录}}。</p>
        </div>
      </div>
    `;
  }

  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

window.vectorMemoryManager = new VariableMemoryManager();